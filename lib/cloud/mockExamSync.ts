'use client';

import type { Attempt, MockExamSession, ReviewEvent } from '../types';
import { isSupabaseConfigured } from '../supabase/config';
import { createClient } from '../supabase/client';
import {
  answerFieldsEqual,
  pendingDiffersFrom,
  type PendingExamAnswers,
  type PendingStorageReadFailureReason,
  type PendingStorageReadResult,
} from './pendingExamAnswers';
import {
  getMockExamSession,
  saveMockExamGrading,
  saveMockExamAnswers,
  submitAttempt,
  submitMockExam,
} from './historyRepository';

export type MockExamSyncCode =
  | 'stale'
  | 'locked'
  | 'missing'
  | 'conflict'
  | 'not_configured'
  | 'error';
export type MockExamSyncStatus = 'submitted' | 'graded' | 'recorded';

export type MockExamSyncResult =
  | { ok: true; version: number }
  | { ok: false; code: MockExamSyncCode };

export type MockExamCreateResult =
  | { ok: true; created: boolean; version: number }
  | { ok: false; code: MockExamSyncCode; server?: MockExamSession };

export type MockExamFetchResult =
  | { ok: true; session: MockExamSession; version: number }
  | { ok: false; code: MockExamSyncCode };

function client() {
  return isSupabaseConfigured() ? createClient() : null;
}

function classify(error: string): MockExamSyncCode {
  const code = error.split(':')[0];
  if (code === 'stale' || code === 'locked' || code === 'missing') return code;
  if (error === 'MOCK_SESSION_NOT_FOUND' || error.includes('MOCK_SESSION_NOT_FOUND')) return 'missing';
  if (error.includes('MOCK_SESSION_STATUS_REGRESSION')) return 'locked';
  return 'error';
}

/** True when the local and server session carry the same answers + status. */
function sameContent(local: MockExamSession, server: MockExamSession): boolean {
  return (
    local.status === server.status &&
    JSON.stringify(local.answers ?? {}) === JSON.stringify(server.answers ?? {})
  );
}

/**
 * Compares the full reconcile snapshot (status, answers, method-reason fields
 * and evaluations). A server snapshot is applied as one consistent unit; this
 * only decides whether anything actually changed for the user notification.
 */
export function examSnapshotEqual(a: MockExamSession, b: MockExamSession): boolean {
  return (
    a.status === b.status &&
    JSON.stringify(a.answers ?? {}) === JSON.stringify(b.answers ?? {}) &&
    JSON.stringify(a.reasons ?? {}) === JSON.stringify(b.reasons ?? {}) &&
    JSON.stringify(a.isReasonNotApplicable ?? {}) === JSON.stringify(b.isReasonNotApplicable ?? {}) &&
    JSON.stringify(a.reasonNotApplicableJustification ?? {}) ===
      JSON.stringify(b.reasonNotApplicableJustification ?? {}) &&
    JSON.stringify(a.evaluations ?? {}) === JSON.stringify(b.evaluations ?? {})
  );
}

export interface ReconcilePlan {
  /** The server snapshot should be adopted as the working copy. */
  applyServer: true;
  /** Real unsaved local changes exist and must be kept separately. */
  unsaved: boolean;
  /** The pending entry is based on a DIFFERENT server version (needs confirmation). */
  stale: boolean;
  /** The pending entry may be discarded without data loss. */
  clearPending: boolean;
  /** Whether to tell the user that the server copy changed. */
  notify: boolean;
}

/**
 * Decides what to do when the server snapshot arrives.
 *
 * Any pending entry that actually DIFFERS from the server is preserved
 * (unsaved), regardless of its base version: answers based on an older server
 * version are never merged or auto-saved without explicit user confirmation.
 * Only a pending entry that no longer differs (or is absent) is safe to drop.
 */
