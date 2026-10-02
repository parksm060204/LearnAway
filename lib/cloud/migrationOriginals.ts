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
 * Migration originals are the account's local records as they existed BEFORE
 * the first cloud load. They live in a dedicated namespace (keys + IndexedDB
 * scope) so the cloud server cache — which is mirrored into the normal user
 * scope for runtime reads — can never overwrite them.
 */

const USER_PREFIX = 'redcall_user_';
const ORIGIN_SUBJECTS = 'origin_subjects_v1';
const ORIGIN_MATERIALS = 'origin_materials_v1';
const ORIGIN_SNAPSHOT = 'origin_snapshot_v1';

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

/**
 * Snapshots the current account's local subjects/materials (metadata + bodies)
 * exactly once, before any cloud mirror writes to the live user scope. Returns
 * a failure (and the caller must not mirror) if preservation cannot be
 * verified, so local originals are never silently lost.
 */
export async function ensureMigrationOriginals(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = getStorage();
  if (!storage) return { ok: false, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  if (hasOriginSnapshot(userId)) return { ok: true };

  const subjectsRaw = storage.getItem(userBaseKey(userId, 'subjects_v1'));
  const materialsRaw = storage.getItem(userBaseKey(userId, 'materials_v1'));

  try {
    if (subjectsRaw !== null) JSON.parse(subjectsRaw);
    if (materialsRaw !== null) JSON.parse(materialsRaw);
  } catch {
    return { ok: false, error: '기존 로컬 기록을 읽지 못해 클라우드 동기화를 중단했습니다.' };
  }

  // Copy IndexedDB bodies first so cloud body caching cannot overwrite them.
  const copied = await importMaterialContentsFromScope(
    userIdToScopeId(userId),
    originScopeId(userId)
  );
  if (!copied.verified) {
    return {
      ok: false,
      error: `로컬 자료 본문을 보존하지 못해 클라우드 동기화를 중단했습니다. (${copied.error ?? '검증 실패'})`,
    };
  }

  try {
    if (subjectsRaw !== null) storage.setItem(userBaseKey(userId, ORIGIN_SUBJECTS), subjectsRaw);
    if (materialsRaw !== null) storage.setItem(userBaseKey(userId, ORIGIN_MATERIALS), materialsRaw);
    storage.setItem(userBaseKey(userId, ORIGIN_SNAPSHOT), JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    return { ok: false, error: '로컬 원본을 보존하지 못해 클라우드 동기화를 중단했습니다.' };
  }

  // Read-back verification before allowing the cloud mirror to proceed.
  if (!hasOriginSnapshot(userId)) {
    return { ok: false, error: '로컬 원본 보존을 검증하지 못했습니다.' };
  }
  if (
    subjectsRaw !== null &&
    storage.getItem(userBaseKey(userId, ORIGIN_SUBJECTS)) !== subjectsRaw
  ) {
    return { ok: false, error: '과목 원본 보존을 검증하지 못했습니다.' };
  }
  if (
    materialsRaw !== null &&
    storage.getItem(userBaseKey(userId, ORIGIN_MATERIALS)) !== materialsRaw
  ) {
    return { ok: false, error: '자료 원본 보존을 검증하지 못했습니다.' };
  }
  return { ok: true };
}

export type MigrationOriginalsResult =
  | { ok: true; subjects: Subject[]; materials: Material[]; source: 'origin' | 'live' }
  | { ok: false; error: string };

/** Reads the migration originals (snapshot if present, else the live records). */
export function loadMigrationOriginals(userId: string): MigrationOriginalsResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  const useOrigin = hasOriginSnapshot(userId);

  const read = (base: string): { ok: true; value: unknown[] } | { ok: false; error: string } => {
    const key = useOrigin ? userBaseKey(userId, `origin_${base}`) : userBaseKey(userId, base);
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return { ok: false, error: '로컬 기록을 읽지 못했습니다.' };
    }
    if (raw === null) return { ok: true, value: [] };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { ok: false, error: '로컬 기록 형식이 올바르지 않습니다.' };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: '로컬 기록 JSON을 읽지 못했습니다.' };
    }
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
