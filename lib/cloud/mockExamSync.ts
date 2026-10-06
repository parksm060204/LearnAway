'use client';

import type { Attempt, MockExamSession, ReviewEvent } from '../types';
import { isSupabaseConfigured } from '../supabase/config';
import { createClient } from '../supabase/client';
import { pendingDiffersFrom, type PendingExamAnswers } from './pendingExamAnswers';
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
