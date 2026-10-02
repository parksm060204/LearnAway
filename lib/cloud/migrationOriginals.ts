'use client';

import {
  importMaterialContentsFromScope,
  loadMaterialContentFromScope,
  loadMaterialContentResult,
  type MaterialLoadResult,
} from '../materialStorage';
import { setStorageScope, userIdToScopeId } from '../storageScope';
import type { Material, Subject } from '../types';

/**
 * Migration originals are the account's local records that should be offered
 * for cloud migration. They live in a dedicated namespace (keys + IndexedDB
 * scope) so the cloud server cache — mirrored into the normal user scope for
 * runtime reads — can never overwrite them.
 *
 * Preservation is a MERGE, never an overwrite: a record id that already exists
 * in the origin area is kept as-is (the user's already-preserved original
 * wins); only new ids are added. This lets a legacy import that happens after
 * the first (possibly empty) snapshot still become a migration target.
 */

const USER_PREFIX = 'redcall_user_';
const ORIGIN_SUBJECTS = 'origin_subjects_v1';
const ORIGIN_MATERIALS = 'origin_materials_v1';
const ORIGIN_SNAPSHOT = 'origin_snapshot_v1';
const SERVER_CACHE = 'server_cache_v1';

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

export function originScopeId(userId: string): string {
  return `origin_${userIdToScopeId(userId)}`;
}

export function hasOriginSnapshot(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, ORIGIN_SNAPSHOT)) !== null;
  } catch {
    return false;
  }
}

/** True once the server library has been mirrored into the live user scope. */
export function hasServerCache(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, SERVER_CACHE)) !== null;
  } catch {
    return false;
  }
}

export function markServerCache(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(userBaseKey(userId, SERVER_CACHE), JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    // best effort
  }
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

interface MergeOutcome {
  merged: unknown[];
  added: number;
  conflicts: number;
}

/** Union by id; the existing origin record always wins on a conflict. */
function mergeById(originList: unknown[], liveList: unknown[]): MergeOutcome {
  const byId = new Map<string, unknown>();
  for (const record of originList) {
    if (record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string') {
      byId.set((record as { id: string }).id, record);
    }
  }
  let added = 0;
  let conflicts = 0;
  for (const record of liveList) {
    if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') {
      continue;
    }
    const id = (record as { id: string }).id;
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, record);
      added += 1;
    } else if (JSON.stringify(existing) !== JSON.stringify(record)) {
      // Preserve the already-stored original; do not overwrite it.
      conflicts += 1;
    }
  }
  return { merged: Array.from(byId.values()), added, conflicts };
}

export interface MigrationOriginalsResult {
  ok: boolean;
  addedSubjects: number;
  addedMaterials: number;
  conflicts: number;
  error?: string;
}

/**
 * Merges the current account's live local subjects/materials (metadata + bodies)
 * into the migration-originals area. Idempotent and non-destructive: existing
 * originals are never overwritten. Returns a failure (and the caller must not
 * mirror the cloud cache) if preservation cannot be verified.
 */
