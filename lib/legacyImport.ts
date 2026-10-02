/**
 * Explicit opt-in import of the pre-login ("legacy") local records into a
 * signed-in user's local namespace.
 *
 * Rules enforced here:
 *  - Legacy records are never deleted or auto-attributed.
 *  - Import never overwrites a user key that already has data.
 *  - Re-running the import is idempotent (existing keys are skipped).
 *  - The "completed" marker is only written after verification succeeds.
 *
 * This only moves browser-local data. It does not upload anything to Supabase.
 */

import { importMaterialContentsFromScope, listMaterialIdsInScope } from './materialStorage';

const LEGACY_PREFIX = 'redcall_';
const USER_PREFIX = 'redcall_user_';
const MARKER_BASE = 'legacy_import_v1';
const DECLINED_BASE = 'legacy_import_declined_v1';

export interface LegacyImportState {
  imported: boolean;
  declined: boolean;
  hasLegacyData: boolean;
}

export interface LegacyImportResult {
  verified: boolean;
  localStorageCopied: number;
  localStorageSkipped: number;
  materialsCopied: number;
  materialsSkipped: number;
  materialsAvailable: boolean;
  message: string;
}

function userBaseKey(userId: string, base: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${base}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // access can throw in privacy mode
  }
  return null;
}

export function listLegacyStorageBases(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  const bases: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const rawKey = storage.key(i);
      if (!rawKey) continue;
      if (!rawKey.startsWith(LEGACY_PREFIX)) continue;
      if (rawKey.startsWith(USER_PREFIX)) continue;
      bases.push(rawKey.slice(LEGACY_PREFIX.length));
    }
  } catch {
    return [];
  }
  return bases;
}

export function hasLegacyLocalData(): boolean {
  return listLegacyStorageBases().some((base) => {
    const storage = getStorage();
    if (!storage) return false;
    try {
      return storage.getItem(`${LEGACY_PREFIX}${base}`) !== null;
    } catch {
      return false;
    }
  });
}

export function isLegacyImportCompleted(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null;
  } catch {
    return false;
  }
}

export function isLegacyImportDeclined(userId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(userBaseKey(userId, DECLINED_BASE)) !== null;
  } catch {
    return false;
  }
}

export async function getLegacyImportState(userId: string): Promise<LegacyImportState> {
  const imported = isLegacyImportCompleted(userId);
  const declined = isLegacyImportDeclined(userId);
  const localData = hasLegacyLocalData();
  let hasMaterialData = false;
  if (!localData) {
    const ids = await listMaterialIdsInScope('shared');
    hasMaterialData = Boolean(ids && ids.length > 0);
  }
  return { imported, declined, hasLegacyData: localData || hasMaterialData };
}

export function declineLegacyImport(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      userBaseKey(userId, DECLINED_BASE),
      JSON.stringify({ declinedAt: new Date().toISOString() })
    );
  } catch {
    // best effort
  }
}

export async function importLegacyData(userId: string): Promise<LegacyImportResult> {
  const storage = getStorage();
  if (!storage) {
    return {
      verified: false,
      localStorageCopied: 0,
      localStorageSkipped: 0,
      materialsCopied: 0,
      materialsSkipped: 0,
      materialsAvailable: false,
      message: '브라우저 로컬 저장소를 사용할 수 없어 가져오기를 진행하지 못했습니다.',
    };
  }

  const bases = listLegacyStorageBases();
  let localStorageCopied = 0;
  let localStorageSkipped = 0;
  const considered: Array<{ base: string; legacyValue: string }> = [];

  for (const base of bases) {
    const legacyKey = `${LEGACY_PREFIX}${base}`;
    let legacyValue: string | null = null;
    try {
      legacyValue = storage.getItem(legacyKey);
    } catch {
      legacyValue = null;
    }
    if (legacyValue === null) continue;

    const targetKey = userBaseKey(userId, base);
    let existing: string | null = null;
    try {
      existing = storage.getItem(targetKey);
    } catch {
      existing = null;
    }

    if (existing === null) {
      try {
        storage.setItem(targetKey, legacyValue);
        localStorageCopied += 1;
      } catch {
        // leave for verification to fail
      }
    } else {
      localStorageSkipped += 1;
    }
    considered.push({ base, legacyValue });
  }

  const materials = await importMaterialContentsFromScope('shared');

  // Verify every considered base now resolves to the legacy value.
  let verified = true;
  for (const { base, legacyValue } of considered) {
    try {
      if (storage.getItem(userBaseKey(userId, base)) !== legacyValue) {
        verified = false;
        break;
      }
    } catch {
      verified = false;
      break;
    }
  }
  if (materials.error) verified = false;

  if (verified) {
    try {
      storage.setItem(
        userBaseKey(userId, MARKER_BASE),
        JSON.stringify({
          completed: true,
          completedAt: new Date().toISOString(),
          localStorageCopied,
          materialsCopied: materials.copied,
        })
      );
    } catch {
      verified = false;
    }
  }

  return {
    verified,
    localStorageCopied,
    localStorageSkipped,
    materialsCopied: materials.copied,
    materialsSkipped: materials.skipped,
    materialsAvailable: materials.available,
    message: verified
      ? `기존 학습 기록을 가져왔습니다. (항목 ${localStorageCopied}개, 자료 본문 ${materials.copied}개)`
      : '가져오기를 완료하지 못했습니다. 다시 시도해 주세요. 기존 기록은 그대로 보존됩니다.',
  };
}