export function planReconcile(
  local: MockExamSession | null,
  server: MockExamSession,
  version: number,
  pending: PendingExamAnswers | null
): ReconcilePlan {
  if (pending && pendingDiffersFrom(server, pending)) {
    return {
      applyServer: true,
      unsaved: true,
      stale: pending.baseVersion !== version,
      clearPending: false,
      notify: true,
    };
  }
  const changed = !local || !examSnapshotEqual(local, server);
  return { applyServer: true, unsaved: false, stale: false, clearPending: Boolean(pending), notify: changed };
}

/**
 * Optimum answer-identity comparison for an expired exam opened by URL: the
 * answer-bearing fields only (status/evaluations are separate).
 */
export function examAnswersEqual(a: MockExamSession, b: MockExamSession): boolean {
  return (
    JSON.stringify(a.answers ?? {}) === JSON.stringify(b.answers ?? {}) &&
    JSON.stringify(a.reasons ?? {}) === JSON.stringify(b.reasons ?? {}) &&
    JSON.stringify(a.isReasonNotApplicable ?? {}) === JSON.stringify(b.isReasonNotApplicable ?? {}) &&
    JSON.stringify(a.reasonNotApplicableJustification ?? {}) ===
      JSON.stringify(b.reasonNotApplicableJustification ?? {})
  );
}

export interface ExpiredOpenPlan {
  /** The server already holds a terminal state: never submit over it. */
  serverTerminal: boolean;
  /** The local expired answers differ from the server snapshot: explicit choice required. */
  conflict: boolean;
}

/**
 * Decides what an expired exam opened via URL means. The local and server
 * snapshots are compared as whole units; a differing local answer set is a
 * conflict that must be resolved explicitly, never overwritten by a plain
 * "submit".
 */
export function planExpiredOpen(local: MockExamSession, server: MockExamSession): ExpiredOpenPlan {
  const serverTerminal = server.status !== 'in_progress';
  return { serverTerminal, conflict: !serverTerminal && !examAnswersEqual(local, server) };
}

export type ExpiredSubmitDecision =
  | { action: 'blocked_conflict' }
  | { action: 'submit'; expectedVersion: number };

/**
 * A plain submit decision for an expired exam. While a conflict is unresolved
 * it is BLOCKED (the user must compare and choose first); otherwise it submits
 * using the server version confirmed at the time of comparison (so a server
 * change in between is caught as stale).
 */
export function decideExpiredSubmit(
  plan: ExpiredOpenPlan,
  serverVersion: number
): ExpiredSubmitDecision {
  if (plan.conflict || plan.serverTerminal) return { action: 'blocked_conflict' };
  return { action: 'submit', expectedVersion: serverVersion };
}

/**
 * Whether the deadline policy may auto-submit an expiry transition.
 *
 * A session opened while ALREADY expired (typically via a deep link) must
 * never auto-submit from interval ticks or keystroke saves: every submit there
 * needs an explicit user action. A session that was genuinely running stays on
 * the normal deadline-auto-submit path.
 */
export function shouldAutoSubmitExpired(input: {
  deferExpiredSubmit: boolean;
  expiredAtOpen: boolean;
}): boolean {
  return !(input.deferExpiredSubmit && input.expiredAtOpen);
}

/**
 * Resolves which server version the local expired answers were written
 * against: the pending snapshot's base first (it proves what the user typed),
 * then the session's own server version, then the last confirmed version.
 */
export function resolveLocalBaseVersion(input: {
  pendingBaseVersion?: number;
  sessionServerVersion?: number;
  lastKnownVersion: number;
}): number {
  if (typeof input.pendingBaseVersion === 'number') return input.pendingBaseVersion;
  if (typeof input.sessionServerVersion === 'number') return input.sessionServerVersion;
  return input.lastKnownVersion;
}

export interface ExpiredUrlOpenDecision {
  /** The local expired answers differ from the server snapshot. */
  conflict: boolean;
  /** Server version confirmed at comparison time (submit guard). */
  confirmedVersion: number;
  /** Server version the preserved local answers were written against. */
  localBaseVersion: number;
}

