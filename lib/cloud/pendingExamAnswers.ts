'use client';

import type { MockExamSession } from '../types';
import {
  refreshPracticeTabLease,
  releasePracticeTabLease,
  resolvePracticeTabId,
} from '../practiceAnswerDraft';

export {
  refreshPracticeTabLease as refreshExamTabLease,
  releasePracticeTabLease as releaseExamTabLease,
  resolvePracticeTabId as resolveExamTabId,
};

/**
 * Per-user, per-session, per-tab preservation of answers that could not be
 * written to the server yet (network/conflict). Kept SEPARATE from the session
 * and from other tabs/sessions so concurrent tabs never overwrite each other.
 */
export interface PendingExamAnswers {
  sessionId: string;
  tabId?: string;
  answers: Record<string, string>;
  reasons?: Record<string, string>;
  isReasonNotApplicable?: Record<string, boolean>;
  reasonNotApplicableJustification?: Record<string, string>;
  /** Server version this unsaved snapshot is based on (undefined for legacy data). */
  baseVersion?: number;
  savedAt: string;
}

export type PendingStorageReadFailureReason =
  | 'no_user'
  | 'storage_unavailable'
  | 'read_error'
  | 'corrupt';

export type PendingStorageReadResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; reason: PendingStorageReadFailureReason; error: string };

type MapReadResult<T> =
  | { ok: true; map: Record<string, T> }
  | { ok: false; reason: PendingStorageReadFailureReason; error: string };

const USER_PREFIX = 'redcall_user_';
const LEGACY_PENDING_BASE = 'pending_exam_answers_v1';
const PENDING_V2_BASE = 'pending_exam_answers_v2';
const PENDING_MIGRATED_BASE = 'pending_exam_migrated_v2';

function legacyPendingKey(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${LEGACY_PENDING_BASE}`;
}

function pendingV2Prefix(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${PENDING_V2_BASE}__`;
}

function pendingSessionPrefix(userId: string, sessionId: string): string {
  return `${pendingV2Prefix(userId)}${encodeURIComponent(sessionId)}__`;
}

function pendingEntryKey(userId: string, sessionId: string, tabId: string): string {
  return `${pendingSessionPrefix(userId, sessionId)}${encodeURIComponent(tabId)}`;
}

function pendingMigratedMarkerKey(userId: string, sessionId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${PENDING_MIGRATED_BASE}__${encodeURIComponent(sessionId)}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isStringRecord(val: unknown): val is Record<string, string> {
  return isPlainRecord(val) && Object.values(val).every((v) => typeof v === 'string');
}

function isBooleanRecord(val: unknown): val is Record<string, boolean> {
  return isPlainRecord(val) && Object.values(val).every((v) => typeof v === 'boolean');
}

function isValidPendingEntry(entryKey: string, val: unknown): val is PendingExamAnswers {
  if (!isPlainRecord(val)) return false;
  if (typeof val.sessionId !== 'string' || !val.sessionId || val.sessionId !== entryKey) return false;
  if (!isStringRecord(val.answers)) return false;
  if (val.reasons !== undefined && !isStringRecord(val.reasons)) return false;
  if (val.isReasonNotApplicable !== undefined && !isBooleanRecord(val.isReasonNotApplicable)) return false;
  if (
    val.reasonNotApplicableJustification !== undefined &&
    !isStringRecord(val.reasonNotApplicableJustification)
  ) {
    return false;
  }
  if (val.baseVersion !== undefined && (typeof val.baseVersion !== 'number' || !Number.isFinite(val.baseVersion))) {
    return false;
  }
  if (val.savedAt !== undefined && typeof val.savedAt !== 'string') return false;
  return true;
}

function isValidArchiveEntry(entryKey: string, val: unknown): val is ExamConflictArchive {
  if (!isValidPendingEntry(entryKey, val)) return false;
  const rec = val as unknown as Record<string, unknown>;
  const ver = rec.comparedServerVersion;
  if (typeof ver !== 'number' || !Number.isFinite(ver)) return false;
  if (rec.archiveId !== undefined && typeof rec.archiveId !== 'string') return false;
  return true;
}

function readMapResult<T>(
  storageKey: string,
  userId: string,
  isValidEntry: (entryKey: string, val: unknown) => val is T
): MapReadResult<T> {
  if (!userId) {
    return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  }
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return { ok: false, reason: 'read_error', error: '로컬 저장소를 읽지 못했습니다.' };
  }
  if (raw === null) {
    return { ok: true, map: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt', error: '로컬 저장 데이터가 손상되어 읽을 수 없습니다.' };
  }
  if (!isPlainRecord(parsed)) {
    return { ok: false, reason: 'corrupt', error: '로컬 저장 데이터 형식이 올바르지 않습니다.' };
  }
  for (const [entryKey, entryVal] of Object.entries(parsed)) {
    if (!entryKey || !isValidEntry(entryKey, entryVal)) {
      return { ok: false, reason: 'corrupt', error: '로컬 저장 항목이 손상되어 읽을 수 없습니다.' };
    }
  }
  return { ok: true, map: parsed as Record<string, T> };
}

function writeVerifiedString(storageKey: string, serialized: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(storageKey, serialized);
    return storage.getItem(storageKey) === serialized;
  } catch {
    return false;
  }
}