export async function ensureMigrationOriginals(userId: string): Promise<MigrationOriginalsResult> {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  }

  const liveSubjects = readArrayKey(storage, userBaseKey(userId, 'subjects_v1'));
  if (!liveSubjects.ok) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: liveSubjects.error };
  }
  const liveMaterials = readArrayKey(storage, userBaseKey(userId, 'materials_v1'));
  if (!liveMaterials.ok) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: liveMaterials.error };
  }
  const originSubjects = readArrayKey(storage, userBaseKey(userId, ORIGIN_SUBJECTS));
  if (!originSubjects.ok) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: originSubjects.error };
  }
  const originMaterials = readArrayKey(storage, userBaseKey(userId, ORIGIN_MATERIALS));
  if (!originMaterials.ok) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: originMaterials.error };
  }

  const subjects = mergeById(originSubjects.value, liveSubjects.value);
  const materials = mergeById(originMaterials.value, liveMaterials.value);

  // Copy IndexedDB bodies into the origin scope. Existing origin bodies are
  // kept (conflicts are reported, not overwritten).
  const copied = await importMaterialContentsFromScope(
    userIdToScopeId(userId),
    originScopeId(userId)
  );
  const bodyFailures = copied.readFailed + copied.writeFailed + copied.aborted + copied.verifyFailed;
  if (bodyFailures > 0) {
    return {
      ok: false,
      addedSubjects: 0,
      addedMaterials: 0,
      conflicts: 0,
      error: `로컬 자료 본문을 보존하지 못해 클라우드 동기화를 중단했습니다. (${copied.error ?? '검증 실패'})`,
    };
  }
  const conflicts = subjects.conflicts + materials.conflicts + copied.conflicts;

  const subjectsJson = JSON.stringify(subjects.merged);
  const materialsJson = JSON.stringify(materials.merged);
  const snapshotJson = JSON.stringify({
    at: new Date().toISOString(),
    addedSubjects: subjects.added,
    addedMaterials: materials.added,
    conflicts,
  });

  try {
    storage.setItem(userBaseKey(userId, ORIGIN_SUBJECTS), subjectsJson);
    storage.setItem(userBaseKey(userId, ORIGIN_MATERIALS), materialsJson);
    storage.setItem(userBaseKey(userId, ORIGIN_SNAPSHOT), snapshotJson);
  } catch {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: '로컬 원본을 보존하지 못해 클라우드 동기화를 중단했습니다.' };
  }

  // Read-back verification before allowing the cloud mirror to proceed.
  if (storage.getItem(userBaseKey(userId, ORIGIN_SUBJECTS)) !== subjectsJson) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: '과목 원본 보존을 검증하지 못했습니다.' };
  }
  if (storage.getItem(userBaseKey(userId, ORIGIN_MATERIALS)) !== materialsJson) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: '자료 원본 보존을 검증하지 못했습니다.' };
  }
  if (storage.getItem(userBaseKey(userId, ORIGIN_SNAPSHOT)) !== snapshotJson) {
    return { ok: false, addedSubjects: 0, addedMaterials: 0, conflicts: 0, error: '원본 스냅샷을 검증하지 못했습니다.' };
  }

  return {
    ok: true,
    addedSubjects: subjects.added,
    addedMaterials: materials.added,
    conflicts,
  };
}

export type MigrationOriginalsReadResult =
  | { ok: true; subjects: Subject[]; materials: Material[]; source: 'origin' | 'live' }
  | { ok: false; error: string };

/** Reads the migration originals (snapshot if present, else the live records). */
export function loadMigrationOriginals(userId: string): MigrationOriginalsReadResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  const useOrigin = hasOriginSnapshot(userId);

  const read = (base: string): ReadResult => {
    const key = useOrigin ? userBaseKey(userId, `origin_${base}`) : userBaseKey(userId, base);
    return readArrayKey(storage, key);
  };

  const subjects = read('subjects_v1');
  if (!subjects.ok) return subjects;
  const materials = read('materials_v1');
  if (!materials.ok) return materials;

  return {
    ok: true,
    subjects: subjects.value as Subject[],
    materials: materials.value as Material[],
    source: useOrigin ? 'origin' : 'live',
  };
}

/** True when there is any migration original (parse errors count as "has data"). */
export function hasMigrationOriginals(userId: string): boolean {
  const loaded = loadMigrationOriginals(userId);
  if (!loaded.ok) return true;
  return loaded.subjects.length > 0 || loaded.materials.length > 0;
}

/** Reads a body from the migration originals (snapshot scope when available). */
export async function loadOriginalMaterialContent(
  userId: string,
  materialId: string
): Promise<MaterialLoadResult> {
  if (hasOriginSnapshot(userId)) {
    return loadMaterialContentFromScope(originScopeId(userId), materialId);
  }
  setStorageScope({ kind: 'user', userId });
  return loadMaterialContentResult(materialId);
}