/**
 * The exact mapping a URL-opened expired exam performs: resolve the local
 * base version, confirm the server version, and compare the answer sets as one
 * unit. Callers MUST use all three outputs (conflict gate, submit guard,
 * archive stamp) so none of them can silently fall back to a default.
 */
export function planExpiredUrlOpen(input: {
  local: MockExamSession;
  server: MockExamSession;
  serverVersion: number;
  localBaseVersion: number;
}): ExpiredUrlOpenDecision {
  const plan = planExpiredOpen(input.local, input.server);
  return {
    conflict: plan.conflict,
    confirmedVersion: input.serverVersion,
    localBaseVersion: input.localBaseVersion,
  };
}

/**
 * Creates a mock exam on the server insert-only. If the id already exists the
 * server row is returned: identical content is an idempotent success, differing
 * content is a `conflict` (never overwritten). Retries/migration cannot reset a
 * submitted exam's answers, status or version.
 */
export async function createMockExamOnServer(
  session: MockExamSession
): Promise<MockExamCreateResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  try {
    const { data, error } = await supabase.rpc('create_mock_exam_session', {
      p_payload: session as unknown as Record<string, unknown>,
    });
    if (error) return { ok: false, code: classify(error.message) };
    const result = (data ?? {}) as Record<string, unknown>;
    const version = Number(result.version ?? 1);
    if (result.created) return { ok: true, created: true, version };
    const payload = (result.payload ?? {}) as Partial<MockExamSession>;
    const server: MockExamSession = {
      ...(payload as MockExamSession),
      id: session.id,
      status: (result.status as MockExamSession['status']) ?? payload.status ?? 'in_progress',
      serverVersion: version,
    };
    if (sameContent(session, server)) return { ok: true, created: false, version };
    return { ok: false, code: 'conflict', server };
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.message.includes('not configured') ? 'not_configured' : 'error' };
  }
}

/** Debounced autosave of in-progress answers, guarded by the server version. */
export async function autosaveMockExam(
  session: MockExamSession,
  expectedVersion: number
): Promise<MockExamSyncResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await saveMockExamAnswers(supabase, session, expectedVersion);
  return result.ok ? { ok: true, version: result.data } : { ok: false, code: classify(result.error) };
}

/** Persists grading / recorded progress (never back to in_progress). */
export async function saveMockExamGradingOnServer(
  session: MockExamSession,
  expectedVersion: number,
  status: MockExamSyncStatus
): Promise<MockExamSyncResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await saveMockExamGrading(supabase, session, expectedVersion, status);
  return result.ok ? { ok: true, version: result.data } : { ok: false, code: classify(result.error) };
}

/** Final submit; idempotent so a retry after a dropped response is safe. */
export async function submitMockExamOnServer(
  session: MockExamSession,
  expectedVersion: number
): Promise<MockExamSyncResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await submitMockExam(supabase, session, expectedVersion);
  return result.ok
    ? { ok: true, version: result.data.version }
    : { ok: false, code: classify(result.error) };
}

/**
 * Reads the authoritative server session (answers) AND its version from one
 * query, so a conflict can be resolved without applying a stale local answer
 * set to a newer server version.
 */
export async function fetchMockExamFromServer(
  sessionId: string
): Promise<MockExamFetchResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await getMockExamSession(supabase, sessionId);
  if (!result.ok) return { ok: false, code: classify(result.error) };
  if (!result.data) return { ok: false, code: 'missing' };
  return {
    ok: true,
    session: result.data,
    version: result.data.serverVersion ?? 1,
  };
}

export type ServerSnapshotAdoptionDecision =
  | { adopt: true; pending: PendingExamAnswers | null }
  | { adopt: false; reason: PendingStorageReadFailureReason; error: string };

