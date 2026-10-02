/**
 * Explicit opt-in import of the pre-login ("legacy") local records into a
 * signed-in user's local namespace.
 *
 * Recovery model (resume, never destructive):
 *  - A job record marks which account records were created by the import job.
 *  - The job record is written BEFORE copying; if it cannot be written, no copy
 *    starts, so there is never an untracked partial import.
 *  - A failed attempt keeps the job in progress. Retrying the same job verifies
 *    already-copied data against the legacy source, copies only what is missing,
 *    and then writes the completion marker.
 *  - User-owned records (no job, existing account data) are never overwritten or
 *    deleted; the import returns a conflict instead.
 *  - The target account scope is pinned from the userId for the whole run, so a
 *    mid-run account change cannot redirect data to another account.
 *
 * This only moves browser-local data. It does not upload anything to Supabase.
 */

import {
  importMaterialContentsFromScope,
  isMaterialImportVerified,
  listMaterialIdsInScope,
} from './materialStorage';
import { userIdToScopeId } from './storageScope';

const LEGACY_PREFIX = 'redcall_';
const USER_PREFIX = 'redcall_user_';
const MARKER_BASE = 'legacy_import_v1';
const DECLINED_BASE = 'legacy_import_declined_v1';
const JOB_BASE = 'legacy_import_job_v1';

/**
 * Record keys that belong to one account and reference each other by id
 * (materials/concepts/problems reference subjects, attempts reference concepts,
 * etc.). Import is only allowed when the target account has none of these, so a
 * partial merge can never leave dangling references.
 */
const OWNED_RECORD_BASES = new Set([
  'subjects_v1',
  'materials_v1',
  'concepts_v1',
  'concept_drafts_v1',
  'problems_v1',
  'problem_drafts_v1',
  'attempts_v1',
  'mock_exam_sessions_v1',
  'logic_sessions_v1',
  'rechallenge_reservations_v1',
  'study_plan_items_v1',
]);

interface LegacyImportJob {
  jobId: string;
  state: 'in_progress' | 'completed';
  startedAt: string;
  updatedAt: string;
}

export interface LegacyImportState {
  imported: boolean;
  declined: boolean;
  hasLegacyData: boolean;
  /** Target account has its own (non-job) records; import is not allowed. */
  conflict: boolean;
  /** An unfinished import job exists and can be resumed. */
  resume: boolean;
}

export interface LegacyImportResult {
  verified: boolean;
  /** Account-level conflict: refused without touching existing records. */
  conflict: boolean;
  /** Material bodies with the same id but different content were found. */
  materialConflict: boolean;
  /** Whether this run resumed an existing in-progress job. */
  resume: boolean;
  jobId: string | null;
  localStorageCopied: number;
  localStorageSkipped: number;
  materialsCopied: number;
  materialsSkipped: number;
  materialsFailed: number;
  materialsAvailable: boolean;
  message: string;
}

function userBaseKey(userId: string, base: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${base}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // access can throw in privacy mode
  }
  return null;
}

export function listLegacyStorageBases(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  const bases: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const rawKey = storage.key(i);
      if (!rawKey) continue;
      if (!rawKey.startsWith(LEGACY_PREFIX)) continue;
      if (rawKey.startsWith(USER_PREFIX)) continue;
      bases.push(rawKey.slice(LEGACY_PREFIX.length));
    }
  } catch {
    return [];
  }
  return bases;
}

export function hasLegacyLocalData(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return listLegacyStorageBases().some((base) => {
    try {
      return storage.getItem(`${LEGACY_PREFIX}${base}`) !== null;
    } catch {
      return false;
    }
  });
}

export function isLegacyImportCompleted(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null;
  } catch {
    return false;
  }
}

export function isLegacyImportDeclined(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, DECLINED_BASE)) !== null;
  } catch {
    return false;
  }
}

