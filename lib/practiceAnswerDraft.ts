'use client';

import type { ErrorType } from './types';

/**
 * Per-user, per-problem, PER-TAB preservation of UNSAVED problem-practice input.
 *
 * General practice has no server-side draft row: an answer only becomes durable
 * when the user records the attempt. This store keeps the in-progress editor
 * state on this device, keyed by account + problem + problem version + tab, so:
 *  - a refresh / menu move / browser restart restores the SAME tab's draft,
 *  - two tabs on the same problem keep SEPARATE drafts (no silent overwrite),
 *  - another tab's (or an older problem version's) draft is offered for
 *    explicit recovery only, never auto-applied,
 *  - clearing the answer is persisted, so a refresh does not resurrect it.
 *
 * Concurrency: every draft is its own localStorage key (no read-modify-write of
 * a shared blob), so simultaneous saves from different tabs never lose data.
 */
export interface PracticeAnswerDraft {
  problemId: string;
  /** Problem version the draft was typed against (identity check on restore). */
  problemVersion: number;
  /** Stable per-tab identifier the draft belongs to. */
  tabId: string;
  answerText: string;
  revealedHints: number[];
  confidence: number;
  errorType: ErrorType;
  reasoningNotes: string;
  solvingReason: string;
  isReasonNotApplicable: boolean;
  reasonNotApplicableJustification: string;
  savedAt: string;
}

const USER_PREFIX = 'redcall_user_';
const BASE = 'practice_answer_drafts_v1';

