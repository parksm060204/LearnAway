'use client';

import type { Attempt, MockExamSession, ReviewEvent } from '../types';
import { isSupabaseConfigured } from '../supabase/config';
import { createClient } from '../supabase/client';
import {
  getMockExamVersion,
  listMockExamSessions,
  saveMockExamAnswers,
  submitAttempt,
  submitMockExam,
  upsertMockExamSessions,
} from './historyRepository';

export type MockExamSyncCode = 'stale' | 'locked' | 'missing' | 'not_configured' | 'error';

export type MockExamSyncResult =
  | { ok: true; version: number }
  | { ok: false; code: MockExamSyncCode };

export type MockExamFetchResult =
  | { ok: true; session: MockExamSession; version: number }
  | { ok: false; code: MockExamSyncCode };

function client() {
  return isSupabaseConfigured() ? createClient() : null;
}

function classify(error: string): MockExamSyncCode {
  const code = error.split(':')[0];
  if (code === 'stale' || code === 'locked' || code === 'missing') return code;
  if (error === 'MOCK_SESSION_NOT_FOUND') return 'missing';
  return 'error';
}

/**
 * Creates (or re-creates) a mock exam row from a local session. Used when a
 * local-only exam becomes visible to the server. Never version-guarded.
 */
export async function createMockExamOnServer(
  session: MockExamSession
): Promise<MockExamSyncResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const result = await upsertMockExamSessions(supabase, [session]);
  return result.ok ? { ok: true, version: 1 } : { ok: false, code: classify(result.error) };
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

/** Reads the authoritative server session + version to resolve a conflict. */
export async function fetchMockExamFromServer(
  sessionId: string
): Promise<MockExamFetchResult> {
  const supabase = client();
  if (!supabase) return { ok: false, code: 'not_configured' };
  const list = await listMockExamSessions(supabase);
  if (!list.ok) return { ok: false, code: classify(list.error) };
  const session = list.data.find((item) => item.id === sessionId);
  if (!session) return { ok: false, code: 'missing' };
  const version = await getMockExamVersion(supabase, sessionId);
  return { ok: true, session, version: version.ok ? version.data : 1 };
}
