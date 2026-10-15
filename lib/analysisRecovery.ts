import type { ConceptDraft } from './types';

export interface AnalysisRecoveryRecord {
  materialId: string;
  jobKey: string;
  subjectId: string;
  domain: string;
  markdownHash: string;
  chunkIndex: number;
  workerId: string;
  leaseToken: string;
  drafts: ConceptDraft[];
  signedRecoveryToken?: string;
  checkpointStatus: 'pending' | 'committed' | 'already_completed';
  draftsPersistStatus: 'pending' | 'failed' | 'persisted';
  savedAt: string;
  errorMessage?: string;
}

const RECOVERY_DB_BASE = 'redcall_analysis_recovery';
const RECOVERY_STORE = 'recoveries';
const RECOVERY_DB_VERSION = 1;

function validScopeId(scopeId: string): boolean {
  return scopeId === 'shared' || /^u_.+/.test(scopeId);
}

export function recoveryDbNameForScope(scopeId: string): string {
  return scopeId === 'shared' ? RECOVERY_DB_BASE : `${RECOVERY_DB_BASE}_${scopeId}`;
}

function openRecoveryDb(scopeId: string): Promise<{ db: IDBDatabase } | { error: string }> {
  if (!validScopeId(scopeId)) {
    return Promise.resolve({ error: '유효하지 않은 계정 스코프입니다.' });
  }
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve({ error: '브라우저에서 IndexedDB를 지원하지 않습니다.' });
  }

  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(recoveryDbNameForScope(scopeId), RECOVERY_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          db.createObjectStore(RECOVERY_STORE, { keyPath: 'materialId' });
        }
      };
      req.onsuccess = () => resolve({ db: req.result });
      req.onerror = () => resolve({ error: '복구용 IndexedDB 저장소를 열지 못했습니다.' });
    } catch (err) {
      resolve({ error: err instanceof Error ? err.message : 'IndexedDB 열기 실패' });
    }
  });
}

/**
 * Saves an analysis recovery record to IndexedDB with immediate read-back verification.
 * If storage fails (quota, private mode), returns { ok: false, error: ... }.
 */
export async function saveAnalysisRecovery(
  scopeId: string,
  record: AnalysisRecoveryRecord
): Promise<{ ok: boolean; error?: string }> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    return { ok: false, error: dbRes.error };
  }

  const db = dbRes.db;

  // 1. Write transaction
  const writeSuccess: boolean = await new Promise((resolve) => {
    try {
      const tx = db.transaction(RECOVERY_STORE, 'readwrite');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });

  if (!writeSuccess) {
    return { ok: false, error: 'IndexedDB에 복구 데이터를 기록하지 못했습니다 (용량 초과 가능성).' };
  }

  // 2. Read-back verification: verify that record was truly committed and is readable
  const verifiedRecord: AnalysisRecoveryRecord | null = await new Promise((resolve) => {
    try {
      const tx = db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.get(record.materialId);
      req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (!verifiedRecord || verifiedRecord.jobKey !== record.jobKey) {
    return { ok: false, error: '기록 후 검증 읽기에 실패했습니다. 메모리에만 유지됩니다.' };
  }

  return { ok: true };
}

/**
 * Loads a pending recovery record for a specific material and scope.
 */
export async function loadAnalysisRecovery(
  scopeId: string,
  materialId: string
): Promise<AnalysisRecoveryRecord | null> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return null;

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.get(materialId);
      req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Deletes a recovery record once full save is verified.
 */
export async function deleteAnalysisRecovery(
  scopeId: string,
  materialId: string
): Promise<boolean> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return false;

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readwrite');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.delete(materialId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Lists all active recovery records for the current scope.
 */
export async function listAnalysisRecoveries(
  scopeId: string
): Promise<AnalysisRecoveryRecord[]> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return [];

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Fallback preservation: exports the unpersisted AI drafts as a downloadable JSON file.
 * Ensures the user NEVER loses paid AI results even if DB persistence is permanently unavailable.
 */
export function exportAnalysisRecoveryAsJson(record: AnalysisRecoveryRecord, materialTitle?: string): void {
  if (typeof window === 'undefined') return;

  const exportData = {
    app: 'LearnAway',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    materialId: record.materialId,
    materialTitle: materialTitle || 'unknown',
    domain: record.domain,
    draftCount: record.drafts.length,
    drafts: record.drafts,
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeTitle = (materialTitle || 'concepts').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
  a.download = `LearnAway_${safeTitle}_AI_Concepts_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