function readSingleEntryResult<T>(
  storageKey: string,
  userId: string,
  expectedSessionId: string,
  isValidEntry: (entryKey: string, val: unknown) => val is T
): PendingStorageReadResult<T> {
  if (!userId) {
    return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  }
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return { ok: false, reason: 'read_error', error: '로컬 저장소를 읽지 못했습니다.' };
  }
  if (raw === null) {
    return { ok: true, value: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt', error: '로컬 저장 데이터가 손상되어 읽을 수 없습니다.' };
  }
  if (!isValidEntry(expectedSessionId, parsed)) {
    return { ok: false, reason: 'corrupt', error: '로컬 저장 항목이 손상되어 읽을 수 없습니다.' };
  }
  return { ok: true, value: parsed };
}

function pendingContentMatches(a: PendingExamAnswers, b: PendingExamAnswers): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.baseVersion === b.baseVersion &&
    JSON.stringify(a.answers ?? {}) === JSON.stringify(b.answers ?? {}) &&
    JSON.stringify(a.reasons ?? {}) === JSON.stringify(b.reasons ?? {}) &&
    JSON.stringify(a.isReasonNotApplicable ?? {}) === JSON.stringify(b.isReasonNotApplicable ?? {}) &&
    JSON.stringify(a.reasonNotApplicableJustification ?? {}) ===
      JSON.stringify(b.reasonNotApplicableJustification ?? {})
  );
}

/**
 * Non-destructively migrates a single session from the legacy v1 user blob
 * into v2 per-session/per-tab storage, using a verified per-session marker so
 * cleared entries never resurrect and newer v2 entries are never overwritten.
 */
