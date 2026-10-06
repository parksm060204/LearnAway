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

function isValidDraft(value: unknown): value is PracticeAnswerDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<PracticeAnswerDraft>;
  return typeof d.problemId === 'string' && typeof d.problemVersion === 'number' && typeof d.tabId === 'string';
}

/** One-time migration of the previous shared-blob format into per-entry keys. */
function migrateLegacyBlob(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  const raw = storage.getItem(legacyKey(userId));
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // unreadable: keep it untouched
  }
  if (!parsed || typeof parsed !== 'object') return;
  const entries = Object.entries(parsed as Record<string, unknown>);
  const drafts: PracticeAnswerDraft[] = [];
  for (const [storedKey, value] of entries) {
    if (!value || typeof value !== 'object') return; // malformed: abort, keep original
    const candidate = value as Partial<PracticeAnswerDraft>;
    const tabIdFromKey = storedKey.includes('::') ? storedKey.split('::')[1] : undefined;
    const tabId = candidate.tabId ?? tabIdFromKey;
    if (typeof candidate.problemId !== 'string' || typeof candidate.problemVersion !== 'number' || !tabId) {
      return; // cannot safely migrate: keep the original
    }
    drafts.push({ ...(candidate as PracticeAnswerDraft), tabId });
  }
  // Write every entry first; only remove the legacy blob once all are verified.
  for (const draft of drafts) {
    if (!writeEntry(userId, draft)) return;
  }
  try {
    storage.removeItem(legacyKey(userId));
  } catch {
    // readable-only storage: entries are already present
  }
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

function readAllDrafts(userId: string): PracticeAnswerDraft[] {
  if (!userId) return [];
  migrateLegacyBlob(userId);
  const storage = getStorage();
  if (!storage) return [];
  const prefix = `${userPrefix(userId)}__`;
  const out: PracticeAnswerDraft[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidDraft(parsed)) out.push(parsed);
      } catch {
        // ignore a corrupt entry rather than losing the others
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** Saves (or replaces) THIS tab's draft for one problem. */
export function savePracticeAnswerDraft(userId: string, draft: PracticeAnswerDraft): boolean {
  if (!userId || !draft?.tabId) return false;
  return writeEntry(userId, draft);
}

/** This tab's own draft for one problem + version (never another tab's). */
export function loadPracticeAnswerDraftForTab(
  userId: string,
  problemId: string,
  problemVersion: number,
  tabId: string
): PracticeAnswerDraft | null {
  if (!userId || !tabId) return null;
  migrateLegacyBlob(userId);
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(entryKey(userId, problemId, problemVersion, tabId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
      if (isValidDraft(stored) && !draftContentEquals(stored, expected)) {
        return false; // a newer/different draft is preserved
      }
    } catch {
      // fall through and attempt the removal
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
const TAB_NONCE_KEY = 'redcall_practice_tab_nonce_v1';
const TAB_LEASE_KEY = 'redcall_practice_tab_leases_v1';
const TAB_LEASE_TTL_MS = 15000;

type TabLeases = Record<string, { nonce: string; at: number }>;

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
  const session = getSessionStorage();
  const storage = getStorage();
  const nonce = newTabToken('n', now);
  const leases = readLeases(storage);

  let tabId: string | null = null;
  try {
    tabId = session?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    tabId = null;
  }

  const lease = tabId ? leases[tabId] : undefined;
  const liveLease = lease && now - lease.at < TAB_LEASE_TTL_MS;
  if (tabId && liveLease && lease!.nonce !== nonce) {
    // A different live page still owns this id (duplicated tab): fork.
    tabId = null;
  }
  if (!tabId) tabId = newTabToken('tab', now);

  try {
    session?.setItem(TAB_ID_KEY, tabId);
    session?.setItem(TAB_NONCE_KEY, nonce);
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

/** Keeps this tab's lease fresh during active editing. */
export function refreshPracticeTabLease(tabId: string, now: number = Date.now()): void {
  if (!tabId) return;
  const session = getSessionStorage();
  const storage = getStorage();
  let nonce: string | null = null;
  try {
    nonce = session?.getItem(TAB_NONCE_KEY) ?? null;
  } catch {
    nonce = null;
  }
  if (!nonce) return;
  const leases = readLeases(storage);
  leases[tabId] = { nonce, at: now };
  writeLeases(storage, leases);
}

/** Releases this tab's lease on pagehide so a refresh keeps the same id. */
export function releasePracticeTabLease(tabId: string): void {
  if (!tabId) return;
  const session = getSessionStorage();
  const storage = getStorage();
  let nonce: string | null = null;
  try {
    nonce = session?.getItem(TAB_NONCE_KEY) ?? null;
  } catch {
    nonce = null;
  }
  const leases = readLeases(storage);
  const entry = leases[tabId];
  if (!entry) return;
  if (nonce && entry.nonce !== nonce) return; // a different page owns it now
  delete leases[tabId];
  writeLeases(storage, leases);
}

