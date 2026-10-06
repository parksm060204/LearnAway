'use client';

import type { ErrorType } from './types';

/**
 * Per-user, per-problem, PER-TAB preservation of UNSAVED problem-practice input.
 *
 * General practice has no server-side draft row: an answer only becomes durable
 * when the user records the attempt. This store keeps the in-progress editor
 * state on this device, keyed by account + problem + browser tab, so:
 *  - a refresh / menu move / browser restart restores the LATEST input,
 *  - two tabs on the same problem never silently overwrite each other,
 *  - recording an attempt clears only drafts whose content was recorded; a
 *    newer draft typed in another tab (or during the save) is kept.
 */
export interface PracticeAnswerDraft {
  problemId: string;
  /** Problem version the draft was typed against (identity check on restore). */
  problemVersion: number;
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

function key(userId: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${BASE}`;
}

function entryKey(problemId: string, tabId: string): string {
  return `${problemId}::${tabId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function readAll(userId: string): Record<string, PracticeAnswerDraft> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key(userId)) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PracticeAnswerDraft>) : {};
  } catch {
    return {};
  }
}

function writeAll(userId: string, all: Record<string, PracticeAnswerDraft>): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(all);
    storage.setItem(key(userId), serialized);
    // Read back: a write that could not be persisted is never reported as saved.
    return storage.getItem(key(userId)) === serialized;
  } catch {
    return false;
  }
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
 * A draft is applied only to the SAME problem and the SAME version it was typed
 * against; a different version is never silently restored on top of new content.
 */
export function draftMatchesProblem(
  draft: PracticeAnswerDraft,
  problemId: string,
  problemVersion: number
): boolean {
  return draft.problemId === problemId && draft.problemVersion === problemVersion;
}

/** Compares every typed-content field, ignoring the write timestamp. */
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

/** All drafts for one problem across tabs (newest first). */
export function listPracticeAnswerDrafts(userId: string, problemId: string): PracticeAnswerDraft[] {
  if (!userId) return [];
  return Object.values(readAll(userId))
    .filter((d) => d && d.problemId === problemId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** The LATEST draft for a problem across all tabs of this account. */
export function loadPracticeAnswerDraft(userId: string, problemId: string): PracticeAnswerDraft | null {
  return listPracticeAnswerDrafts(userId, problemId)[0] ?? null;
}

/** Saves (or replaces) THIS tab's draft for one problem. Returns false when unverified. */
export function savePracticeAnswerDraft(userId: string, tabId: string, draft: PracticeAnswerDraft): boolean {
  if (!userId || !tabId) return false;
  const all = readAll(userId);
  all[entryKey(draft.problemId, tabId)] = draft;
  return writeAll(userId, all);
}

/**
 * Clears only the drafts whose stored content matches the recorded attempt.
 * Drafts from OTHER tabs (or newer input) are kept untouched.
 */
export function clearPracticeAnswerDraft(
  userId: string,
  problemId: string,
  expected?: PracticeAnswerDraft
): boolean {
  if (!userId) return false;
  const all = readAll(userId);
  const matched = Object.keys(all).filter((k) => {
    const stored = all[k];
    if (!stored || stored.problemId !== problemId) return false;
    return !expected || draftContentEquals(stored, expected);
  });
  if (matched.length === 0) return true;
  for (const k of matched) delete all[k];
  return writeAll(userId, all);
}
