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
  /** Server version this unsaved snapshot is based on (undefined for legacy data). */
  baseVersion?: number;
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
export function savePendingExamAnswers(
  userId: string,
  session: MockExamSession,
  baseVersion?: number
): boolean {
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
    baseVersion,
    savedAt: new Date().toISOString(),
  };
  return writeAll(userId, all);
}

/** Compares the answer-bearing fields of two sessions. */
export function answerFieldsEqual(a: MockExamSession, b: MockExamSession): boolean {
  return (
    JSON.stringify(a.answers ?? {}) === JSON.stringify(b.answers ?? {}) &&
    JSON.stringify(a.reasons ?? {}) === JSON.stringify(b.reasons ?? {}) &&
    JSON.stringify(a.isReasonNotApplicable ?? {}) === JSON.stringify(b.isReasonNotApplicable ?? {}) &&
    JSON.stringify(a.reasonNotApplicableJustification ?? {}) ===
      JSON.stringify(b.reasonNotApplicableJustification ?? {})
  );
}

/**
 * True only when the pending snapshot represents a REAL unsaved change against
 * the given server snapshot: it must actually differ, and either be stamped
 * with the matching server version or have an unknown (legacy) base.
 */
export function pendingIsUnsaved(
  server: MockExamSession,
  pending: PendingExamAnswers | null,
  serverVersion: number
): boolean {
  if (!pending) return false;
  if (!pendingDiffersFrom(server, pending)) return false;
  if (pending.baseVersion === undefined) return true;
  return pending.baseVersion === serverVersion;
}

export type PendingAfterAutosave = 'clear' | 'keep-current';

/**
 * After a successful autosave of `target`, decide whether pending may be
 * cleared. If newer input arrived while the request was in flight (current
 * differs from the saved snapshot), the newer input MUST be preserved.
 */
export function pendingAfterAutosave(
  target: MockExamSession,
  current: MockExamSession | null
): PendingAfterAutosave {
  if (current && current.id === target.id && !answerFieldsEqual(current, target)) return 'keep-current';
  return 'clear';
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

// ---------------------------------------------------------------------------
// Conflict archives: preserved local answers for an explicit server/local
// choice. Unlike the pending slot, an archive is NEVER auto-merged, auto-
// saved, or auto-cleared, and a second conflict never silently replaces an
// existing archive for the same session.
// ---------------------------------------------------------------------------

/** Local answers preserved at conflict time, with the versions that framed it. */
export interface ExamConflictArchive {
  sessionId: string;
  answers: Record<string, string>;
  reasons?: Record<string, string>;
  isReasonNotApplicable?: Record<string, boolean>;
  reasonNotApplicableJustification?: Record<string, string>;
  /** The server version the preserved local answers were written against. */
  baseVersion?: number;
  /** The server version confirmed when the conflict was compared. */
  comparedServerVersion: number;
  savedAt: string;
}

const ARCHIVE_BASE = 'mock_exam_conflict_archives_v1';

function archiveKey(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${ARCHIVE_BASE}`;
}

function readArchives(userId: string): Record<string, ExamConflictArchive> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(archiveKey(userId)) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ExamConflictArchive>) : {};
  } catch {
    return {};
  }
}

function writeArchives(userId: string, all: Record<string, ExamConflictArchive>): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(all);
    storage.setItem(archiveKey(userId), serialized);
    return storage.getItem(archiveKey(userId)) === serialized;
  } catch {
    return false;
  }
}

export type ConflictArchiveSaveResult =
  | { ok: true }
  | { ok: false; reason: 'exists' | 'unverified'; error?: string };

/**
 * Preserves the local conflicting answers as a reviewable archive. An existing
 * archive for the same session is never silently replaced; its caller keeps
 * showing the earlier preserved copy. The pending slot is untouched.
 */
export function saveConflictArchive(
  userId: string,
  archive: ExamConflictArchive
): ConflictArchiveSaveResult {
  if (!userId) return { ok: false, reason: 'unverified', error: '계정 정보가 없습니다.' };
  const all = readArchives(userId);
  const existing = all[archive.sessionId];
  if (existing && JSON.stringify(existing) !== JSON.stringify(archive)) {
    return { ok: false, reason: 'exists' };
  }
  all[archive.sessionId] = archive;
  return writeArchives(userId, all)
    ? { ok: true }
    : { ok: false, reason: 'unverified', error: '보존 저장소를 확인하지 못했습니다.' };
}

export function loadConflictArchive(userId: string, sessionId: string): ExamConflictArchive | null {
  if (!userId) return null;
  return readArchives(userId)[sessionId] ?? null;
}

export function clearConflictArchive(userId: string, sessionId: string): boolean {
  if (!userId) return false;
  const all = readArchives(userId);
  if (!(sessionId in all)) return true;
  delete all[sessionId];
  return writeArchives(userId, all);
}
