/**
 * Account-scoped client persistence for recoverable task results when
 * AI generation succeeded but server persistence partially failed.
 *
 * Ensures:
 * 1. Account isolation (userId in key namespace)
 * 2. Survives page reload / refresh
 * 3. Cleared only upon verified save success
 * 4. Stored data contains signedRecoveryToken + recoveryData to retry save without AI re-invocation
 */

export interface TaskRecoveryRecord {
  userId: string;
  taskType: 'logic_questions' | 'transfer_problem' | 'problem_quality_review' | 'evaluate_answer';
  taskId: string;
  signedRecoveryToken: string;
  recoveryData: unknown;
  savedAt: string;
  error?: string;
}

function getStorageKey(userId: string, taskType: string, contextKey: string): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeType = taskType.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeKey = contextKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `learnaway:recovery:${safeUser}:${safeType}:${safeKey}`;
}

export function saveTaskRecovery(
  userId: string,
  taskType: TaskRecoveryRecord['taskType'],
  contextKey: string,
  record: Omit<TaskRecoveryRecord, 'userId' | 'taskType' | 'savedAt'>
): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const fullRecord: TaskRecoveryRecord = {
      ...record,
      userId,
      taskType,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(getStorageKey(userId, taskType, contextKey), JSON.stringify(fullRecord));
  } catch (e) {
    console.warn('Failed to save task recovery record to localStorage:', e);
  }
}

export function getTaskRecovery(
  userId: string,
  taskType: TaskRecoveryRecord['taskType'],
  contextKey: string
): TaskRecoveryRecord | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId, taskType, contextKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TaskRecoveryRecord;
    if (!parsed || parsed.userId !== userId || parsed.taskType !== taskType || !parsed.signedRecoveryToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTaskRecovery(
  userId: string,
  taskType: TaskRecoveryRecord['taskType'],
  contextKey: string
): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(getStorageKey(userId, taskType, contextKey));
  } catch (e) {
    console.warn('Failed to clear task recovery record from localStorage:', e);
  }
}