/**
 * Guards server snapshot adoption on verifying the local pending store first.
 * If reading the pending store failed or found corrupt data, the caller MUST
 * keep the existing in-memory/cache session and version untouched.
 */
export function decideServerSnapshotAdoption(
  pendingRead: PendingStorageReadResult<PendingExamAnswers> | null
): ServerSnapshotAdoptionDecision {
  if (pendingRead && !pendingRead.ok) {
    return { adopt: false, reason: pendingRead.reason, error: pendingRead.error };
  }
  return { adopt: true, pending: pendingRead?.value ?? null };
}

export type FailedExamSaveOp =
  | null
  | { kind: 'autosave' }
  | { kind: 'submit'; session: MockExamSession }
  | { kind: 'grading'; status: MockExamSyncStatus }
  | { kind: 'record_attempts' }
  | { kind: 'record_finalize'; session: MockExamSession };

export type ExamSaveRetryAction =
  | null
  | { kind: 'autosave'; session: MockExamSession }
  | { kind: 'submit'; session: MockExamSession }
  | { kind: 'grading'; session: MockExamSession; status: MockExamSyncStatus }
  | { kind: 'record_attempts'; session: MockExamSession }
  | { kind: 'record_finalize'; session: MockExamSession };

/**
 * Resolves the exact retry action from the tracked failed operation so a
 * failed submit or failed attempt-recording is never silently replaced by a
 * grading RPC.
 */
export function resolveExamSaveRetry(
  failedOp: FailedExamSaveOp,
  currentSession: MockExamSession | null
): ExamSaveRetryAction {
  if (!failedOp || !currentSession) return null;
  switch (failedOp.kind) {
    case 'autosave':
      return { kind: 'autosave', session: currentSession };
    case 'submit':
      return { kind: 'submit', session: failedOp.session };
    case 'grading':
      return { kind: 'grading', session: currentSession, status: failedOp.status };
    case 'record_attempts':
      return { kind: 'record_attempts', session: currentSession };
    case 'record_finalize':
      return { kind: 'record_finalize', session: failedOp.session };
  }
}

export interface ResolveFromServerDeps {
  sessionId: string;
  getCurrentLocal: () => MockExamSession | null;
  getInputGen?: () => number;
  userId: string;
  hadPendingReadFailure: boolean;
  requestGen: number;
  getCurrentRequestGen: () => number;
  isStillValid: () => boolean;
  fetchServer: (sessionId: string) => Promise<MockExamFetchResult>;
  readPending: (userId: string, sessionId: string) => PendingStorageReadResult<PendingExamAnswers>;
  savePending: (userId: string, session: MockExamSession, baseVersion?: number) => boolean;
  flushAutosaveTimer: () => void;
  applySnapshot: (session: MockExamSession) => void;
  setServerVersion: (version: number) => void;
  setSyncBlocked: (blocked: boolean) => void;
  setSaveState: (state: 'idle' | 'saving' | 'saved' | 'error' | 'conflict') => void;
  setFailedSaveOp: (op: FailedExamSaveOp) => void;
  setPendingAvailable: (available: boolean) => void;
  setPendingReadFailed: (failed: boolean) => void;
  setSyncNotice: (notice: string) => void;
}

/**
 * Orchestrates explicit server refresh (`resolveFromServer`) with pre- and
 * post-await scope/generation checks, pending-read verification BEFORE adopting
 * server state, and preservation of the LATEST in-memory edits (`getCurrentLocal`)
 * including edits typed while `fetchServer` is in flight.
 */
