/**
 * Account-scoped client persistence for recoverable task results when
 * AI generation succeeded but server persistence partially failed.
 *
 * Ensures:
 * 1. Account isolation (userId in key namespace)
 * 2. Survives page reload / refresh
 * 3. Cleared only upon verified save success with matching taskId
 * 4. Stored data contains signedRecoveryToken + recoveryData + inputSnapshot to retry save without AI re-invocation
 * 5. Handles taskType canonicalization & aliases ('review_problem_quality' vs 'problem_quality_review')
 * 6. Detects and reports localStorage write failures (e.g. QuotaExceededError)
 */

export type TaskRecoveryType =
  | 'logic_questions'
  | 'transfer_problem'
  | 'review_problem_quality'
  | 'problem_quality_review'
  | 'evaluate_answer';

export interface TaskRecoveryRecord<TInput = unknown, TData = unknown> {
  userId: string;
  taskType: TaskRecoveryType;
  taskId: string;
  signedRecoveryToken: string;
  recoveryData: TData;
  inputSnapshot?: TInput;
  inputVersion?: number;
  inputIdentifier?: string;
  savedAt: string;
  error?: string;
}

export function toCanonicalTaskType(type: TaskRecoveryType | string): TaskRecoveryType {
  if (type === 'problem_quality_review') return 'review_problem_quality';
  return type as TaskRecoveryType;
}

function getStorageKey(userId: string, taskType: string, contextKey: string): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeType = taskType.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeKey = contextKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `learnaway:recovery:${safeUser}:${safeType}:${safeKey}`;
}

export interface SaveTaskRecoveryResult {
  ok: boolean;
  error?: string;
  quotaExceeded?: boolean;
}

export function saveTaskRecovery<TInput = unknown, TData = unknown>(
  userId: string,
  taskType: TaskRecoveryType,
  contextKey: string,
  record: Omit<TaskRecoveryRecord<TInput, TData>, 'userId' | 'taskType' | 'savedAt'>
): SaveTaskRecoveryResult {
  if (typeof window === 'undefined' || !userId) {
    return { ok: false, error: '브라우저 환경이 아니거나 사용자 ID가 없습니다.' };
  }
  try {
    const canonical = toCanonicalTaskType(taskType);
    const fullRecord: TaskRecoveryRecord<TInput, TData> = {
      ...record,
      userId,
      taskType: canonical,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(getStorageKey(userId, canonical, contextKey), JSON.stringify(fullRecord));
    return { ok: true };
  } catch (e) {
    const isQuota =
      e instanceof Error &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    const msg = isQuota
      ? '브라우저 로컬 저장소 용량이 초과되어 복구 데이터를 저장하지 못했습니다.'
      : e instanceof Error
      ? e.message
      : '로컬 저장 실패';
    console.warn('Failed to save task recovery record to localStorage:', e);
    return { ok: false, error: msg, quotaExceeded: isQuota };
  }
}

export function getTaskRecovery<TInput = unknown, TData = unknown>(
  userId: string,
  taskType: TaskRecoveryType,
  contextKey: string
): TaskRecoveryRecord<TInput, TData> | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const canonical = toCanonicalTaskType(taskType);
    let raw = window.localStorage.getItem(getStorageKey(userId, canonical, contextKey));
    // If not found under canonical, check legacy alias
    if (!raw && canonical === 'review_problem_quality') {
      raw = window.localStorage.getItem(getStorageKey(userId, 'problem_quality_review', contextKey));
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TaskRecoveryRecord<TInput, TData>;
    if (!parsed || parsed.userId !== userId || !parsed.signedRecoveryToken) {
      return null;
    }
    const parsedCanonical = toCanonicalTaskType(parsed.taskType);
    if (parsedCanonical !== canonical) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTaskRecovery(
  userId: string,
  taskType: TaskRecoveryType,
  contextKey: string,
  expectedTaskId?: string
): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    const canonical = toCanonicalTaskType(taskType);
    const key = getStorageKey(userId, canonical, contextKey);
    let raw = window.localStorage.getItem(key);
    let actualKey = key;
    if (!raw && canonical === 'review_problem_quality') {
      const legacyKey = getStorageKey(userId, 'problem_quality_review', contextKey);
      raw = window.localStorage.getItem(legacyKey);
      if (raw) actualKey = legacyKey;
    }
    if (raw && expectedTaskId) {
      try {
        const parsed = JSON.parse(raw) as TaskRecoveryRecord;
        if (parsed && parsed.taskId && parsed.taskId !== expectedTaskId) {
          // Another newer request or another tab saved a different recovery task!
          // Do NOT delete the newer record!
          return false;
        }
      } catch {
        // parse failed, proceed to remove corrupted key
      }
    }
    window.localStorage.removeItem(actualKey);
    if (canonical === 'review_problem_quality') {
      window.localStorage.removeItem(getStorageKey(userId, 'problem_quality_review', contextKey));
    }
    return true;
  } catch (e) {
    console.warn('Failed to clear task recovery record from localStorage:', e);
    return false;
  }
}