function ensureLegacyPendingMigrated(
  userId: string,
  sessionId: string,
  targetTabId: string
): { ok: true } | { ok: false; reason: PendingStorageReadFailureReason; error: string } {
  if (!userId) return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  const storage = getStorage();
  if (!storage) return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };

  const markerKey = pendingMigratedMarkerKey(userId, sessionId);
  try {
    if (storage.getItem(markerKey) === '1') return { ok: true };
  } catch {
    return { ok: false, reason: 'read_error', error: '로컬 저장소 이관 상태를 읽지 못했습니다.' };
  }

  const legacyRead = readMapResult(legacyPendingKey(userId), userId, isValidPendingEntry);
  if (!legacyRead.ok) return legacyRead;

  const legacyEntry = legacyRead.map[sessionId];
  if (!legacyEntry) return { ok: true };

  const targetKey = pendingEntryKey(userId, sessionId, targetTabId);
  const existingRead = readSingleEntryResult(targetKey, userId, sessionId, isValidPendingEntry);
  if (!existingRead.ok) return existingRead;

  if (!existingRead.value) {
    const migrated: PendingExamAnswers = { ...legacyEntry, tabId: targetTabId };
    if (!writeVerifiedString(targetKey, JSON.stringify(migrated))) {
      return { ok: false, reason: 'read_error', error: '기존 미저장 답안을 이관 저장하지 못했습니다.' };
    }
    const verifyTarget = readSingleEntryResult(targetKey, userId, sessionId, isValidPendingEntry);
    if (!verifyTarget.ok || !verifyTarget.value || !pendingContentMatches(verifyTarget.value, migrated)) {
      return { ok: false, reason: 'read_error', error: '이관된 미저장 답안을 검증하지 못했습니다.' };
    }
  } else if (!pendingContentMatches(existingRead.value, legacyEntry)) {
    // New v2 data already exists and differs: keep v2 untouched and preserve
    // the legacy copy under a verified backup tab slot (falling back to a
    // stable source-specific slot if `legacy-backup` holds different content).
    let stored = false;
    for (const backupTabId of ['legacy-backup', 'legacy-backup-v1']) {
      const backupKey = pendingEntryKey(userId, sessionId, backupTabId);
      const backupRead = readSingleEntryResult(backupKey, userId, sessionId, isValidPendingEntry);
      if (!backupRead.ok) return backupRead;
      if (!backupRead.value) {
        const backupEntry: PendingExamAnswers = { ...legacyEntry, tabId: backupTabId };
        if (!writeVerifiedString(backupKey, JSON.stringify(backupEntry))) {
          return { ok: false, reason: 'read_error', error: '기존 미저장 백업 답안을 이관 저장하지 못했습니다.' };
        }
        const verifyBackup = readSingleEntryResult(backupKey, userId, sessionId, isValidPendingEntry);
        if (!verifyBackup.ok || !verifyBackup.value || !pendingContentMatches(verifyBackup.value, backupEntry)) {
          return { ok: false, reason: 'read_error', error: '이관된 미저장 백업 답안을 검증하지 못했습니다.' };
        }
        stored = true;
        break;
      }
      if (pendingContentMatches(backupRead.value, legacyEntry)) {
        stored = true;
        break;
      }
    }
    if (!stored) {
      return {
        ok: false,
        reason: 'read_error',
        error: '기존 미저장 백업 슬롯이 다른 답안으로 점유되어 이관을 완료하지 못했습니다.',
      };
    }
  }

  if (!writeVerifiedString(markerKey, '1')) {
    return { ok: false, reason: 'read_error', error: '미저장 답안 이관 완료 표시를 확인하지 못했습니다.' };
  }
  return { ok: true };
}

export function loadPendingExamAnswersResult(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): PendingStorageReadResult<PendingExamAnswers> {
  const mig = ensureLegacyPendingMigrated(userId, sessionId, tabId);
  if (!mig.ok) return mig;
  return readSingleEntryResult(
    pendingEntryKey(userId, sessionId, tabId),
    userId,
    sessionId,
    isValidPendingEntry
  );
}

export function loadPendingExamAnswers(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): PendingExamAnswers | null {
  const read = loadPendingExamAnswersResult(userId, sessionId, tabId);
  return read.ok ? read.value : null;
}

export function listPendingExamAnswers(userId: string): PendingExamAnswers[] {
  if (!userId) return [];
  const storage = getStorage();
  if (!storage) return [];
  const legacyRead = readMapResult(legacyPendingKey(userId), userId, isValidPendingEntry);
  if (legacyRead.ok) {
    const defaultTabId = resolvePracticeTabId();
    for (const sessionId of Object.keys(legacyRead.map)) {
      ensureLegacyPendingMigrated(userId, sessionId, defaultTabId);
    }
  }
  const prefix = pendingV2Prefix(userId);
  const out: PendingExamAnswers[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const raw = storage.getItem(k);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (isPlainRecord(parsed) && typeof parsed.sessionId === 'string' && isValidPendingEntry(parsed.sessionId, parsed)) {
        out.push(parsed);
      }
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Lists unsaved pending snapshots from OTHER tabs for the same user & session
 * (read-only; never auto-merged or auto-cleared by this tab).
 */
export function listOtherTabPendingExamAnswers(
  userId: string,
  sessionId: string,
  currentTabId: string = resolvePracticeTabId()
): PendingStorageReadResult<PendingExamAnswers[]> {
  if (!userId) return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  const mig = ensureLegacyPendingMigrated(userId, sessionId, currentTabId);
  if (!mig.ok) return mig;
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };
  }
  const prefix = pendingSessionPrefix(userId, sessionId);
  const ownKey = pendingEntryKey(userId, sessionId, currentTabId);
  const out: PendingExamAnswers[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(prefix) || k === ownKey) continue;
      const raw = storage.getItem(k);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!isValidPendingEntry(sessionId, parsed)) {
        return { ok: false, reason: 'corrupt', error: '다른 탭의 미저장 답안 데이터가 손상되었습니다.' };
      }
      out.push(parsed);
    }
  } catch {
    return { ok: false, reason: 'read_error', error: '다른 탭의 미저장 답안을 읽지 못했습니다.' };
  }
  out.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  return { ok: true, value: out };
}

