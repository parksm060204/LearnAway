'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadStoredConceptDrafts,
  loadStoredConcepts,
  loadStoredProblemDrafts,
  loadStoredProblems,
} from '../storage';
import { setStorageScope } from '../storageScope';
import type { Concept, ConceptDraft, Problem, ProblemDraft, ProblemVersionSnapshot } from '../types';
import { loadLearningLibrary } from './learningLibrary';
import { loadLearningOriginals, recordMigratedIds } from './learningOriginals';
import { conceptIdentity, planLearningMigration, problemIdentity, type LearningConflict } from './learningPlan';
import {
  upsertConceptDraftsFull,
  upsertConcepts,
  upsertProblemDraftsFull,
  upsertProblems,
  upsertProblemVersions,
} from './learningRepository';

const USER_PREFIX = 'redcall_user_';
const JOB_BASE = 'cloud_learning_migration_job_v1';
const MARKER_BASE = 'cloud_learning_migration_v1';
const DECLINED_BASE = 'cloud_learning_migration_declined_v1';

interface LearningMigrationJob {
  jobId: string;
  state: 'in_progress' | 'completed';
  startedAt: string;
  updatedAt: string;
}

export interface LearningMigrationState {
  imported: boolean;
  declined: boolean;
  hasLocalData: boolean;
  resume: boolean;
}