function readJob(storage: Storage, userId: string): LegacyImportJob | null {
  try {
    const raw = storage.getItem(userBaseKey(userId, JOB_BASE));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegacyImportJob>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.state !== 'in_progress' && parsed.state !== 'completed') return null;
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

function writeJob(storage: Storage, userId: string, job: LegacyImportJob): boolean {
  try {
    storage.setItem(userBaseKey(userId, JOB_BASE), JSON.stringify(job));
    return true;
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
    // fall through to a non-crypto id
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True when the given side already has its own account-owned records. */
function hasOwnedRecords(userId: string, side: 'legacy' | 'target'): boolean {
  const storage = getStorage();
  if (!storage) return false;
  const targetPrefix = userBaseKey(userId, '');
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const rawKey = storage.key(i);
      if (!rawKey) continue;
      if (side === 'legacy') {
        if (!rawKey.startsWith(LEGACY_PREFIX) || rawKey.startsWith(USER_PREFIX)) continue;
        if (OWNED_RECORD_BASES.has(rawKey.slice(LEGACY_PREFIX.length))) return true;
      } else {
        if (!rawKey.startsWith(targetPrefix)) continue;
        if (OWNED_RECORD_BASES.has(rawKey.slice(targetPrefix.length))) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function getLegacyImportState(userId: string): Promise<LegacyImportState> {
  const storage = getStorage();
  const imported = isLegacyImportCompleted(userId);
  const declined = isLegacyImportDeclined(userId);
  const job = storage ? readJob(storage, userId) : null;
  const resume = Boolean(job) && !imported;
  const localData = hasLegacyLocalData();
  let hasMaterialData = false;
  if (!localData) {
    const ids = await listMaterialIdsInScope('shared');
    hasMaterialData = Boolean(ids && ids.length > 0);
  }
  const conflict = !resume && hasOwnedRecords(userId, 'target');
  return {
    imported,
    declined,
    hasLegacyData: localData || hasMaterialData || resume,
    conflict,
    resume,
  };
}

export function declineLegacyImport(userId: string): void {
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

function baseResult(): Pick<
  LegacyImportResult,
  | 'conflict'
  | 'materialConflict'
  | 'resume'
  | 'jobId'
  | 'localStorageCopied'
  | 'localStorageSkipped'
  | 'materialsCopied'
  | 'materialsSkipped'
  | 'materialsFailed'
  | 'materialsAvailable'
> {
  return {
    conflict: false,
    materialConflict: false,
    resume: false,
    jobId: null,
    localStorageCopied: 0,
    localStorageSkipped: 0,
    materialsCopied: 0,
    materialsSkipped: 0,
    materialsFailed: 0,
    materialsAvailable: false,
  };
}

function conflictResult(
  resume: boolean,
  jobId: string | null,
  reason: 'account' | 'resume-mismatch'
): LegacyImportResult {
  return {
    verified: false,
    ...baseResult(),
    conflict: true,
    resume,
    jobId,
    materialsAvailable: true,
    message:
      reason === 'account'
        ? '이미 이 계정에 학습 기록이 있어 기존 공용 기록을 자동으로 가져올 수 없습니다. 자동 병합은 하지 않으며, 현재 계정 기록은 그대로 유지됩니다.'
        : '이전 가져오기 작업이 만든 기록과 원본 공용 기록 또는 현재 계정 기록이 일치하지 않습니다. 자동으로 덮어쓰거나 삭제하지 않았습니다.',
  };
}

function failureMessage(
  localStorageFailed: number,
  materialConflict: boolean,
  materials: { error?: string }
): string {
  if (materialConflict) {
    return '같은 ID의 자료 본문 내용이 달라 자동으로 덮어쓰지 않았습니다. 충돌한 자료를 확인한 뒤 다시 가져오기를 실행하면 이어서 진행합니다. 완료 표시는 저장하지 않았습니다.';
  }
  if (localStorageFailed > 0) {
    return '일부 기록을 저장하지 못해 가져오기를 완료하지 못했습니다. 완료 표시는 저장하지 않았으며, 다시 가져오기를 실행하면 남은 기록만 이어서 복사합니다. 원본 공용 기록은 그대로 보존됩니다.';
  }
  return `자료 본문 일부를 복사하거나 검증하지 못했습니다. 완료 표시는 저장하지 않았으며, 다시 가져오기를 실행하면 이어서 진행합니다. (${materials.error ?? '자료 저장소 오류'})`;
}

export async function importLegacyData(userId: string): Promise<LegacyImportResult> {
  const storage = getStorage();
  if (!storage) {
    return {
      verified: false,
      ...baseResult(),
      message: '브라우저 로컬 저장소를 사용할 수 없어 가져오기를 진행하지 못했습니다.',
    };
  }

  // Already completed: no-op, never duplicates records.
  if (isLegacyImportCompleted(userId)) {
    return {
      verified: true,
      ...baseResult(),
      materialsAvailable: true,
      message: '기존 학습 기록 가져오기가 이미 완료되었습니다.',
    };
  }

  const existingJob = readJob(storage, userId);
  const resuming = existingJob !== null;
  const now = new Date().toISOString();
  const targetScopeId = userIdToScopeId(userId);

  // New jobs require an account that has no user records; a resume may only
  // proceed if the existing records match the legacy source (verified below).
  if (!resuming && hasOwnedRecords(userId, 'target')) {
    return conflictResult(false, null, 'account');
  }

  let job: LegacyImportJob | null = existingJob;
  if (!job) {
    job = { jobId: generateJobId(), state: 'in_progress', startedAt: now, updatedAt: now };
    if (!writeJob(storage, userId, job)) {
      // Without a progress record we must not start copying.
      return {
        verified: false,
        ...baseResult(),
        materialsAvailable: true,
        message:
          '가져오기 진행 상태를 저장하지 못해 복사를 시작하지 않았습니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.',
      };
    }
  }
  const jobId = job.jobId || null;

  // Snapshot the legacy source.
  const legacyValues = new Map<string, string>();
  for (const base of listLegacyStorageBases()) {
    try {
      const value = storage.getItem(`${LEGACY_PREFIX}${base}`);
      if (value !== null) legacyValues.set(base, value);
    } catch {
      // unreadable legacy key: skip
    }
  }

  // In resume mode, every existing target record must be one this job created
  // (i.e. byte-identical to the legacy source). Anything else is a conflict and
  // is never overwritten.
  const targetPrefix = userBaseKey(userId, '');
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const rawKey = storage.key(i);
      if (!rawKey || !rawKey.startsWith(targetPrefix)) continue;
      const base = rawKey.slice(targetPrefix.length);
      if (!OWNED_RECORD_BASES.has(base)) continue;
      const legacyValue = legacyValues.get(base);
      if (legacyValue === undefined) {
        return conflictResult(true, jobId, 'resume-mismatch');
      }
      let targetValue: string | null = null;
      try {
        targetValue = storage.getItem(rawKey);
      } catch {
        targetValue = null;
      }
      if (targetValue !== legacyValue) {
        return conflictResult(true, jobId, 'resume-mismatch');
      }
    }
  } catch {
    // If the target cannot be inspected, refuse rather than risk a bad merge.
    return conflictResult(true, jobId, 'resume-mismatch');
  }

  let localStorageCopied = 0;
  let localStorageSkipped = 0;
  let localStorageFailed = 0;

  for (const [base, value] of legacyValues) {
    const targetKey = userBaseKey(userId, base);
    let targetValue: string | null = null;
    try {
      targetValue = storage.getItem(targetKey);
    } catch {
      targetValue = null;
    }
    if (targetValue === value) {
      localStorageSkipped += 1;
      continue;
    }
    try {
      storage.setItem(targetKey, value);
      localStorageCopied += 1;
    } catch {
      localStorageFailed += 1;
    }
  }

  // Target scope pinned at job start; account changes cannot redirect bodies.
  const materials = await importMaterialContentsFromScope('shared', targetScopeId);

  let localVerified = localStorageFailed === 0;
  for (const [base, value] of legacyValues) {
    let targetValue: string | null = null;
    try {
      targetValue = storage.getItem(userBaseKey(userId, base));
    } catch {
      targetValue = null;
    }
    if (targetValue !== value) {
      localVerified = false;
      break;
    }
  }

  const materialsVerified = isMaterialImportVerified(materials);
  const materialConflict = materials.conflicts > 0;
  const verified = localVerified && materialsVerified;

  if (!verified) {
    // Keep the job in progress so the next attempt resumes; never delete data.
    writeJob(storage, userId, { ...job, updatedAt: new Date().toISOString() });
    return {
      verified: false,
      ...baseResult(),
      resume: resuming,
      jobId,
      localStorageCopied,
      localStorageSkipped,
      materialsCopied: materials.copied,
      materialsSkipped: materials.skipped,
      materialsFailed: materials.failed,
      materialsAvailable: materials.available,
      materialConflict,
      message: failureMessage(localStorageFailed, materialConflict, materials),
    };
  }

  try {
    storage.setItem(
      userBaseKey(userId, MARKER_BASE),
      JSON.stringify({
        completed: true,
        completedAt: new Date().toISOString(),
        jobId,
        localStorageCopied,
        materialsCopied: materials.copied,
      })
    );
  } catch {
    // Data is fully copied and verified, but completion could not be recorded.
    // Keep the job so a retry only re-writes the marker.
    writeJob(storage, userId, { ...job, updatedAt: new Date().toISOString() });
    return {
      verified: false,
      ...baseResult(),
      resume: resuming,
      jobId,
      localStorageCopied,
      localStorageSkipped,
      materialsCopied: materials.copied,
      materialsSkipped: materials.skipped,
      materialsFailed: materials.failed,
      materialsAvailable: materials.available,
      message:
        '기록 복사와 검증은 끝났지만 완료 표시를 저장하지 못했습니다. 다시 가져오기를 실행하면 같은 작업을 이어서 완료 표시를 다시 저장합니다. 기록은 보존됩니다.',
    };
  }

  writeJob(storage, userId, { ...job, state: 'completed', updatedAt: new Date().toISOString() });

  return {
    verified: true,
    ...baseResult(),
    resume: resuming,
    jobId,
    localStorageCopied,
    localStorageSkipped,
    materialsCopied: materials.copied,
    materialsSkipped: materials.skipped,
    materialsFailed: materials.failed,
    materialsAvailable: materials.available,
    message: resuming
      ? `기존 학습 기록 가져오기를 이어서 완료했습니다. (추가 항목 ${localStorageCopied}개, 자료 본문 ${materials.copied}개)`
      : `기존 학습 기록을 가져왔습니다. (항목 ${localStorageCopied}개, 자료 본문 ${materials.copied}개)`,
  };
}
