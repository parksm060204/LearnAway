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
const UNMIGRATED_STORE = 'recoveries_unmigrated';
const RECOVERY_DB_VERSION = 5;

export interface UnmigratedRecoveryRecord {
  id: string;
  materialId?: string;
  unmigratedReason: string;
  unmigratedAt: string;
  rawRecord?: Record<string, unknown>;
  [key: string]: unknown;
}

export function isValidChunkIndex(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val > 0;
}

export type LoadAnalysisRecoveryResult =
  | { status: 'success'; data: AnalysisRecoveryRecord }
  | { status: 'not_found'; data?: null }
  | { status: 'blocked'; error: string }
  | { status: 'error'; error: string };

export type ListAnalysisRecoveryResult<T = AnalysisRecoveryRecord> =
  | { status: 'success'; data: T[] }
  | { status: 'blocked'; error: string }
  | { status: 'error'; error: string };

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

async function openRecoveryDb(
  scopeId: string
): Promise<{ db: IDBDatabase } | { error: string; blocked?: boolean }> {
  if (!validScopeId(scopeId)) {
    return Promise.resolve({ error: '유효하지 않은 계정 스코프입니다.' });
  }

  const idb = getIndexedDB();
  if (!idb) {
    return Promise.resolve({ error: '브라우저에서 IndexedDB를 지원하지 않습니다.' });
  }

  const dbName = recoveryDbNameForScope(scopeId);

  return new Promise((resolve) => {
    try {
      let wasBlocked = false;
      const req = idb.open(dbName, RECOVERY_DB_VERSION);

      req.onblocked = () => {
        wasBlocked = true;
        resolve({
          error: '다른 탭에서 데이터베이스를 사용 중이어서 버전 업그레이드가 일시 차단되었습니다. 다른 탭을 닫고 다시 시도해 주세요.',
          blocked: true,
        });
      };

      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;

        if (!tx) return;

        try {
          // Ensure UNMIGRATED_STORE exists in all versions
          let unmigratedStore: IDBObjectStore;
          if (!db.objectStoreNames.contains(UNMIGRATED_STORE)) {
            unmigratedStore = db.createObjectStore(UNMIGRATED_STORE, { keyPath: 'id' });
            unmigratedStore.createIndex('materialId', 'materialId', { unique: false });
            unmigratedStore.createIndex('savedAt', 'savedAt', { unique: false });
          } else {
            unmigratedStore = tx.objectStore(UNMIGRATED_STORE);
          }

          // Scenario A: Fresh database creation (oldVersion === 0)
          if (event.oldVersion === 0) {
            if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
              const store = db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
              store.createIndex('materialId', 'materialId', { unique: false });
              store.createIndex('jobKey', 'jobKey', { unique: false });
              store.createIndex('savedAt', 'savedAt', { unique: false });
            }
            return;
          }

          // Scenario B: Upgrading from legacy v1 (oldVersion < 2) where keyPath was 'materialId'
          // We read and migrate all records in the SAME versionchange transaction.
          // We NEVER delete the old store until records have been read successfully!
          if (event.oldVersion < 2 && db.objectStoreNames.contains(RECOVERY_STORE)) {
            const oldStore = tx.objectStore(RECOVERY_STORE);
            const readReq = oldStore.getAll();

            readReq.onerror = () => {
              // Read failed: DO NOT delete store. Abort transaction to preserve all existing data!
              try {
                tx.abort();
              } catch {}
            };

            readReq.onsuccess = () => {
              try {
                const legacyRecords = (readReq.result as Record<string, unknown>[]) || [];

                // Now that records are safely read in memory, delete old store
                db.deleteObjectStore(RECOVERY_STORE);

                // Create new store with keyPath: 'id'
                const newStore = db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
                newStore.createIndex('materialId', 'materialId', { unique: false });
                newStore.createIndex('jobKey', 'jobKey', { unique: false });
                newStore.createIndex('savedAt', 'savedAt', { unique: false });

                const usedKeys = new Set<string>();

                for (const rec of legacyRecords) {
                  const jobKey = typeof rec.jobKey === 'string' ? rec.jobKey.trim() : '';
                  const materialId = typeof rec.materialId === 'string' ? rec.materialId.trim() : '';
                  const isValidChunk = isValidChunkIndex(rec.chunkIndex);
                  const drafts = Array.isArray(rec.drafts) ? (rec.drafts as ConceptDraft[]) : [];

                  const isComplete = Boolean(jobKey && materialId && drafts.length > 0 && isValidChunk);
                  if (!isComplete) {
                    let unmigratedReason = '필수 복구 필드가 불완전하여 자동 이관되지 않고 원본이 보존되었습니다.';
                    if (!isValidChunk) {
                      unmigratedReason = `청크 번호(chunkIndex: ${JSON.stringify(rec.chunkIndex)})가 유효한 양의 정수가 아니어서 자동 이관에서 제외되었습니다.`;
                    } else if (!jobKey || !materialId) {
                      unmigratedReason = '필수 식별자(jobKey 또는 materialId)가 누락되어 자동 이관에서 제외되었습니다.';
                    } else if (!drafts.length) {
                      unmigratedReason = '초안 데이터(drafts)가 비어 있어 자동 이관에서 제외되었습니다.';
                    }

                    const unmigratedId =
                      (typeof rec.id === 'string' && rec.id) ||
                      (materialId ? `unmigrated_${materialId}_${Date.now()}` : `unmigrated_${Math.random().toString(36).slice(2)}`);
                    unmigratedStore.put({
                      ...rec,
                      id: unmigratedId,
                      materialId: materialId || undefined,
                      unmigratedReason,
                      unmigratedAt: new Date().toISOString(),
                      rawRecord: rec,
                    });
                    continue;
                  }

                  const chunkIndex = rec.chunkIndex as number;
                  let targetId = typeof rec.id === 'string' && rec.id ? rec.id : makeRecoveryRecordId(jobKey, chunkIndex);

                  // Prevent overwriting different recovery results if duplicate key occurs
                  if (usedKeys.has(targetId)) {
                    const collisionSuffix = `_alt_${Date.parse(String(rec.savedAt || '')) || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    targetId = `${targetId}${collisionSuffix}`;
                  }
                  usedKeys.add(targetId);

                  const contentHash =
                    typeof rec.contentHash === 'string' && rec.contentHash
                      ? rec.contentHash
                      : computeRecoveryContentHash({
                          jobKey,
                          chunkIndex,
                          drafts,
                          signedRecoveryToken: typeof rec.signedRecoveryToken === 'string' ? rec.signedRecoveryToken : undefined,
                        });

                  const migratedRecord: AnalysisRecoveryRecord = {
                    id: targetId,
                    materialId,
                    jobKey,
                    subjectId: typeof rec.subjectId === 'string' ? rec.subjectId : '',
                    domain: typeof rec.domain === 'string' ? rec.domain : 'math_stats',
                    markdownHash: typeof rec.markdownHash === 'string' ? rec.markdownHash : '',
                    chunkIndex,
                    workerId: typeof rec.workerId === 'string' ? rec.workerId : '',
                    leaseToken: typeof rec.leaseToken === 'string' ? rec.leaseToken : '',
                    drafts,
                    signedRecoveryToken: typeof rec.signedRecoveryToken === 'string' ? rec.signedRecoveryToken : undefined,
                    checkpointStatus:
                      rec.checkpointStatus === 'committed' || rec.checkpointStatus === 'already_completed'
                        ? rec.checkpointStatus
                        : 'pending',
                    draftsPersistStatus:
                      rec.draftsPersistStatus === 'persisted' || rec.draftsPersistStatus === 'failed'
                        ? rec.draftsPersistStatus
                        : 'failed',
                    savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : new Date().toISOString(),
                    contentHash,
                    errorMessage: typeof rec.errorMessage === 'string' ? rec.errorMessage : undefined,
                  };

                  newStore.put(migratedRecord);
                }
              } catch {
                try {
                  tx.abort();
                } catch {}
              }
            };
            return;
          }

          // Scenario C: Upgrading from v2, v3, or v4 to v5
          // Ensure all indices exist and quarantine incomplete/invalid chunkIndex records
          if (db.objectStoreNames.contains(RECOVERY_STORE)) {
            const store = tx.objectStore(RECOVERY_STORE);
            if (!store.indexNames.contains('materialId')) {
              store.createIndex('materialId', 'materialId', { unique: false });
            }
            if (!store.indexNames.contains('jobKey')) {
              store.createIndex('jobKey', 'jobKey', { unique: false });
            }
            if (!store.indexNames.contains('savedAt')) {
              store.createIndex('savedAt', 'savedAt', { unique: false });
            }

            // Quarantine any existing invalid records
            const readReq = store.getAll();
            readReq.onerror = () => {
              try {
                tx.abort();
              } catch {}
            };
            readReq.onsuccess = () => {
              try {
                const records = (readReq.result as Record<string, unknown>[]) || [];
                for (const rec of records) {
                  const isValidChunk = isValidChunkIndex(rec.chunkIndex);
                  const hasJobKey = typeof rec.jobKey === 'string' && rec.jobKey.trim().length > 0;
                  const hasMaterialId = typeof rec.materialId === 'string' && rec.materialId.trim().length > 0;
                  const hasDrafts = Array.isArray(rec.drafts) && rec.drafts.length > 0;

                  if (!isValidChunk || !hasJobKey || !hasMaterialId || !hasDrafts) {
                    let unmigratedReason = '레코드 무결성 검증 실패(필수 필드 결함)로 격리되었습니다.';
                    if (!isValidChunk) {
                      unmigratedReason = `청크 번호(chunkIndex: ${JSON.stringify(rec.chunkIndex)})가 유효한 양의 정수가 아니어서 자동 복구에서 제외되고 원본이 보존되었습니다.`;
                    } else if (!hasJobKey || !hasMaterialId) {
                      unmigratedReason = '필수 식별자(jobKey 또는 materialId) 결함으로 격리되었습니다.';
                    } else if (!hasDrafts) {
                      unmigratedReason = '초안 데이터(drafts) 부재로 격리되었습니다.';
                    }

                    const recId =
                      (typeof rec.id === 'string' && rec.id) ||
                      `quarantine_${Date.now()}_${Math.random().toString(36).slice(2)}`;

                    unmigratedStore.put({
                      ...rec,
                      id: recId,
                      materialId: (typeof rec.materialId === 'string' && rec.materialId) || undefined,
                      unmigratedReason,
                      unmigratedAt: new Date().toISOString(),
                      rawRecord: rec,
                    });

                    if (typeof rec.id === 'string' && rec.id) {
                      store.delete(rec.id);
                    }
                  }
                }
              } catch {
                try {
                  tx.abort();
                } catch {}
              }
            };
          } else {
            const store = db.createObjectStore(RECOVERY_STORE, { keyPath: 'id' });
            store.createIndex('materialId', 'materialId', { unique: false });
            store.createIndex('jobKey', 'jobKey', { unique: false });
            store.createIndex('savedAt', 'savedAt', { unique: false });
          }
        } catch {
          try {
            tx.abort();
          } catch {}
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        if (wasBlocked) {
          // If connection was opened after an earlier onblocked event,
          // close it immediately to prevent connection leaks or unneeded locks.
          try {
            db.close();
          } catch {}
          return;
        }
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
        };
        resolve({ db });
      };

      req.onerror = () => {
        resolve({ error: req.error?.message || 'IndexedDB 열기에 실패했습니다.' });
      };
    } catch (err: unknown) {
      resolve({ error: err instanceof Error ? err.message : 'IndexedDB 열기 예외가 발생했습니다.' });
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
  if (!isValidChunkIndex(record.chunkIndex)) {
    return { ok: false, error: '유효한 청크 번호(양의 정수)가 필요합니다.' };
  }
  if (!record.jobKey || typeof record.jobKey !== 'string' || !record.jobKey.trim()) {
    return { ok: false, error: '유효한 jobKey가 필요합니다.' };
  }
  if (!record.materialId || typeof record.materialId !== 'string' || !record.materialId.trim()) {
    return { ok: false, error: '유효한 materialId가 필요합니다.' };
  }
  if (!Array.isArray(record.drafts) || record.drafts.length === 0) {
    return { ok: false, error: '복구할 초안(drafts)이 비어 있습니다.' };
  }

  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    return { ok: false, error: dbRes.error };
  }

  const db = dbRes.db;
  const chunkIndex = record.chunkIndex;
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
): Promise<LoadAnalysisRecoveryResult> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    if (dbRes.blocked) {
      return { status: 'blocked', error: dbRes.error };
    }
    return { status: 'error', error: dbRes.error };
  }

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);

      if (typeof chunkIndex === 'number') {
        const id = makeRecoveryRecordId(keyOrMaterialId, chunkIndex);
        const req = store.get(id);
        req.onsuccess = () => {
          const rec = req.result as AnalysisRecoveryRecord | undefined;
          if (rec) {
            resolve({ status: 'success', data: rec });
          } else {
            resolve({ status: 'not_found' });
          }
        };
        req.onerror = () => resolve({ status: 'error', error: req.error?.message || 'IndexedDB 읽기 실패' });
      } else {
        // Query by id directly first
        const directReq = store.get(keyOrMaterialId);
        directReq.onsuccess = () => {
          if (directReq.result) {
            resolve({ status: 'success', data: directReq.result as AnalysisRecoveryRecord });
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
                resolve({ status: 'success', data: list[0] });
              } else {
                resolve({ status: 'not_found' });
              }
            };
            matReq.onerror = () => resolve({ status: 'error', error: matReq.error?.message || 'IndexedDB 인덱스 읽기 실패' });
          } else {
            resolve({ status: 'not_found' });
          }
        };
        directReq.onerror = () => resolve({ status: 'error', error: directReq.error?.message || 'IndexedDB 읽기 실패' });
      }
    } catch (err) {
      resolve({ status: 'error', error: err instanceof Error ? err.message : 'IndexedDB 조회 예외' });
    }
  });
}

/**
 * Loads all recovery records for a specific material under the given scope.
 */
export async function loadAnalysisRecoveriesForMaterial(
  scopeId: string,
  materialId: string
): Promise<ListAnalysisRecoveryResult<AnalysisRecoveryRecord>> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    if (dbRes.blocked) {
      return { status: 'blocked', error: dbRes.error };
    }
    return { status: 'error', error: dbRes.error };
  }

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      if (store.indexNames && typeof store.indexNames.contains === 'function' && store.indexNames.contains('materialId')) {
        const matIndex = store.index('materialId');
        const req = matIndex.getAll(materialId);
        req.onsuccess = () => resolve({ status: 'success', data: (req.result as AnalysisRecoveryRecord[]) || [] });
        req.onerror = () => resolve({ status: 'error', error: req.error?.message || '자료별 복구 목록 읽기 실패' });
      } else {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as AnalysisRecoveryRecord[]) || [];
          resolve({ status: 'success', data: all.filter((r) => r.materialId === materialId) });
        };
        req.onerror = () => resolve({ status: 'error', error: req.error?.message || '복구 목록 읽기 실패' });
      }
    } catch (err) {
      resolve({ status: 'error', error: err instanceof Error ? err.message : '조회 예외' });
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
  chunkIndexOrJobKey?: number | string,
  expectedContentHash?: string
): Promise<boolean> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) return false;

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readwrite');
      const store = tx.objectStore(RECOVERY_STORE);

      if (typeof chunkIndexOrJobKey === 'number') {
        const id = makeRecoveryRecordId(jobKeyOrMaterialId, chunkIndexOrJobKey);
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
      } else if (typeof chunkIndexOrJobKey === 'string' && chunkIndexOrJobKey) {
        // Called as deleteAnalysisRecovery(scopeId, materialId, jobKey):
        // Delete only the records matching BOTH this specific jobKey and materialId,
        // rather than all records for this material.
        const targetJobKey = chunkIndexOrJobKey;
        const targetMaterialId = jobKeyOrMaterialId;

        const req = store.getAll();
        req.onsuccess = () => {
          const list = (req.result as AnalysisRecoveryRecord[]) || [];
          for (const item of list) {
            if (item.id && item.jobKey === targetJobKey && (!targetMaterialId || item.materialId === targetMaterialId)) {
              store.delete(item.id);
            }
          }
          resolve(true);
        };
        req.onerror = () => resolve(false);
      } else {
        // Find records matching materialId or id directly
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
): Promise<ListAnalysisRecoveryResult<AnalysisRecoveryRecord>> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    if (dbRes.blocked) {
      return { status: 'blocked', error: dbRes.error };
    }
    return { status: 'error', error: dbRes.error };
  }

  return new Promise((resolve) => {
    try {
      const tx = dbRes.db.transaction(RECOVERY_STORE, 'readonly');
      const store = tx.objectStore(RECOVERY_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve({ status: 'success', data: (req.result as AnalysisRecoveryRecord[]) || [] });
      req.onerror = () => resolve({ status: 'error', error: req.error?.message || '목록 읽기 실패' });
    } catch (err) {
      resolve({ status: 'error', error: err instanceof Error ? err.message : '목록 조회 예외' });
    }
  });
}

/**
 * Lists unmigrated legacy recovery records for user inspection or manual recovery.
 */
export async function listUnmigratedAnalysisRecoveries(
  scopeId: string
): Promise<ListAnalysisRecoveryResult<UnmigratedRecoveryRecord>> {
  const dbRes = await openRecoveryDb(scopeId);
  if ('error' in dbRes) {
    if (dbRes.blocked) {
      return { status: 'blocked', error: dbRes.error };
    }
    return { status: 'error', error: dbRes.error };
  }

  return new Promise((resolve) => {
    try {
      if (!dbRes.db.objectStoreNames.contains(UNMIGRATED_STORE)) {
        resolve({ status: 'success', data: [] });
        return;
      }
      const tx = dbRes.db.transaction(UNMIGRATED_STORE, 'readonly');
      const store = tx.objectStore(UNMIGRATED_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve({ status: 'success', data: (req.result as UnmigratedRecoveryRecord[]) || [] });
      req.onerror = () => resolve({ status: 'error', error: req.error?.message || '미이관 목록 읽기 실패' });
    } catch (err) {
      resolve({ status: 'error', error: err instanceof Error ? err.message : '미이관 목록 조회 예외' });
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

/**
 * Fallback preservation: exports unmigrated legacy recovery records as a downloadable JSON file.
 * Enables the user to inspect and retain preserved legacy records without losing data.
 */
export function exportUnmigratedRecoveriesAsJson(
  records: UnmigratedRecoveryRecord[],
  scopeId: string
): void {
  if (typeof window === 'undefined' || !records.length) return;

  const exportData = {
    app: 'LearnAway',
    version: '2.0',
    notice: 'LearnAway 이전 버전 미이관/격리 복구 데이터 목록입니다. (과거에 이미 삭제되었던 데이터는 복구할 수 없습니다)',
    exportedAt: new Date().toISOString(),
    scopeId,
    recordCount: records.length,
    records: records.map((r) => ({
      id: r.id,
      materialId: r.materialId,
      unmigratedReason: r.unmigratedReason,
      unmigratedAt: r.unmigratedAt,
      rawRecord: r.rawRecord || r,
    })),
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeScope = scopeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `LearnAway_unmigrated_recoveries_${safeScope}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

