import crypto from 'crypto';
import type { ConceptDraft } from './types';

export interface AnalysisRecoveryRecord {
  id?: string; // Composite key: `${jobKey}_c${chunkIndex}`
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
  contentHash?: string;
  errorMessage?: string;
  isMemoryOnly?: boolean;
}

const RECOVERY_DB_BASE = 'redcall_analysis_recovery';
const RECOVERY_STORE = 'recoveries';
const RECOVERY_DB_VERSION = 2;

function validScopeId(scopeId: string): boolean {
  return scopeId === 'shared' || /^u_.+/.test(scopeId);
}

export function recoveryDbNameForScope(scopeId: string): string {
  return scopeId === 'shared' ? RECOVERY_DB_BASE : `${RECOVERY_DB_BASE}_${scopeId}`;
}

export function makeRecoveryRecordId(jobKey: string, chunkIndex: number): string {
  return `${jobKey}_c${chunkIndex}`;
}

export function computeRecoveryContentHash(record: {
  jobKey: string;
  chunkIndex: number;
  drafts: ConceptDraft[];
  signedRecoveryToken?: string;
}): string {
  const content = JSON.stringify({
    jobKey: record.jobKey,
    chunkIndex: record.chunkIndex,
    drafts: record.drafts.map((d) => ({
      id: d.id,
      title: (d.title || '').trim(),
      desc: (d.description || '').trim(),
      core: (d.coreDefinitionFormulaOrAlgorithm || '').trim(),
      evidence: d.sourceEvidence?.quote || '',
    })),
    token: record.signedRecoveryToken || '',
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
  }
  return null;
}

function openRecoveryDb(scopeId: string): Promise<{ db: IDBDatabase } | { error: string }> {
  if (!validScopeId(scopeId)) {
    return Promise.resolve({ error: '유효하지 않은 계정 스코프입니다.' });
  }

  const idb = getIndexedDB();
  if (!idb) {
    return Promise.resolve({ error: '브라우저에서 IndexedDB를 지원하지 않습니다.' });
  }

  return new Promise((resolve) => {
    try {
      const req = idb.open(recoveryDbNameForScope(scopeId), RECOVERY_DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;

        if (event.oldVersion < 2 && db.objectStoreNames.contains(RECOVERY_STORE)) {
          // If migrating from v1 where keyPath was 'materialId', drop and re-create with 'id'
          try {
            db.deleteObjectStore(RECOVERY_STORE);
          } catch {
            // ignore
          }
        }

        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
          store.createIndex('materialId', 'materialId', { unique: false });
          store.createIndex('jobKey', 'jobKey', { unique: false });
          store.createIndex('savedAt', 'savedAt', { unique: false });
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
 * Saves an analysis recovery record to IndexedDB with durable transaction completion
 * and immediate read-back hash verification.
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
  const chunkIndex = typeof record.chunkIndex === 'number' ? record.chunkIndex : 1;
  const recordId = record.id || makeRecoveryRecordId(record.jobKey, chunkIndex);
  const contentHash = computeRecoveryContentHash({
    jobKey: record.jobKey,
    chunkIndex,
    drafts: record.drafts,
    signedRecoveryToken: record.signedRecoveryToken,
  });

  const recordToSave: AnalysisRecoveryRecord = {
    ...record,
    id: recordId,
    chunkIndex,
    contentHash,
    savedAt: record.savedAt || new Date().toISOString(),
  };

  // 1. Write transaction: wait for oncomplete to ensure durability
  const writeSuccess: boolean = await new Promise((resolve) => {
    try {
      const tx = db.transaction(RECOVERY_STORE, 'readwrite');
      const store = tx.objectStore(RECOVERY_STORE);
      store.put(recordToSave);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });

  if (!writeSuccess) {
    return { ok: false, error: 'IndexedDB에 복구 데이터를 기록하지 못했습니다 (용량 초과 또는 권한 제한).' };
  }

  // 2. Read-back verification: verify that record was truly committed and hashes match
  const verifiedRecord: AnalysisRecoveryRecord | null = await new Promise((resolve) => {
    try {
      const tx = db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.get(recordId);
      req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (!verifiedRecord || verifiedRecord.jobKey !== record.jobKey || verifiedRecord.contentHash !== contentHash) {
    return { ok: false, error: '기록 후 무결성 검증 읽기에 실패했습니다. 메모리에만 유지됩니다.' };
  }

  return { ok: true };
}

/**
 * Loads a pending recovery record.
 * Supports loading by exact (jobKey, chunkIndex) or by materialId/jobKey for backward compatibility.
 */
export async function loadAnalysisRecovery(
  scopeId: string,
  keyOrMaterialId: string,
  chunkIndex?: number
): Promise<AnalysisRecoveryRecord | null> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return null;

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);

      if (typeof chunkIndex === 'number') {
        const id = makeRecoveryRecordId(keyOrMaterialId, chunkIndex);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord) || null);
        req.onerror = () => resolve(null);
      } else {
        // Query by id directly first
        const directReq = store.get(keyOrMaterialId);
        directReq.onsuccess = () => {
          if (directReq.result) {
            resolve(directReq.result as AnalysisRecoveryRecord);
            return;
          }
          // Query by materialId index if not found by direct id
          if (store.indexNames && typeof store.indexNames.contains === 'function' && store.indexNames.contains('materialId')) {
            const matIndex = store.index('materialId');
            const matReq = matIndex.getAll(keyOrMaterialId);
            matReq.onsuccess = () => {
              const list = (matReq.result as AnalysisRecoveryRecord[]) || [];
              if (list.length > 0) {
                // Return newest record
                list.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
                resolve(list[0]);
              } else {
                resolve(null);
              }
            };
            matReq.onerror = () => resolve(null);
          } else {
            resolve(null);
          }
        };
        directReq.onerror = () => resolve(null);
      }
    } catch {
      resolve(null);
    }
  });
}

/**
 * Loads all recovery records for a specific material under the given scope.
 */
export async function loadAnalysisRecoveriesForMaterial(
  scopeId: string,
  materialId: string
): Promise<AnalysisRecoveryRecord[]> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return [];

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      if (store.indexNames && typeof store.indexNames.contains === 'function' && store.indexNames.contains('materialId')) {
        const matIndex = store.index('materialId');
        const req = matIndex.getAll(materialId);
        req.onsuccess = () => resolve((req.result as AnalysisRecoveryRecord[]) || []);
        req.onerror = () => resolve([]);
      } else {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as AnalysisRecoveryRecord[]) || [];
          resolve(all.filter((r) => r.materialId === materialId));
        };
        req.onerror = () => resolve([]);
      }
    } catch {
      resolve([]);
    }
  });
}