/** Captures the answer-bearing fields of a session into THIS tab's pending key. */
export function savePendingExamAnswers(
  userId: string,
  session: MockExamSession,
  baseVersion?: number,
  tabId: string = resolvePracticeTabId()
): boolean {
  const mig = ensureLegacyPendingMigrated(userId, session.id, tabId);
  if (!mig.ok) return false;
  // Verify existing target key isn't corrupt before overwriting, and never touch other tabs/sessions.
  const targetKey = pendingEntryKey(userId, session.id, tabId);
  const existing = readSingleEntryResult(targetKey, userId, session.id, isValidPendingEntry);
  if (!existing.ok) return false;
  const entry: PendingExamAnswers = {
    sessionId: session.id,
    tabId,
    answers: { ...session.answers },
    reasons: session.reasons ? { ...session.reasons } : undefined,
    isReasonNotApplicable: session.isReasonNotApplicable ? { ...session.isReasonNotApplicable } : undefined,
    reasonNotApplicableJustification: session.reasonNotApplicableJustification
      ? { ...session.reasonNotApplicableJustification }
      : undefined,
    baseVersion,
    savedAt: new Date().toISOString(),
  };
  return writeVerifiedString(targetKey, JSON.stringify(entry));
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

/** Only clears THIS tab's pending key; other tabs and sessions are untouched. */
export function clearPendingExamAnswers(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): boolean {
  const mig = ensureLegacyPendingMigrated(userId, sessionId, tabId);
  if (!mig.ok) return false;
  const targetKey = pendingEntryKey(userId, sessionId, tabId);
  const existing = readSingleEntryResult(targetKey, userId, sessionId, isValidPendingEntry);
  if (!existing.ok) return false;
  if (!existing.value) return true;
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(targetKey);
    return storage.getItem(targetKey) === null;
  } catch {
    return false;
  }
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
  if (session.status !== 'in_progress') return session;
  if (!pending || pending.sessionId !== session.id) return session;
  const hasAnswers = isPlainRecord(pending.answers);
  return {
    ...session,
    answers: hasAnswers ? { ...pending.answers } : { ...session.answers },
    reasons: pending.reasons !== undefined ? { ...pending.reasons } : session.reasons,
    isReasonNotApplicable:
      pending.isReasonNotApplicable !== undefined
        ? { ...pending.isReasonNotApplicable }
        : session.isReasonNotApplicable,
    reasonNotApplicableJustification:
      pending.reasonNotApplicableJustification !== undefined
        ? { ...pending.reasonNotApplicableJustification }
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
  tabId?: string;
  archiveId?: string;
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

const LEGACY_ARCHIVE_BASE = 'mock_exam_conflict_archives_v1';
const ARCHIVE_V2_BASE = 'mock_exam_conflict_archives_v2';
// Distinct per-tab migration marker so an earlier session-only v2 marker (`_v2`)
// never skips migrating session-only v2 archives into per-tab keys.
const ARCHIVE_MIGRATED_BASE = 'mock_exam_conflict_archives_migrated_v2_tabs';
const ARCHIVE_CLEARED_BASE = 'mock_exam_conflict_archives_cleared_v2';

function legacyArchiveKey(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${LEGACY_ARCHIVE_BASE}`;
}

function sessionOnlyArchiveKey(userId: string, sessionId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${ARCHIVE_V2_BASE}__${encodeURIComponent(sessionId)}`;
}

function archiveSessionPrefix(userId: string, sessionId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${ARCHIVE_V2_BASE}__${encodeURIComponent(sessionId)}__`;
}

function archiveEntryKey(userId: string, sessionId: string, tabId: string): string {
  return `${archiveSessionPrefix(userId, sessionId)}${encodeURIComponent(tabId)}`;
}

function archiveMigratedMarkerKey(userId: string, sessionId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${ARCHIVE_MIGRATED_BASE}__${encodeURIComponent(sessionId)}`;
}

function archiveClearedTombstoneKey(userId: string, sessionId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${ARCHIVE_CLEARED_BASE}__${encodeURIComponent(sessionId)}`;
}

function archiveContentMatches(a: ExamConflictArchive, b: ExamConflictArchive): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.baseVersion === b.baseVersion &&
    a.comparedServerVersion === b.comparedServerVersion &&
    JSON.stringify(a.answers ?? {}) === JSON.stringify(b.answers ?? {}) &&
    JSON.stringify(a.reasons ?? {}) === JSON.stringify(b.reasons ?? {}) &&
    JSON.stringify(a.isReasonNotApplicable ?? {}) === JSON.stringify(b.isReasonNotApplicable ?? {}) &&
    JSON.stringify(a.reasonNotApplicableJustification ?? {}) ===
      JSON.stringify(b.reasonNotApplicableJustification ?? {})
  );
}

function migrateOneArchiveSource(
  userId: string,
  sessionId: string,
  tabId: string,
  sourceTag: 'session-v2' | 'legacy-v1',
  sourceEntry: ExamConflictArchive
): { ok: true } | { ok: false; reason: PendingStorageReadFailureReason; error: string } {
  const targetKey = archiveEntryKey(userId, sessionId, tabId);
  const existingRead = readSingleEntryResult(targetKey, userId, sessionId, isValidArchiveEntry);
  if (!existingRead.ok) return existingRead;

  if (!existingRead.value) {
    const migrated: ExamConflictArchive = { ...sourceEntry, tabId };
    if (!writeVerifiedString(targetKey, JSON.stringify(migrated))) {
      return { ok: false, reason: 'read_error', error: '기존 충돌 보관함을 이관 저장하지 못했습니다.' };
    }
    const verify = readSingleEntryResult(targetKey, userId, sessionId, isValidArchiveEntry);
    if (!verify.ok || !verify.value || !archiveContentMatches(verify.value, migrated)) {
      return { ok: false, reason: 'read_error', error: '이관된 충돌 보관함 내용을 검증하지 못했습니다.' };
    }
    return { ok: true };
  }

  if (archiveContentMatches(existingRead.value, sourceEntry)) {
    return { ok: true };
  }

  // New v2 per-tab data already exists and differs: preserve this source under
  // `legacy-backup` or a stable source-specific backup slot if `legacy-backup`
  // already holds different content, verifying content before succeeding.
  for (const backupTabId of ['legacy-backup', `legacy-backup-${sourceTag}`]) {
    const backupKey = archiveEntryKey(userId, sessionId, backupTabId);
    const backupRead = readSingleEntryResult(backupKey, userId, sessionId, isValidArchiveEntry);
    if (!backupRead.ok) return backupRead;
    if (!backupRead.value) {
      const backupEntry: ExamConflictArchive = { ...sourceEntry, tabId: backupTabId };
      if (!writeVerifiedString(backupKey, JSON.stringify(backupEntry))) {
        return { ok: false, reason: 'read_error', error: '충돌하는 기존 보관함 백업을 저장하지 못했습니다.' };
      }
      const verifyBackup = readSingleEntryResult(backupKey, userId, sessionId, isValidArchiveEntry);
      if (!verifyBackup.ok || !verifyBackup.value || !archiveContentMatches(verifyBackup.value, backupEntry)) {
        return { ok: false, reason: 'read_error', error: '이관된 충돌 보관함 백업을 검증하지 못했습니다.' };
      }
      return { ok: true };
    }
    if (archiveContentMatches(backupRead.value, sourceEntry)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: 'read_error',
    error: '기존 충돌 보관함 백업 슬롯이 다른 내용으로 점유되어 이관을 완료하지 못했습니다.',
  };
}

function ensureLegacyArchiveMigrated(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): { ok: true } | { ok: false; reason: PendingStorageReadFailureReason; error: string } {
  if (!userId) return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  const storage = getStorage();
  if (!storage) return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };

  const markerKey = archiveMigratedMarkerKey(userId, sessionId);
  const tombstoneKey = archiveClearedTombstoneKey(userId, sessionId);
  try {
    if (storage.getItem(markerKey) === '1') return { ok: true };
    if (storage.getItem(tombstoneKey) === '1') {
      if (!writeVerifiedString(markerKey, '1')) {
        return { ok: false, reason: 'read_error', error: '충돌 보관함 정리 상태를 확인하지 못했습니다.' };
      }
      return { ok: true };
    }
  } catch {
    return { ok: false, reason: 'read_error', error: '충돌 보관함 이관 상태를 읽지 못했습니다.' };
  }

  const sessionOnlyRead = readSingleEntryResult(
    sessionOnlyArchiveKey(userId, sessionId),
    userId,
    sessionId,
    isValidArchiveEntry
  );
  if (!sessionOnlyRead.ok) return sessionOnlyRead;

  const legacyRead = readMapResult(legacyArchiveKey(userId), userId, isValidArchiveEntry);
  if (!legacyRead.ok) return legacyRead;

  const sources: Array<{ tag: 'session-v2' | 'legacy-v1'; entry: ExamConflictArchive }> = [];
  if (sessionOnlyRead.value) sources.push({ tag: 'session-v2', entry: sessionOnlyRead.value });
  const legacyEntry = legacyRead.map[sessionId];
  if (legacyEntry && (!sessionOnlyRead.value || !archiveContentMatches(sessionOnlyRead.value, legacyEntry))) {
    sources.push({ tag: 'legacy-v1', entry: legacyEntry });
  }

  if (sources.length === 0) return { ok: true };

  for (const src of sources) {
    const res = migrateOneArchiveSource(userId, sessionId, tabId, src.tag, src.entry);
    if (!res.ok) return res;
  }

  if (!writeVerifiedString(markerKey, '1')) {
    return { ok: false, reason: 'read_error', error: '충돌 보관함 이관 완료 표시를 확인하지 못했습니다.' };
  }
  return { ok: true };
}

export type ConflictArchiveSaveResult =
  | { ok: true }
  | { ok: false; reason: 'exists' | 'unverified'; error?: string };

/**
 * Preserves the local conflicting answers as a reviewable archive under a
 * per-user/per-session/per-tab key. An existing archive for the same tab is
 * never silently replaced; its caller must either keep it or save the newer
 * copy immutably via `saveImmutableConflictArchive`.
 */
export function saveConflictArchive(
  userId: string,
  archive: ExamConflictArchive,
  tabId: string = resolvePracticeTabId()
): ConflictArchiveSaveResult {
  const mig = ensureLegacyArchiveMigrated(userId, archive.sessionId, tabId);
  if (!mig.ok) return { ok: false, reason: 'unverified', error: mig.error };
  const targetKey = archiveEntryKey(userId, archive.sessionId, tabId);
  const existingRead = readSingleEntryResult(targetKey, userId, archive.sessionId, isValidArchiveEntry);
  if (!existingRead.ok) return { ok: false, reason: 'unverified', error: existingRead.error };
  const existing = existingRead.value;
  if (existing && !archiveContentMatches(existing, archive)) {
    return { ok: false, reason: 'exists' };
  }
  const toSave: ExamConflictArchive = { ...archive, tabId };
  if (!writeVerifiedString(targetKey, JSON.stringify(toSave))) {
    return { ok: false, reason: 'unverified', error: '보존 저장소를 확인하지 못했습니다.' };
  }
  const verify = readSingleEntryResult(targetKey, userId, archive.sessionId, isValidArchiveEntry);
  if (!verify.ok || !verify.value || !archiveContentMatches(verify.value, toSave)) {
    return { ok: false, reason: 'unverified', error: '보존된 답안 내용 검증에 실패했습니다.' };
  }
  return { ok: true };
}

/**
 * Stores an immutable recovery copy under a unique archive slot so a newer
 * conflicting snapshot `B` is never lost even when an earlier archive `A`
 * already occupies this tab's primary archive slot.
 */
export function saveImmutableConflictArchive(
  userId: string,
  archive: ExamConflictArchive,
  tabId: string = resolvePracticeTabId()
): ConflictArchiveSaveResult {
  if (!userId) return { ok: false, reason: 'unverified', error: '계정 정보가 없습니다.' };
  const mig = ensureLegacyArchiveMigrated(userId, archive.sessionId, tabId);
  if (!mig.ok) return { ok: false, reason: 'unverified', error: mig.error };
  const archiveId = `${tabId}__copy__${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const targetKey = archiveEntryKey(userId, archive.sessionId, archiveId);
  const toSave: ExamConflictArchive = { ...archive, tabId: archiveId, archiveId };
  if (!writeVerifiedString(targetKey, JSON.stringify(toSave))) {
    return { ok: false, reason: 'unverified', error: '추가 보존 사본을 저장하지 못했습니다.' };
  }
  const verify = readSingleEntryResult(targetKey, userId, archive.sessionId, isValidArchiveEntry);
  if (!verify.ok || !verify.value || !archiveContentMatches(verify.value, toSave)) {
    return { ok: false, reason: 'unverified', error: '추가 보존 사본 검증에 실패했습니다.' };
  }
  return { ok: true };
}

export function loadConflictArchiveResult(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): PendingStorageReadResult<ExamConflictArchive> {
  const mig = ensureLegacyArchiveMigrated(userId, sessionId, tabId);
  if (!mig.ok) return mig;
  return readSingleEntryResult(
    archiveEntryKey(userId, sessionId, tabId),
    userId,
    sessionId,
    isValidArchiveEntry
  );
}

export function loadConflictArchive(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): ExamConflictArchive | null {
  const read = loadConflictArchiveResult(userId, sessionId, tabId);
  return read.ok ? read.value : null;
}

/**
 * Lists conflict archives for this session belonging to OTHER tabs (or legacy
 * backup / immutable recovery copies), failing closed on any corrupt entry.
 */
export function listOtherTabConflictArchives(
  userId: string,
  sessionId: string,
  currentTabId: string = resolvePracticeTabId()
): PendingStorageReadResult<ExamConflictArchive[]> {
  if (!userId) return { ok: false, reason: 'no_user', error: '계정 정보가 없습니다.' };
  const mig = ensureLegacyArchiveMigrated(userId, sessionId, currentTabId);
  if (!mig.ok) return mig;
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'storage_unavailable', error: '브라우저 저장소에 접근할 수 없습니다.' };
  }
  const prefix = archiveSessionPrefix(userId, sessionId);
  const ownKey = archiveEntryKey(userId, sessionId, currentTabId);
  const out: ExamConflictArchive[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(prefix) || k === ownKey) continue;
      const raw = storage.getItem(k);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!isValidArchiveEntry(sessionId, parsed)) {
        return { ok: false, reason: 'corrupt', error: '다른 탭의 충돌 보관 데이터가 손상되었습니다.' };
      }
      out.push(parsed);
    }
  } catch {
    return { ok: false, reason: 'read_error', error: '다른 탭의 충돌 보관함을 읽지 못했습니다.' };
  }
  out.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
  return { ok: true, value: out };
}

