'use client';

import type { Material, Subject } from '../types';
import { materialContentHash } from './hash';
import { loadCloudLibrary } from './library';
import {
  downloadMaterialContent,
  listMaterialRows,
  writeMaterial,
} from './materialsRepository';
import {
  hasMigrationOriginals,
  loadMigrationOriginals,
  loadOriginalMaterialContent,
} from './migrationOriginals';
import { planLocalMigration, subjectEquivalent, type MigrationConflict } from './plan';
import { listSubjects, upsertSubject } from './subjectsRepository';
import type { CloudMaterialContent } from './types';

const USER_PREFIX = 'redcall_user_';
const JOB_BASE = 'cloud_migration_job_v1';
const MARKER_BASE = 'cloud_migration_v1';
const DECLINED_BASE = 'cloud_migration_declined_v1';

interface CloudMigrationJob {
  jobId: string;
  state: 'in_progress' | 'completed';
  startedAt: string;
  updatedAt: string;
}

export interface CloudMigrationState {
  imported: boolean;
  declined: boolean;
  hasLocalData: boolean;
  resume: boolean;
}

export interface CloudMigrationResult {
  ok: boolean;
  conflict: boolean;
  resume: boolean;
  partial: boolean;
  subjectsUploaded: number;
  materialsUploaded: number;
  conflicts: MigrationConflict[];
  message: string;
}