export async function executeResolveFromServer(deps: ResolveFromServerDeps): Promise<void> {
  if (!deps.isStillValid() || deps.requestGen !== deps.getCurrentRequestGen()) return;
  deps.flushAutosaveTimer();
  const inputGenAtStart = deps.getInputGen?.() ?? 0;
  const localAtStart = deps.getCurrentLocal();

  const result = await deps.fetchServer(deps.sessionId);
  if (!deps.isStillValid() || deps.requestGen !== deps.getCurrentRequestGen()) return;
  if (!result.ok) {
    deps.setSyncNotice('서버 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  const latestLocal = deps.getCurrentLocal();
  const inputGenAfter = deps.getInputGen?.() ?? 0;
  const typedDuringFetch =
    inputGenAfter !== inputGenAtStart ||
    (localAtStart !== null &&
      latestLocal !== null &&
      localAtStart.id === deps.sessionId &&
      latestLocal.id === deps.sessionId &&
      !answerFieldsEqual(localAtStart, latestLocal));

  const pendingRead = deps.userId ? deps.readPending(deps.userId, deps.sessionId) : null;
  const adoption = decideServerSnapshotAdoption(pendingRead);
  if (!adoption.adopt) {
    deps.flushAutosaveTimer();
    deps.setPendingAvailable(true);
    deps.setPendingReadFailed(true);
    deps.setSyncBlocked(true);
    deps.setSyncNotice(
      `기기의 미저장 답안을 읽지 못했습니다(${adoption.error}). 기존 로컬 데이터를 보존하기 위해 서버 답안을 적용하지 않았습니다.`
    );
    return;
  }

  deps.setPendingReadFailed(false);
  let pending = adoption.pending;

  // Preserve latest in-memory edits (`latestLocal`) whenever storage was
  // unreadable OR the user typed new edits while `fetchServer` was in flight.
  // An untouched old server cache (`!hadPendingReadFailure && !typedDuringFetch`)
  // is NOT falsely treated as unsaved when `pending` is empty.
  const hasUnsavedInMemoryEdits =
    (deps.hadPendingReadFailure || typedDuringFetch) &&
    latestLocal !== null &&
    latestLocal.id === deps.sessionId &&
    latestLocal.status === 'in_progress' &&
    !answerFieldsEqual(latestLocal, result.session);

  if (hasUnsavedInMemoryEdits && deps.userId && latestLocal) {
    const saved = deps.savePending(deps.userId, latestLocal, result.version);
    const reloaded = saved ? deps.readPending(deps.userId, deps.sessionId) : null;
    if (!saved || !reloaded || !reloaded.ok || !reloaded.value || pendingDiffersFrom(latestLocal, reloaded.value)) {
      deps.flushAutosaveTimer();
      deps.setPendingAvailable(true);
      deps.setSyncBlocked(true);
      deps.setSyncNotice(
        '메모리에 있던 최신 답안을 기기에 보존하지 못해 서버 답안을 적용하지 않았습니다. 다시 시도해 주세요.'
      );
      return;
    }
    pending = reloaded.value;
  }

  const hasPendingDiff = Boolean(pending && pendingDiffersFrom(result.session, pending));

  // Cancel any autosave timer (including one scheduled by typing during fetchServer)
  // BEFORE adopting the server snapshot so a queued/timer autosave never writes `S`
  // back to the server and clears pending `L2`.
  deps.flushAutosaveTimer();
  deps.applySnapshot(result.session);
  deps.setServerVersion(result.version);

  if (hasUnsavedInMemoryEdits || hasPendingDiff) {
    deps.setSyncBlocked(true);
    deps.setSaveState('saved');
    deps.setFailedSaveOp(null);
    deps.setPendingAvailable(true);
    deps.setSyncNotice(
      hasUnsavedInMemoryEdits
        ? '서버의 최신 기록을 불러왔습니다. 이 기기에서 입력 중이던 최신 답안은 미저장 영역에 보존되어 복구할 수 있습니다.'
        : result.session.status === 'in_progress'
        ? '서버의 최신 기록을 불러왔습니다. 미저장 답안은 별도로 보존되어 복구할 수 있습니다.'
        : '서버에서 이미 제출되어 종료된 시험입니다. 미저장 답안은 제출 답안과 별도로 보존됩니다.'
    );
    return;
  }

  deps.setSyncBlocked(false);
  deps.setSaveState('saved');
  deps.setFailedSaveOp(null);
  deps.setPendingAvailable(Boolean(pending));
  deps.setSyncNotice('서버의 최신 기록으로 동기화했습니다.');
}

export interface FinalizeRecordedDeps {
  recordedSession: MockExamSession;
  getExpectedVersion: () => number;
  isStillValid: () => boolean;
  saveGradingServer: (
    session: MockExamSession,
    expectedVersion: number,
    status: MockExamSyncStatus
  ) => Promise<MockExamSyncResult>;
  applyRecordedLocal: (session: MockExamSession) => void;
  setServerVersion: (version: number) => void;
  setSyncBlocked: (blocked: boolean) => void;
  setSaveState: (state: 'idle' | 'saving' | 'saved' | 'error' | 'conflict') => void;
  setSaveMessage: (msg: string) => void;
  setFailedSaveOp: (op: FailedExamSaveOp) => void;
  setError: (err: string) => void;
  setSyncNotice: (notice: string) => void;
  clearArchiveAfterConfirm: (sessionId: string) => boolean;
  onExamRecorded: () => void;
}

/**
 * Awaits the authoritative `save_mock_exam_grading(..., 'recorded')` RPC
 * BEFORE transitioning the local session to `'recorded'`, clearing conflict
 * archives, or closing the modal via `onExamRecorded`.
 */
export async function finalizeRecordedExamOnServer(deps: FinalizeRecordedDeps): Promise<boolean> {
  if (!deps.isStillValid()) return false;
  deps.setSaveState('saving');
  const result = await deps.saveGradingServer(
    deps.recordedSession,
    deps.getExpectedVersion(),
    'recorded'
  );
  if (!deps.isStillValid()) return false;

  if (result.ok) {
    deps.setServerVersion(result.version);
    deps.setSyncBlocked(false);
    deps.applyRecordedLocal(deps.recordedSession);
    deps.setSaveState('saved');
    deps.setSaveMessage('');
    deps.setFailedSaveOp(null);
    deps.setSyncNotice('');
    if (deps.clearArchiveAfterConfirm(deps.recordedSession.id)) {
      deps.onExamRecorded();
    }
    return true;
  }

  if (result.code === 'not_configured') {
    deps.applyRecordedLocal(deps.recordedSession);
    deps.setSaveState('idle');
    deps.setSaveMessage('');
    deps.setFailedSaveOp(null);
    deps.setSyncNotice('');
    if (deps.clearArchiveAfterConfirm(deps.recordedSession.id)) {
      deps.onExamRecorded();
    }
    return true;
  }

  if (result.code === 'stale' || result.code === 'locked') {
    deps.setSyncBlocked(true);
    deps.setSaveState('conflict');
    deps.setFailedSaveOp(null);
    deps.setError('서버의 모의시험 상태와 충돌하여 기록 완료를 확정하지 못했습니다. 최신 서버 기록을 확인해 주세요.');
    return false;
  }

  deps.setSaveState('error');
  deps.setFailedSaveOp({ kind: 'record_finalize', session: deps.recordedSession });
  deps.setSaveMessage('모의시험 기록 완료 상태를 서버에 저장하지 못했습니다. 다시 시도할 수 있습니다.');
  deps.setError('모의시험 기록 완료 상태를 서버에 저장하지 못했습니다. 평가·풀이 이력은 보존되며 다시 시도해 주세요.');
  return false;
}

/**
 * Pushes a mock-exam attempt + its review event to the server. The transactional
 * RPC is idempotent by attempt id, so re-recording after a partial failure is safe.
 */
export async function submitExamAttemptOnServer(
  attempt: Attempt,
  event: ReviewEvent
): Promise<{ ok: true } | { ok: false; code: MockExamSyncCode }> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await submitAttempt(supabase, attempt, event, null, null);
  return result.ok ? { ok: true } : { ok: false, code: classify(result.error) };
}