/** Only clears THIS tab's conflict archive key; other tabs' archives remain intact. */
export function clearConflictArchive(
  userId: string,
  sessionId: string,
  tabId: string = resolvePracticeTabId()
): boolean {
  const mig = ensureLegacyArchiveMigrated(userId, sessionId, tabId);
  if (!mig.ok) return false;
  const targetKey = archiveEntryKey(userId, sessionId, tabId);
  const existingRead = readSingleEntryResult(targetKey, userId, sessionId, isValidArchiveEntry);
  if (!existingRead.ok) return false;
  if (!existingRead.value) return true;
  const storage = getStorage();
  if (!storage) return false;
  try {
    const legacyRead = readMapResult(legacyArchiveKey(userId), userId, isValidArchiveEntry);
    const sessionOnlyRead = readSingleEntryResult(
      sessionOnlyArchiveKey(userId, sessionId),
      userId,
      sessionId,
      isValidArchiveEntry
    );
    if ((legacyRead.ok && legacyRead.map[sessionId]) || (sessionOnlyRead.ok && sessionOnlyRead.value)) {
      if (!writeVerifiedString(archiveClearedTombstoneKey(userId, sessionId), '1')) {
        return false;
      }
    }
    storage.removeItem(targetKey);
    return storage.getItem(targetKey) === null;
  } catch {
    return false;
  }
}