function userPrefix(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${BASE}`;
}

function entryKey(userId: string, problemId: string, problemVersion: number, tabId: string): string {
  return `${userPrefix(userId)}__${encodeURIComponent(problemId)}__v${problemVersion}__${encodeURIComponent(tabId)}`;
}

/** The legacy single-blob key from the previous format (migrated on read). */
function legacyKey(userId: string): string {
  return userPrefix(userId);
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    // privacy mode
  }
  return null;
}

/** True when the draft carries any user input worth restoring. */
export function hasPracticeDraftContent(draft: PracticeAnswerDraft): boolean {
  return Boolean(
    draft.answerText.trim() ||
      draft.reasoningNotes.trim() ||
      (draft.solvingReason.trim() && !draft.isReasonNotApplicable) ||
      draft.reasonNotApplicableJustification.trim() ||
      draft.revealedHints.length > 0
  );
}

/**
 * A draft is applied to the SAME problem and the SAME version it was typed
 * against; a different version is never silently restored on top of new content
 * (it is offered as an explicit recovery target instead).
 */
export function draftMatchesProblem(
  draft: PracticeAnswerDraft,
  problemId: string,
  problemVersion: number
): boolean {
  return draft.problemId === problemId && draft.problemVersion === problemVersion;
}

/** Compares every typed-content field, ignoring the write timestamp/tab. */
export function draftContentEquals(a: PracticeAnswerDraft, b: PracticeAnswerDraft): boolean {
  return (
    a.problemId === b.problemId &&
    a.problemVersion === b.problemVersion &&
    a.answerText === b.answerText &&
    a.confidence === b.confidence &&
    a.errorType === b.errorType &&
    a.reasoningNotes === b.reasoningNotes &&
    a.solvingReason === b.solvingReason &&
    a.isReasonNotApplicable === b.isReasonNotApplicable &&
    a.reasonNotApplicableJustification === b.reasonNotApplicableJustification &&
    JSON.stringify(a.revealedHints) === JSON.stringify(b.revealedHints)
  );
}

const VALID_ERROR_TYPES: ReadonlySet<string> = new Set([
  'none',
  'concept',
  'calculation',
  'logic',
  'misread',
  'time',
]);

function sanitizePracticeDraft(value: unknown): PracticeAnswerDraft | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (
    typeof d.problemId !== 'string' ||
    !d.problemId ||
    typeof d.problemVersion !== 'number' ||
    !Number.isFinite(d.problemVersion) ||
    typeof d.tabId !== 'string' ||
    !d.tabId ||
    typeof d.answerText !== 'string' ||
    typeof d.savedAt !== 'string'
  ) {
    return null;
  }

  const revealedHints = Array.isArray(d.revealedHints)
    ? d.revealedHints.filter((h): h is number => typeof h === 'number' && Number.isFinite(h))
    : [];
  const confidence =
    typeof d.confidence === 'number' && Number.isFinite(d.confidence) ? d.confidence : 3;
  const errorType = (
    typeof d.errorType === 'string' && VALID_ERROR_TYPES.has(d.errorType) ? d.errorType : 'none'
  ) as ErrorType;

  return {
    problemId: d.problemId,
    problemVersion: d.problemVersion,
    tabId: d.tabId,
    answerText: typeof d.answerText === 'string' ? d.answerText : '',
    revealedHints,
    confidence,
    errorType,
    reasoningNotes: typeof d.reasoningNotes === 'string' ? d.reasoningNotes : '',
    solvingReason: typeof d.solvingReason === 'string' ? d.solvingReason : '',
    isReasonNotApplicable: Boolean(d.isReasonNotApplicable),
    reasonNotApplicableJustification:
      typeof d.reasonNotApplicableJustification === 'string'
        ? d.reasonNotApplicableJustification
        : '',
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
  };
}

function isValidDraft(value: unknown): value is PracticeAnswerDraft {
  return sanitizePracticeDraft(value) !== null;
}

/**
 * One-time migration of the previous shared-blob format into per-entry keys.
 * Never overwrites an existing newer/different entry, preserves conflicts in a
 * dedicated recovery entry, and safely catches storage read errors.
 */
function migrateLegacyBlob(userId: string): { ok: boolean } {
  const storage = getStorage();
  if (!storage) return { ok: false };
  let raw: string | null;
  try {
    raw = storage.getItem(legacyKey(userId));
  } catch {
    return { ok: false };
  }
  if (!raw) return { ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false }; // unreadable: keep it untouched
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const drafts: PracticeAnswerDraft[] = [];
  for (const [storedKey, value] of entries) {
    if (!value || typeof value !== 'object') return { ok: false };
    const candidate = value as Partial<PracticeAnswerDraft>;
    const tabIdFromKey = storedKey.includes('::') ? storedKey.split('::')[1] : undefined;
    const tabId = candidate.tabId ?? tabIdFromKey;
    const normalized = sanitizePracticeDraft({ ...candidate, tabId });
    if (!normalized) {
      return { ok: false }; // cannot safely migrate: keep the original
    }
    drafts.push(normalized);
  }

  let hadConflict = false;
  for (const draft of drafts) {
    const targetKey = entryKey(userId, draft.problemId, draft.problemVersion, draft.tabId);
    let existingRaw: string | null;
    try {
      existingRaw = storage.getItem(targetKey);
    } catch {
      return { ok: false };
    }

    if (existingRaw === null) {
      if (!writeEntry(userId, draft)) return { ok: false };
      continue;
    }

    let existingParsed: unknown;
    try {
      existingParsed = JSON.parse(existingRaw);
    } catch {
      // Target entry is unreadable/corrupt: do not overwrite it and keep legacy intact
      return { ok: false };
    }
    const existing = sanitizePracticeDraft(existingParsed);
    if (!existing) return { ok: false };

    if (draftContentEquals(existing, draft)) {
      // Already migrated identically: safe to skip without overwriting
      continue;
    }

    // Conflict: existing entry differs from legacy entry. Keep existing untouched,
    // preserve legacy entry under a dedicated recovery key, and keep the legacy source.
    hadConflict = true;
    const backupTabId = draft.tabId.startsWith('legacy-backup-')
      ? draft.tabId
      : `legacy-backup-${draft.tabId}`;
    const backupKey = entryKey(userId, draft.problemId, draft.problemVersion, backupTabId);
    let backupRaw: string | null;
    try {
      backupRaw = storage.getItem(backupKey);
    } catch {
      return { ok: false };
    }
    if (backupRaw === null) {
      if (!writeEntry(userId, { ...draft, tabId: backupTabId })) return { ok: false };
    } else {
      try {
        const parsedBackup = sanitizePracticeDraft(JSON.parse(backupRaw));
        if (!parsedBackup || !draftContentEquals(parsedBackup, { ...draft, tabId: backupTabId })) {
          return { ok: false }; // backup slot already holds different data; keep legacy blob
        }
      } catch {
        return { ok: false };
      }
    }
  }

  if (!hadConflict) {
    try {
      storage.removeItem(legacyKey(userId));
    } catch {
      // readable-only storage: entries are already present
    }
  }
  return { ok: true };
}

function writeEntry(userId: string, draft: PracticeAnswerDraft): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const key = entryKey(userId, draft.problemId, draft.problemVersion, draft.tabId);
    const serialized = JSON.stringify(draft);
    storage.setItem(key, serialized);
    // Read back: a write that could not be persisted is never reported as saved.
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

export interface PracticeDraftReadResult {
  status: 'ok' | 'absent' | 'read_error' | 'corrupt';
  draft: PracticeAnswerDraft | null;
}

export interface PracticeDraftListResult {
  status: 'ok' | 'read_error';
  drafts: PracticeAnswerDraft[];
  hadCorruptEntry: boolean;
}

export interface RecoverablePracticeDraftsResult {
  status: 'ok' | 'read_error';
  otherTabDrafts: PracticeAnswerDraft[];
  otherVersionDrafts: PracticeAnswerDraft[];
  drafts: PracticeAnswerDraft[];
}

function readAllDraftsWithStatus(userId: string): PracticeDraftListResult {
  if (!userId) return { status: 'ok', drafts: [], hadCorruptEntry: false };
  const mig = migrateLegacyBlob(userId);
  const storage = getStorage();
  if (!storage) return { status: 'read_error', drafts: [], hadCorruptEntry: false };
  const prefix = `${userPrefix(userId)}__`;
  const out: PracticeAnswerDraft[] = [];
  let hadReadError = !mig.ok;
  let hadCorruptEntry = false;
  try {
    const len = storage.length;
    for (let i = 0; i < len; i += 1) {
      let key: string | null;
      let raw: string | null;
      try {
        key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        raw = storage.getItem(key);
      } catch {
        hadReadError = true;
        continue;
      }
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const sanitized = sanitizePracticeDraft(parsed);
        if (sanitized) out.push(sanitized);
        else hadCorruptEntry = true;
      } catch {
        hadCorruptEntry = true;
      }
    }
  } catch {
    return { status: 'read_error', drafts: out, hadCorruptEntry };
  }
  return {
    status: hadReadError ? 'read_error' : 'ok',
    drafts: out,
    hadCorruptEntry,
  };
}

function readAllDrafts(userId: string): PracticeAnswerDraft[] {
  return readAllDraftsWithStatus(userId).drafts;
}

/** Single-pass snapshot for the editor's own draft and all explicit recovery choices. */
export function loadPracticeDraftState(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): {
  ok: boolean;
  draft: PracticeAnswerDraft | null;
  recoverable: PracticeAnswerDraft[];
} {
  const res = readAllDraftsWithStatus(userId);
  const matching = res.drafts.filter((d) => d.problemId === problemId);
  return {
    ok: res.status === 'ok' && !res.hadCorruptEntry,
    draft:
      matching.find((d) => d.problemVersion === problemVersion && d.tabId === tabId) ?? null,
    recoverable: matching
      .filter((d) => d.problemVersion !== problemVersion || d.tabId !== tabId)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  };
}

/** Saves (or replaces) THIS tab's draft for one problem. */
export function savePracticeAnswerDraft(userId: string, draft: PracticeAnswerDraft): boolean {
  if (!userId || !draft?.tabId) return false;
  const sanitized = sanitizePracticeDraft(draft);
  if (!sanitized) return false;
  return writeEntry(userId, sanitized);
}

/** This tab's own draft for one problem + version with explicit read status. */
export function loadPracticeAnswerDraftForTabWithStatus(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): PracticeDraftReadResult {
  if (!userId || !tabId) return { status: 'absent', draft: null };
  const mig = migrateLegacyBlob(userId);
  const storage = getStorage();
  if (!storage) return { status: 'read_error', draft: null };
  let raw: string | null;
  try {
    raw = storage.getItem(entryKey(userId, problemId, problemVersion, tabId));
  } catch {
    return { status: 'read_error', draft: null };
  }
  if (raw === null) {
    return { status: mig.ok ? 'absent' : 'read_error', draft: null };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const sanitized = sanitizePracticeDraft(parsed);
    return sanitized
      ? { status: 'ok', draft: sanitized }
      : { status: 'corrupt', draft: null };
  } catch {
    return { status: 'corrupt', draft: null };
  }
}

/** This tab's own draft for one problem + version (never another tab's). */
export function loadPracticeAnswerDraftForTab(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): PracticeAnswerDraft | null {
  return loadPracticeAnswerDraftForTabWithStatus(userId, problemId, problemVersion, tabId).draft;
}

/** Single-pass classification of recoverable drafts (other tabs + other versions). */
export function listRecoverablePracticeDraftsWithStatus(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): RecoverablePracticeDraftsResult {
  const all = readAllDraftsWithStatus(userId);
  const otherTabDrafts: PracticeAnswerDraft[] = [];
  const otherVersionDrafts: PracticeAnswerDraft[] = [];
  for (const d of all.drafts) {
    if (d.problemId !== problemId) continue;
    if (d.problemVersion === problemVersion) {
      if (d.tabId !== tabId) otherTabDrafts.push(d);
    } else {
      otherVersionDrafts.push(d);
    }
  }
  const byNewest = (a: PracticeAnswerDraft, b: PracticeAnswerDraft) =>
    b.savedAt.localeCompare(a.savedAt);
  otherTabDrafts.sort(byNewest);
  otherVersionDrafts.sort(byNewest);
  return {
    status: all.status,
    otherTabDrafts,
    otherVersionDrafts,
    drafts: [...otherTabDrafts, ...otherVersionDrafts],
  };
}

/** All drafts for one problem + version across tabs (newest first). */
export function listPracticeAnswerDrafts(
  userId: string,
  problemId: string,
  problemVersion: number
): PracticeAnswerDraft[] {
  return readAllDrafts(userId)
    .filter((d) => d.problemId === problemId && d.problemVersion === problemVersion)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Other tabs' drafts for the same problem + version (explicit recovery only). */
export function listOtherTabPracticeDrafts(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): PracticeAnswerDraft[] {
  return listPracticeAnswerDrafts(userId, problemId, problemVersion).filter((d) => d.tabId !== tabId);
}

/** Every draft for one problem regardless of version (older versions kept). */
export function listPracticeAnswerDraftsForProblem(
  userId: string,
  problemId: string
): PracticeAnswerDraft[] {
  return readAllDrafts(userId)
    .filter((d) => d.problemId === problemId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * Clears THIS tab's draft only when its stored content still matches the
 * recorded attempt. Other tabs' (or newer) drafts are never touched.
 */
export function clearPracticeAnswerDraft(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string,
  expected?: PracticeAnswerDraft
): boolean {
  if (!userId || !tabId) return false;
  const storage = getStorage();
  if (!storage) return false;
  const key = entryKey(userId, problemId, problemVersion, tabId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return true;
  if (expected) {
    try {
      const stored: unknown = JSON.parse(raw);
      if (!isValidDraft(stored) || !draftContentEquals(stored, expected)) {
        return false; // a newer/different draft is preserved
      }
    } catch {
      return false; // unreadable content is not proof that this is the submitted draft
    }
  }
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stable per-tab identifier.
//
// sessionStorage survives a refresh of the SAME tab, so a reload restores that
// tab's own draft. A browser DUPLICATE copies sessionStorage though, so a lease
// (nonce + heartbeat) distinguishes the cases:
//  - a live lease owned by a DIFFERENT nonce means another page still uses this
//    id -> fork a new id (never collide),
//  - the lease is released on pagehide (refresh/close) and expires after a TTL,
//    so a refreshed tab keeps its own id.
// ---------------------------------------------------------------------------

const TAB_ID_KEY = 'redcall_practice_tab_id_v1';
const TAB_LEASE_KEY = 'redcall_practice_tab_leases_v1';
const TAB_LEASE_TTL_MS = 15000;

type TabLeases = Record<string, { nonce: string; at: number; released?: boolean }>;

/** Page-instance identity: one per JS context, i.e. one per real page load. */
let pageInstanceNonce: string | null = null;

/**
 * Test seam: emulates a fresh page load (new JS context, same storages) so
 * refresh and duplication can be distinguished in tests exactly as browsers do.
 */
export function resetPracticeTabPageForTests(): void {
  pageInstanceNonce = null;
}

function readLeases(storage: Storage | null): TabLeases {
  if (!storage) return {};
  try {
    const raw = storage.getItem(TAB_LEASE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as TabLeases) : {};
  } catch {
    return {};
  }
}

function writeLeases(storage: Storage | null, leases: TabLeases): void {
  if (!storage) return;
  try {
    storage.setItem(TAB_LEASE_KEY, JSON.stringify(leases));
  } catch {
    // best effort
  }
}

function newTabToken(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Resolves a stable id for THIS tab, forking away from a live duplicate. */
export function resolvePracticeTabId(now: number = Date.now()): string {
  if (!pageInstanceNonce) pageInstanceNonce = newTabToken('page', now);
  const nonce = pageInstanceNonce;
  const session = getSessionStorage();
  const storage = getStorage();
  const leases = readLeases(storage);

  let tabId: string | null = null;
  try {
    tabId = session?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    tabId = null;
  }

  const lease = tabId ? leases[tabId] : undefined;
  const liveUnreleasedLease = lease && !lease.released && now - lease.at < TAB_LEASE_TTL_MS;
  if (tabId && liveUnreleasedLease && lease!.nonce !== nonce) {
    // A different LIVE page still owns this id (duplicated tab): fork.
    tabId = null;
  }
  if (!tabId) tabId = newTabToken('tab', now);

  try {
    session?.setItem(TAB_ID_KEY, tabId);
  } catch {
    // sessionStorage unavailable: the returned id is still usable this mount
  }
  leases[tabId] = { nonce, at: now };
  // Drop leases that are long stale so the map does not grow unbounded.
  for (const [id, entry] of Object.entries(leases)) {
    if (now - entry.at >= TAB_LEASE_TTL_MS * 20) delete leases[id];
  }
  writeLeases(storage, leases);
  return tabId;
}

/**
 * Keeps this page's lease fresh during active editing. Never takes over an id
 * that a live page with a different nonce currently owns.
 */
export function refreshPracticeTabLease(tabId: string, now: number = Date.now()): void {
  if (!tabId || !pageInstanceNonce) return;
  const storage = getStorage();
  const leases = readLeases(storage);
  const existing = leases[tabId];
  if (existing && existing.nonce !== pageInstanceNonce && now - existing.at < TAB_LEASE_TTL_MS) {
    return;
  }
  leases[tabId] = { nonce: pageInstanceNonce, at: now };
  writeLeases(storage, leases);
}

/**
 * Releases this page's own lease on pagehide so a refresh keeps the same id.
 * A lease owned by a different live page is never touched.
 */
export function releasePracticeTabLease(tabId: string): void {
  if (!tabId || !pageInstanceNonce) return;
  const storage = getStorage();
  const leases = readLeases(storage);
  const entry = leases[tabId];
  if (!entry || entry.nonce !== pageInstanceNonce) return;
  delete leases[tabId];
  writeLeases(storage, leases);
}