function userBaseKey(userId: string, base: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${base}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function readJob(storage: Storage, userId: string): CloudMigrationJob | null {
  try {
    const raw = storage.getItem(userBaseKey(userId, JOB_BASE));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudMigrationJob>;
    if (!parsed || (parsed.state !== 'in_progress' && parsed.state !== 'completed')) return null;
    return {
      jobId: typeof parsed.jobId === 'string' ? parsed.jobId : '',
      state: parsed.state,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** Writes a value and verifies it by reading it back. */
function writeVerified(storage: Storage, userId: string, base: string, value: unknown): boolean {
  const key = userBaseKey(userId, base);
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

function generateJobId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCloudMigrationState(userId: string): CloudMigrationState {
  const storage = getStorage();
  if (!storage) return { imported: false, declined: false, hasLocalData: false, resume: false };
  let imported = false;
  let declined = false;
  try {
    imported = storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null;
    declined = storage.getItem(userBaseKey(userId, DECLINED_BASE)) !== null;
  } catch {
    // treat unreadable markers as not imported
  }
  const job = readJob(storage, userId);
  return {
    imported,
    declined,
    hasLocalData: hasMigrationOriginals(userId),
    resume: job !== null && !imported,
  };
}

export function declineCloudMigration(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      userBaseKey(userId, DECLINED_BASE),
      JSON.stringify({ declinedAt: new Date().toISOString() })
    );
  } catch {
    // best effort
  }
}

async function loadLocalContents(
  userId: string,
  materials: Material[]
): Promise<
  | { ok: true; contents: Map<string, CloudMaterialContent>; hashes: Map<string, string> }
  | { ok: false; error: string }
> {
  const contents = new Map<string, CloudMaterialContent>();
  const hashes = new Map<string, string>();
  for (const material of materials) {
    const result = await loadOriginalMaterialContent(userId, material.id);
    if (result.status === 'error') {
      return { ok: false, error: `자료 본문을 읽지 못했습니다. (${material.id}: ${result.error})` };
    }
    const content: CloudMaterialContent =
      result.status === 'found'
        ? { markdown: result.content.markdown, rawText: result.content.rawText, pages: result.content.pages }
        : { markdown: material.parsedMarkdown ?? '', rawText: material.rawText, pages: material.pages };
    contents.set(material.id, content);
    hashes.set(material.id, materialContentHash(content));
  }
  return { ok: true, contents, hashes };
}

/**
 * Verifies the migration by checking target fields AND the actual stored body,
 * not merely that an id or a hash column exists.
 */
async function verifyMigration(
  localSubjects: Subject[],
  localMaterials: Material[],
  localHashes: Map<string, string>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const subjects = await listSubjects();
  if (!subjects.ok) return { ok: false, error: subjects.error };
  const subjectById = new Map(subjects.data.map((s) => [s.id, s]));
  for (const local of localSubjects) {
    const cloud = subjectById.get(local.id);
    if (!cloud) return { ok: false, error: `과목 ${local.id}가 서버에서 확인되지 않습니다.` };
    if (!subjectEquivalent(local, cloud)) {
      return { ok: false, error: `과목 ${local.id}의 필드가 원본과 다릅니다.` };
    }
  }

  const rows = await listMaterialRows();
  if (!rows.ok) return { ok: false, error: rows.error };
  const rowById = new Map(rows.data.map((row) => [row.id, row]));
  for (const local of localMaterials) {
    const row = rowById.get(local.id);
    if (!row) return { ok: false, error: `자료 ${local.id}가 서버에서 확인되지 않습니다.` };
    if (row.upload_state !== 'ready') {
      return { ok: false, error: `자료 ${local.id}가 아직 준비 상태가 아닙니다.` };
    }
    const expected = localHashes.get(local.id);
    if (!expected) return { ok: false, error: `자료 ${local.id}의 원본 해시가 없습니다.` };
    if (row.content_hash !== expected) {
      return { ok: false, error: `자료 ${local.id}의 본문 해시가 일치하지 않습니다.` };
    }
    const downloaded = await downloadMaterialContent(row);
    if (!downloaded.ok) {
      return { ok: false, error: `자료 ${local.id}의 본문을 확인하지 못했습니다: ${downloaded.error}` };
    }
    if (materialContentHash(downloaded.data) !== expected) {
      return { ok: false, error: `자료 ${local.id}의 저장된 본문이 원본과 다릅니다.` };
    }
  }
  return { ok: true };
}

function failure(
  message: string,
  resume: boolean,
  conflicts: MigrationConflict[] = [],
  partial = false
): CloudMigrationResult {
  return {
    ok: false,
    conflict: conflicts.length > 0,
    resume,
    partial,
    subjectsUploaded: 0,
    materialsUploaded: 0,
    conflicts,
    message,
  };
}

/**
 * Explicit, resumable migration of the CURRENT account's migration originals to
 * Supabase. Shared/unattributed records are never uploaded, local originals are
 * never deleted, and same-id/different-content is reported as a conflict.
 */
export async function migrateLocalLibraryToCloud(userId: string): Promise<CloudMigrationResult> {
  const storage = getStorage();
  if (!storage) return failure('브라우저 로컬 저장소를 사용할 수 없습니다.', false);

  try {
    if (storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null) {
      return {
        ok: true,
        conflict: false,
        resume: false,
        partial: false,
        subjectsUploaded: 0,
        materialsUploaded: 0,
        conflicts: [],
        message: '이미 클라우드 이전이 완료되었습니다.',
      };
    }
  } catch {
    return failure('완료 표시를 확인하지 못했습니다.', false);
  }

  const existingJob = readJob(storage, userId);
  const resuming = existingJob !== null;
  const now = new Date().toISOString();

  const originals = loadMigrationOriginals(userId);
  if (!originals.ok) {
    return failure(`로컬 원본을 읽지 못했습니다: ${originals.error}`, resuming);
  }
  const localSubjects = originals.subjects;
  const localMaterials = originals.materials;

  if (localSubjects.length === 0 && localMaterials.length === 0) {
    const marked = writeVerified(storage, userId, MARKER_BASE, {
      completed: true,
      completedAt: now,
      jobId: existingJob?.jobId ?? null,
      subjectsUploaded: 0,
      materialsUploaded: 0,
    });
    if (!marked) return failure('완료 표시를 저장하지 못했습니다. 다시 시도해 주세요.', resuming);
    return {
      ok: true,
      conflict: false,
      resume: resuming,
      partial: false,
      subjectsUploaded: 0,
      materialsUploaded: 0,
      conflicts: [],
      message: '이전할 로컬 과목·자료가 없습니다.',
    };
  }

  let job = existingJob;
  if (!job) {
    job = { jobId: generateJobId(), state: 'in_progress', startedAt: now, updatedAt: now };
    if (!writeVerified(storage, userId, JOB_BASE, job)) {
      return failure('이전 진행 상태를 저장하지 못해 시작하지 않았습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.', false);
    }
  }
  const jobId = job.jobId || null;

  const cloud = await loadCloudLibrary();
  if (!cloud.ok) return failure(`서버 데이터를 불러오지 못했습니다: ${cloud.error}`, resuming);

  const local = await loadLocalContents(userId, localMaterials);
  if (!local.ok) return failure(local.error, resuming);

  const rows = await listMaterialRows();
  if (!rows.ok) return failure(rows.error, resuming);

  const plan = planLocalMigration({
    localSubjects,
    localMaterials,
    cloudSubjects: cloud.data.subjects,
    cloudMaterials: cloud.data.materials,
    localContentHashes: local.hashes,
    cloudContentHashes: new Map(
      rows.data.filter((row) => row.content_hash).map((row) => [row.id, row.content_hash as string])
    ),
    cloudMaterialUploadStates: new Map(rows.data.map((row) => [row.id, row.upload_state])),
  });

  if (plan.conflicts.length > 0) {
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure(
      '같은 ID의 과목·자료가 서버에 다른 내용으로 있어 자동으로 덮어쓰지 않았습니다. 충돌 항목을 확인한 뒤 다시 시도해 주세요. 로컬 기록은 보존됩니다.',
      resuming,
      plan.conflicts
    );
  }

  let subjectsUploaded = 0;
  for (const subject of plan.subjects) {
    const result = await upsertSubject(subject);
    if (!result.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`과목 저장 실패: ${result.error}`, resuming);
    }
    subjectsUploaded += 1;
  }

  let materialsUploaded = 0;
  for (const material of plan.materials) {
    const content = local.contents.get(material.id) ?? { markdown: material.parsedMarkdown ?? '' };
    const result = await writeMaterial({ material, content });
    if (!result.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`자료 저장 실패: ${result.error}`, resuming);
    }
    materialsUploaded += 1;
  }

  const verified = await verifyMigration(localSubjects, localMaterials, local.hashes);
  if (!verified.ok) {
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure(`이전 검증 실패: ${verified.error}`, resuming);
  }

  const marked = writeVerified(storage, userId, MARKER_BASE, {
    completed: true,
    completedAt: new Date().toISOString(),
    jobId,
    subjectsUploaded,
    materialsUploaded,
  });
  if (!marked) {
    // Keep the job in progress so a retry re-verifies and writes the marker.
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure(
      '서버 이전은 완료됐지만 완료 표시를 저장하지 못했습니다. 다시 실행하면 검증 후 완료 표시를 다시 저장합니다.',
      resuming,
      [],
      true
    );
  }

  const jobCompleted = writeVerified(storage, userId, JOB_BASE, {
    ...job,
    state: 'completed',
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    conflict: false,
    resume: resuming,
    partial: !jobCompleted,
    subjectsUploaded,
    materialsUploaded,
    conflicts: [],
    message: jobCompleted
      ? `클라우드 이전 완료: 과목 ${subjectsUploaded}개, 자료 ${materialsUploaded}개. 로컬 원본은 그대로 보존됩니다.`
      : `클라우드 이전은 완료됐지만 작업 상태 저장을 확인하지 못했습니다. 완료 표시는 저장되었습니다.`,
  };
}
