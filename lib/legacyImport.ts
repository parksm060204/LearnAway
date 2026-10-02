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

import {
  importMaterialContentsFromScope,
  isMaterialImportVerified,
  listMaterialIdsInScope,
} from './materialStorage';

const LEGACY_PREFIX = 'redcall_';
const USER_PREFIX = 'redcall_user_';
const MARKER_BASE = 'legacy_import_v1';
const DECLINED_BASE = 'legacy_import_declined_v1';

/**
 * Record keys that belong to one account and reference each other by id
 * (materials/concepts/problems reference subjects, attempts reference concepts,
 * etc.). Import is only allowed when the target account has none of these, so a
 * partial merge can never leave dangling references.
 */
const OWNED_RECORD_BASES = new Set([
  'subjects_v1',
  'materials_v1',
  'concepts_v1',
  'concept_drafts_v1',
  'problems_v1',
  'problem_drafts_v1',
  'attempts_v1',
  'mock_exam_sessions_v1',
  'logic_sessions_v1',
  'rechallenge_reservations_v1',
  'study_plan_items_v1',
]);

export interface LegacyImportState {
  imported: boolean;
  declined: boolean;
  hasLegacyData: boolean;
  /** Target account already has its own records; import is not allowed. */
  conflict: boolean;
}

export interface LegacyImportResult {
  verified: boolean;
  conflict: boolean;
  localStorageCopied: number;
  localStorageSkipped: number;
  materialsCopied: number;
  materialsSkipped: number;
  materialsFailed: number;
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

/** True when the given side already has its own account-owned records. */
function hasOwnedRecords(userId: string, side: 'legacy' | 'target'): boolean {
  const storage = getStorage();
  if (!storage) return false;
  const targetPrefix = userBaseKey(userId, '');
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const rawKey = storage.key(i);
      if (!rawKey) continue;
      if (side === 'legacy') {
        if (!rawKey.startsWith(LEGACY_PREFIX) || rawKey.startsWith(USER_PREFIX)) continue;
        if (OWNED_RECORD_BASES.has(rawKey.slice(LEGACY_PREFIX.length))) return true;
      } else {
        if (!rawKey.startsWith(targetPrefix)) continue;
        if (OWNED_RECORD_BASES.has(rawKey.slice(targetPrefix.length))) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
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
  const conflict = hasOwnedRecords(userId, 'target');
  return { imported, declined, hasLegacyData: localData || hasMaterialData, conflict };
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

function conflictResult(): LegacyImportResult {
  return {
    verified: false,
    conflict: true,
    localStorageCopied: 0,
    localStorageSkipped: 0,
    materialsCopied: 0,
    materialsSkipped: 0,
    materialsFailed: 0,
    materialsAvailable: true,
    message:
      '이미 이 계정에 학습 기록이 있어 기존 공용 기록을 자동으로 가져올 수 없습니다. 자동 병합은 하지 않으며, 현재 계정 기록은 그대로 유지됩니다.',
  };
}

export async function importLegacyData(userId: string): Promise<LegacyImportResult> {
  const storage = getStorage();
  if (!storage) {
    return {
      verified: false,
      conflict: false,
      localStorageCopied: 0,
      localStorageSkipped: 0,
      materialsCopied: 0,
      materialsSkipped: 0,
      materialsFailed: 0,
      materialsAvailable: false,
      message: '브라우저 로컬 저장소를 사용할 수 없어 가져오기를 진행하지 못했습니다.',
    };
  }

  // A completed import is a no-op so retries stay idempotent and do not look
  // like a conflict.
  if (isLegacyImportCompleted(userId)) {
    return {
      verified: true,
      conflict: false,
      localStorageCopied: 0,
      localStorageSkipped: 0,
      materialsCopied: 0,
      materialsSkipped: 0,
      materialsFailed: 0,
      materialsAvailable: true,
      message: '기존 학습 기록 가져오기가 이미 완료되었습니다.',
    };
  }

  // Conflict check before copying anything: never partially merge two accounts'
  // interlinked records.
  if (hasOwnedRecords(userId, 'target')) {
    return conflictResult();
  }

  const bases = listLegacyStorageBases();
  let localStorageCopied = 0;
  let localStorageSkipped = 0;
  let localStorageFailed = 0;
  const considered: Array<{ base: string; legacyValue: string }> = [];
  // Keys this attempt created, removed again if the import is not verified so
  // the account stays empty and a retry is not blocked as a conflict.
  const writtenTargetKeys: string[] = [];

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
        writtenTargetKeys.push(targetKey);
      } catch {
        localStorageFailed += 1;
      }
    } else {
      localStorageSkipped += 1;
    }
    considered.push({ base, legacyValue });
  }

  const materials = await importMaterialContentsFromScope('shared');

  // Verify every considered base now resolves to the legacy value.
  let localVerified = localStorageFailed === 0;
  for (const { base, legacyValue } of considered) {
    try {
      if (storage.getItem(userBaseKey(userId, base)) !== legacyValue) {
        localVerified = false;
        break;
      }
    } catch {
      localVerified = false;
      break;
    }
  }

  // Material bodies must have copied and re-verified before completion.
  const materialsVerified = isMaterialImportVerified(materials);
  const verified = localVerified && materialsVerified;

  if (!verified) {
    // Roll back this attempt's localStorage writes so the account returns to an
    // empty state and the import can be retried safely.
    for (const key of writtenTargetKeys) {
      try {
        storage.removeItem(key);
      } catch {
        // best effort
      }
    }
  }

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
      // If the completion marker cannot be written, do not claim success.
      return {
        verified: false,
        conflict: false,
        localStorageCopied,
        localStorageSkipped,
        materialsCopied: materials.copied,
        materialsSkipped: materials.skipped,
        materialsFailed: materials.failed,
        materialsAvailable: materials.available,
        message: '가져오기는 됐지만 완료 표시를 저장하지 못했습니다. 다시 시도해 주세요. 기존 기록은 보존됩니다.',
      };
    }
  }

  return {
    verified,
    conflict: false,
    localStorageCopied,
    localStorageSkipped,
    materialsCopied: materials.copied,
    materialsSkipped: materials.skipped,
    materialsFailed: materials.failed,
    materialsAvailable: materials.available,
    message: verified
      ? `기존 학습 기록을 가져왔습니다. (항목 ${localStorageCopied}개, 자료 본문 ${materials.copied}개)`
      : '가져오기를 완료하지 못했습니다. 일부 자료를 복사하지 못했을 수 있습니다. 기존 기록은 그대로 보존되며 다시 시도할 수 있습니다.',
  };
}