export interface LearningMigrationResult {
  ok: boolean;
  conflict: boolean;
  resume: boolean;
  partial: boolean;
  uploaded: number;
  conflicts: LearningConflict[];
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

function readJob(storage: Storage, userId: string): LearningMigrationJob | null {
  try {
    const raw = storage.getItem(userBaseKey(userId, JOB_BASE));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LearningMigrationJob>;
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
  return `clm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readLocal(userId: string): {
  concepts: Concept[];
  conceptDrafts: ConceptDraft[];
  problems: Problem[];
  problemDrafts: ProblemDraft[];
} {
  // Prefer the preserved originals; fall back to the live scope before a
  // snapshot exists. Never read from the overwritable server cache.
  const originals = loadLearningOriginals(userId);
  if (originals.ok) return originals.data;
  setStorageScope({ kind: 'user', userId });
  return {
    concepts: loadStoredConcepts(),
    conceptDrafts: loadStoredConceptDrafts(),
    problems: loadStoredProblems(),
    problemDrafts: loadStoredProblemDrafts(),
  };
}

function hasSubjectsMaterialsMigrated(storage: Storage, userId: string): boolean {
  try {
    return storage.getItem(userBaseKey(userId, 'cloud_migration_v1')) !== null;
  } catch {
    return false;
  }
}

function problemSnapshots(problem: Problem): ProblemVersionSnapshot[] {
  if (problem.versionHistory && problem.versionHistory.length > 0) return problem.versionHistory;
  return [
    {
      version: problem.version ?? 1,
      title: problem.title,
      promptText: problem.promptText,
      type: problem.type,
      conceptIds: problem.conceptIds,
      appliedConditionNote: problem.appliedConditionNote,
      mathFormula: problem.mathFormula,
      codeSnippet: problem.codeSnippet,
      timeStandardMinutes: problem.timeStandardMinutes,
      hints: problem.hints,
      modelAnswer: problem.modelAnswer,
      rubric: problem.rubric,
      editedAt: problem.createdAt ?? new Date().toISOString(),
      editReason: 'migrated',
    },
  ];
}

export function getLearningMigrationState(userId: string): LearningMigrationState {
  const storage = getStorage();
  if (!storage) return { imported: false, declined: false, hasLocalData: false, resume: false };
  let imported = false;
  let declined = false;
  try {
    imported = storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null;
    declined = storage.getItem(userBaseKey(userId, DECLINED_BASE)) !== null;
  } catch {
    // ignore
  }
  let hasLocalData = false;
  try {
    const local = readLocal(userId);
    hasLocalData =
      local.concepts.length > 0 ||
      local.conceptDrafts.length > 0 ||
      local.problems.length > 0 ||
      local.problemDrafts.length > 0;
  } catch {
    hasLocalData = true;
  }
  const job = readJob(storage, userId);
  return { imported, declined, hasLocalData, resume: job !== null && !imported };
}

export function declineLearningMigration(userId: string): void {
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

async function verifyMigration(
  supabase: SupabaseClient,
  local: ReturnType<typeof readLocal>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cloud = await loadLearningLibrary(supabase);
  if (!cloud.ok) return { ok: false, error: cloud.error };
  const conceptById = new Map(cloud.data.concepts.map((c) => [c.id, c]));
  for (const concept of local.concepts) {
    const remote = conceptById.get(concept.id);
    if (!remote) return { ok: false, error: `개념 ${concept.id}가 서버에서 확인되지 않습니다.` };
    if (conceptIdentity(remote) !== conceptIdentity(concept)) {
      return { ok: false, error: `개념 ${concept.id}의 내용이 원본과 다릅니다.` };
    }
  }
  const problemById = new Map(cloud.data.problems.map((p) => [p.id, p]));
  for (const problem of local.problems) {
    const remote = problemById.get(problem.id);
    if (!remote) return { ok: false, error: `문제 ${problem.id}가 서버에서 확인되지 않습니다.` };
    if (problemIdentity(remote) !== problemIdentity(problem)) {
      return { ok: false, error: `문제 ${problem.id}의 평가 내용이 원본과 다릅니다.` };
    }
  }
  return { ok: true };
}

function failure(message: string, resume: boolean, conflicts: LearningConflict[] = [], partial = false): LearningMigrationResult {
  return { ok: false, conflict: conflicts.length > 0, resume, partial, uploaded: 0, conflicts, message };
}

/**
 * Explicit, resumable migration of the current account's local concepts,
 * drafts, problems and version history. Requires subjects/materials migration
 * to be complete first. Local originals are never deleted.
 */
export async function migrateLocalLearningToCloud(
  userId: string,
  supabase: SupabaseClient
): Promise<LearningMigrationResult> {
  const storage = getStorage();
  if (!storage) return failure('브라우저 로컬 저장소를 사용할 수 없습니다.', false);

  try {
    if (storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null) {
      return { ok: true, conflict: false, resume: false, partial: false, uploaded: 0, conflicts: [], message: '이미 학습 콘텐츠 이전이 완료되었습니다.' };
    }
  } catch {
    return failure('완료 표시를 확인하지 못했습니다.', false);
  }

  const existingJob = readJob(storage, userId);
  const resuming = existingJob !== null;
  const now = new Date().toISOString();

  const local = readLocal(userId);
  const localEmpty =
    local.concepts.length === 0 &&
    local.conceptDrafts.length === 0 &&
    local.problems.length === 0 &&
    local.problemDrafts.length === 0;

  if (localEmpty) {
    const marked = writeVerified(storage, userId, MARKER_BASE, {
      completed: true, completedAt: now, jobId: existingJob?.jobId ?? null, uploaded: 0,
    });
    if (!marked) return failure('완료 표시를 저장하지 못했습니다. 다시 시도해 주세요.', resuming);
    return { ok: true, conflict: false, resume: resuming, partial: false, uploaded: 0, conflicts: [], message: '이전할 로컬 학습 콘텐츠가 없습니다.' };
  }

  if (!hasSubjectsMaterialsMigrated(storage, userId)) {
    return failure('과목·자료 이전을 먼저 완료한 뒤 학습 콘텐츠를 이전해 주세요.', resuming);
  }

  let job = existingJob;
  if (!job) {
    job = { jobId: generateJobId(), state: 'in_progress', startedAt: now, updatedAt: now };
    if (!writeVerified(storage, userId, JOB_BASE, job)) {
      return failure('이전 진행 상태를 저장하지 못해 시작하지 않았습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.', false);
    }
  }

  const cloud = await loadLearningLibrary(supabase);
  if (!cloud.ok) return failure(`서버 학습 콘텐츠를 불러오지 못했습니다: ${cloud.error}`, resuming);

  const plan = planLearningMigration({
    localConcepts: local.concepts,
    localConceptDrafts: local.conceptDrafts,
    localProblems: local.problems,
    localProblemDrafts: local.problemDrafts,
    cloudConcepts: cloud.data.concepts,
    cloudConceptDrafts: cloud.data.conceptDrafts,
    cloudProblems: cloud.data.problems,
    cloudProblemDrafts: cloud.data.problemDrafts,
  });

  if (plan.conflicts.length > 0) {
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure('같은 ID의 학습 콘텐츠가 서버에 다른 내용으로 있어 자동으로 덮어쓰지 않았습니다. 충돌 항목을 확인한 뒤 다시 시도해 주세요.', resuming, plan.conflicts);
  }

  let uploaded = 0;

  if (plan.concepts.length > 0) {
    const conceptsToUpload = plan.concepts.map((concept) => ({ ...concept, events: [] }));
    const saved = await upsertConcepts(supabase, conceptsToUpload);
    if (!saved.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`개념 저장 실패: ${saved.error}`, resuming);
    }
    uploaded += saved.data.length;
  }

  if (plan.conceptDrafts.length > 0) {
    const saved = await upsertConceptDraftsFull(supabase, plan.conceptDrafts, job.jobId);
    if (!saved.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`개념 초안 저장 실패: ${saved.error}`, resuming);
    }
    uploaded += saved.data.length;
  }

  if (plan.problems.length > 0) {
    const saved = await upsertProblems(supabase, plan.problems);
    if (!saved.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`문제 저장 실패: ${saved.error}`, resuming);
    }
    uploaded += saved.data.length;
    for (const problem of plan.problems) {
      const versions = await upsertProblemVersions(supabase, problem.id, problem.subjectId, problemSnapshots(problem));
      if (!versions.ok) {
        writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
        return failure(`문제 버전 저장 실패: ${versions.error}`, resuming);
      }
    }
  }

  if (plan.problemDrafts.length > 0) {
    const saved = await upsertProblemDraftsFull(supabase, plan.problemDrafts, job.jobId);
    if (!saved.ok) {
      writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
      return failure(`문제 초안 저장 실패: ${saved.error}`, resuming);
    }
    uploaded += saved.data.length;
  }

  const verified = await verifyMigration(supabase, local);
  if (!verified.ok) {
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure(`이전 검증 실패: ${verified.error}`, resuming);
  }

  // These ids now live on the server; never show them as un-migrated again
  // (deleting them on the server must not resurrect them locally).
  recordMigratedIds(userId, [
    ...local.concepts, ...local.conceptDrafts, ...local.problems, ...local.problemDrafts,
  ].map((record) => record.id));

  const marked = writeVerified(storage, userId, MARKER_BASE, {
    completed: true, completedAt: new Date().toISOString(), jobId: job.jobId, uploaded,
  });
  if (!marked) {
    writeVerified(storage, userId, JOB_BASE, { ...job, updatedAt: new Date().toISOString() });
    return failure('서버 이전은 완료됐지만 완료 표시를 저장하지 못했습니다. 다시 실행하면 검증 후 완료 표시를 다시 저장합니다.', resuming, [], true);
  }

  const jobCompleted = writeVerified(storage, userId, JOB_BASE, { ...job, state: 'completed', updatedAt: new Date().toISOString() });
  return {
    ok: true,
    conflict: false,
    resume: resuming,
    partial: !jobCompleted,
    uploaded,
    conflicts: [],
    message: jobCompleted
      ? `학습 콘텐츠 이전 완료: ${uploaded}개 항목. 로컬 원본은 그대로 보존됩니다.`
      : `학습 콘텐츠 이전은 완료됐지만 작업 상태 저장을 확인하지 못했습니다. 완료 표시는 저장되었습니다.`,
  };
}
