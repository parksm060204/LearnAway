'use client';

import type { Concept, ConceptDraft, Problem, ProblemDraft } from '../types';

/**
 * Learning migration originals live in a dedicated namespace so the server
 * cache — mirrored into the live user scope for runtime reads — can never delete
 * un-migrated local concepts/problems. Records already migrated (or already on
 * the server) are excluded, so a server-side delete is never resurrected.
 */

const USER_PREFIX = 'redcall_user_';
const ORIGIN_MARKER = 'origin_learning_snapshot_v1';
const SERVER_CACHE = 'learning_server_cache_v1';
const MIGRATED_IDS = 'learning_migrated_ids_v1';

const CATEGORIES = [
  { live: 'concepts_v1', origin: 'origin_learning_concepts_v1' },
  { live: 'concept_drafts_v1', origin: 'origin_learning_concept_drafts_v1' },
  { live: 'problems_v1', origin: 'origin_learning_problems_v1' },
  { live: 'problem_drafts_v1', origin: 'origin_learning_problem_drafts_v1' },
] as const;

function userBaseKey(userId: string, base: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${base}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

type ReadResult = { ok: true; value: unknown[] } | { ok: false; error: string };

function readArrayKey(storage: Storage, key: string): ReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, error: '로컬 기록을 읽지 못했습니다.' };
  }
  if (raw === null) return { ok: true, value: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, error: '로컬 기록 형식이 올바르지 않습니다.' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: '로컬 기록 JSON을 읽지 못했습니다.' };
  }
}

function idOf(record: unknown): string | null {
  if (record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string') {
    return (record as { id: string }).id;
  }
  return null;
}

export function hasLearningOriginSnapshot(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, ORIGIN_MARKER)) !== null;
  } catch {
    return false;
  }
}

export function hasLearningServerCache(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, SERVER_CACHE)) !== null;
  } catch {
    return false;
  }
}

export function markLearningServerCache(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(userBaseKey(userId, SERVER_CACHE), JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    // best effort
  }
}

export function getMigratedIds(userId: string): Set<string> {
  const storage = getStorage();
  if (!storage) return new Set();
  const read = readArrayKey(storage, userBaseKey(userId, MIGRATED_IDS));
  if (!read.ok) return new Set();
  return new Set(read.value.filter((v): v is string => typeof v === 'string'));
}

export function recordMigratedIds(userId: string, ids: string[]): void {
  const storage = getStorage();
  if (!storage || ids.length === 0) return;
  const existing = getMigratedIds(userId);
  for (const id of ids) existing.add(id);
  try {
    storage.setItem(userBaseKey(userId, MIGRATED_IDS), JSON.stringify(Array.from(existing)));
  } catch {
    // best effort
  }
}

/**
 * Merges the live records that are NOT on the server and NOT already migrated
 * into the originals (existing originals win). Must run BEFORE the server cache
 * overwrites the live scope. Read-back verified; failure means the caller must
 * not mirror.
 */
export function ensureLearningOriginals(
  userId: string,
  serverIds: Set<string>
): { ok: true } | { ok: false; error: string } {
  const storage = getStorage();
  if (!storage) return { ok: false, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  const migrated = getMigratedIds(userId);

  for (const category of CATEGORIES) {
    const live = readArrayKey(storage, userBaseKey(userId, category.live));
    if (!live.ok) return { ok: false, error: live.error };
    const origin = readArrayKey(storage, userBaseKey(userId, category.origin));
    if (!origin.ok) return { ok: false, error: origin.error };

    const byId = new Map<string, unknown>();
    for (const record of origin.value) {
      const id = idOf(record);
      if (id) byId.set(id, record);
    }
    for (const record of live.value) {
      const id = idOf(record);
      if (!id) continue;
      if (serverIds.has(id) || migrated.has(id)) continue;
      if (!byId.has(id)) byId.set(id, record);
    }

    const serialized = JSON.stringify(Array.from(byId.values()));
    try {
      storage.setItem(userBaseKey(userId, category.origin), serialized);
    } catch {
      return { ok: false, error: '학습 콘텐츠 원본을 보존하지 못해 클라우드 동기화를 중단했습니다.' };
    }
    if (storage.getItem(userBaseKey(userId, category.origin)) !== serialized) {
      return { ok: false, error: '학습 콘텐츠 원본 보존을 검증하지 못했습니다.' };
    }
  }

  try {
    storage.setItem(userBaseKey(userId, ORIGIN_MARKER), JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    return { ok: false, error: '학습 콘텐츠 원본 스냅샷을 저장하지 못했습니다.' };
  }
  if (!hasLearningOriginSnapshot(userId)) {
    return { ok: false, error: '학습 콘텐츠 원본 스냅샷을 검증하지 못했습니다.' };
  }
  return { ok: true };
}

export interface LearningOriginals {
  concepts: Concept[];
  conceptDrafts: ConceptDraft[];
  problems: Problem[];
  problemDrafts: ProblemDraft[];
  source: 'origin' | 'live';
}

export function loadLearningOriginals(
  userId: string
): { ok: true; data: LearningOriginals } | { ok: false; error: string } {
  const storage = getStorage();
  if (!storage) return { ok: false, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  const useOrigin = hasLearningOriginSnapshot(userId);

  // Explicit per-category key selection.
  const conceptKey = useOrigin ? 'origin_learning_concepts_v1' : 'concepts_v1';
  const conceptDraftKey = useOrigin ? 'origin_learning_concept_drafts_v1' : 'concept_drafts_v1';
  const problemKey = useOrigin ? 'origin_learning_problems_v1' : 'problems_v1';
  const problemDraftKey = useOrigin ? 'origin_learning_problem_drafts_v1' : 'problem_drafts_v1';

  const concepts = readArrayKey(storage, userBaseKey(userId, conceptKey));
  if (!concepts.ok) return { ok: false, error: concepts.error };
  const conceptDrafts = readArrayKey(storage, userBaseKey(userId, conceptDraftKey));
  if (!conceptDrafts.ok) return { ok: false, error: conceptDrafts.error };
  const problems = readArrayKey(storage, userBaseKey(userId, problemKey));
  if (!problems.ok) return { ok: false, error: problems.error };
  const problemDrafts = readArrayKey(storage, userBaseKey(userId, problemDraftKey));
  if (!problemDrafts.ok) return { ok: false, error: problemDrafts.error };

  return {
    ok: true,
    data: {
      concepts: concepts.value as Concept[],
      conceptDrafts: conceptDrafts.value as ConceptDraft[],
      problems: problems.value as Problem[],
      problemDrafts: problemDrafts.value as ProblemDraft[],
      source: useOrigin ? 'origin' : 'live',
    },
  };
}