/**
 * Conditionally deletes a recovery record once full save is verified.
 * Guarantees that older request completions do not delete newer or different records.
 */
export async function deleteAnalysisRecovery(
  scopeId: string,
  jobKeyOrMaterialId: string,
  chunkIndex?: number,
  expectedContentHash?: string
): Promise<boolean> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return false;

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readwrite');
      const store = tx.objectStore(RECOVERY_STORE);

      if (typeof chunkIndex === 'number') {
        const id = makeRecoveryRecordId(jobKeyOrMaterialId, chunkIndex);
        if (expectedContentHash) {
          const checkReq = store.get(id);
          checkReq.onsuccess = () => {
            const existing = checkReq.result as AnalysisRecoveryRecord | undefined;
            if (existing && existing.contentHash === expectedContentHash) {
              const delReq = store.delete(id);
              delReq.onsuccess = () => resolve(true);
              delReq.onerror = () => resolve(false);
            } else {
              // Hash mismatch or already deleted: don't overwrite newer record
              resolve(true);
            }
          };
          checkReq.onerror = () => resolve(false);
        } else {
          const delReq = store.delete(id);
          delReq.onsuccess = () => resolve(true);
          delReq.onerror = () => resolve(false);
        }
      } else {
        // Find records matching materialId or id
        const delReq = store.delete(jobKeyOrMaterialId);
        delReq.onsuccess = () => {
          if (store.indexNames && typeof store.indexNames.contains === 'function' && store.indexNames.contains('materialId')) {
            const matIndex = store.index('materialId');
            const req = matIndex.getAll(jobKeyOrMaterialId);
            req.onsuccess = () => {
              const list = (req.result as AnalysisRecoveryRecord[]) || [];
              for (const item of list) {
                if (item.id) store.delete(item.id);
              }
              resolve(true);
            };
            req.onerror = () => resolve(true);
          } else {
            resolve(true);
          }
        };
        delReq.onerror = () => resolve(false);
      }
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
    version: '2.0',
    exportedAt: new Date().toISOString(),
    jobKey: record.jobKey,
    chunkIndex: record.chunkIndex,
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
  a.download = `LearnAway_${safeTitle}_c${record.chunkIndex || 1}_AI_Concepts_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
