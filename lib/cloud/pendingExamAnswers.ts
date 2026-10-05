'use client';

import type { MockExamSession } from '../types';

/**
 * Per-user, per-session preservation of answers that could not be written to
 * the server yet (network/conflict). Kept SEPARATE from the session so loading
 * the authoritative server record never destroys unsaved local input.
 */
export interface PendingExamAnswers {
  sessionId: string;
  answers: Record<string, string>;
  reasons?: Record<string, string>;
  isReasonNotApplicable?: Record<string, boolean>;
  reasonNotApplicableJustification?: Record<string, string>;
  savedAt: string;
}

const USER_PREFIX = 'redcall_user_';
const BASE = 'pending_exam_answers_v1';

function key(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${BASE}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function readAll(userId: string): Record<string, PendingExamAnswers> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key(userId)) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PendingExamAnswers>) : {};
  } catch {
    return {};
  }
}

function writeAll(userId: string, all: Record<string, PendingExamAnswers>): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(all);
    storage.setItem(key(userId), serialized);
    return storage.getItem(key(userId)) === serialized;
  } catch {
    return false;
  }
}

export function loadPendingExamAnswers(userId: string, sessionId: string): PendingExamAnswers | null {
  return readAll(userId)[sessionId] ?? null;
}

export function listPendingExamAnswers(userId: string): PendingExamAnswers[] {
  return Object.values(readAll(userId));
}

/** Captures the answer-bearing fields of a session into the pending area. */
export function savePendingExamAnswers(userId: string, session: MockExamSession): boolean {
  if (!userId) return false;
  const all = readAll(userId);
  all[session.id] = {
    sessionId: session.id,
    answers: { ...session.answers },
    reasons: session.reasons ? { ...session.reasons } : undefined,
    isReasonNotApplicable: session.isReasonNotApplicable ? { ...session.isReasonNotApplicable } : undefined,
    reasonNotApplicableJustification: session.reasonNotApplicableJustification
      ? { ...session.reasonNotApplicableJustification }
      : undefined,
    savedAt: new Date().toISOString(),
  };
  return writeAll(userId, all);
}

/** Only clears on explicit user confirmation, never on conflict resolution. */
export function clearPendingExamAnswers(userId: string, sessionId: string): boolean {
  const all = readAll(userId);
  if (!(sessionId in all)) return true;
  delete all[sessionId];
  return writeAll(userId, all);
}

/** True when the pending snapshot differs from the given (server) session. */
export function pendingDiffersFrom(session: MockExamSession, pending: PendingExamAnswers | null): boolean {
  if (!pending) return false;
  return (
    JSON.stringify(pending.answers ?? {}) !== JSON.stringify(session.answers ?? {}) ||
    JSON.stringify(pending.reasons ?? {}) !== JSON.stringify(session.reasons ?? {}) ||
    JSON.stringify(pending.isReasonNotApplicable ?? {}) !==
      JSON.stringify(session.isReasonNotApplicable ?? {}) ||
    JSON.stringify(pending.reasonNotApplicableJustification ?? {}) !==
      JSON.stringify(session.reasonNotApplicableJustification ?? {})
  );
}

/** Applies a pending snapshot on top of a session (used by explicit restore). */
export function applyPendingAnswers(
  session: MockExamSession,
  pending: PendingExamAnswers
): MockExamSession {
  return {
    ...session,
    answers: { ...session.answers, ...pending.answers },
    reasons: pending.reasons ? { ...session.reasons, ...pending.reasons } : session.reasons,
    isReasonNotApplicable: pending.isReasonNotApplicable
      ? { ...session.isReasonNotApplicable, ...pending.isReasonNotApplicable }
      : session.isReasonNotApplicable,
    reasonNotApplicableJustification: pending.reasonNotApplicableJustification
      ? { ...session.reasonNotApplicableJustification, ...pending.reasonNotApplicableJustification }
      : session.reasonNotApplicableJustification,
  };
}
