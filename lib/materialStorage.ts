/**
 * Learn my way Academic Study Suite - Decoupled Material Content Storage
 *
 * Separates heavy document content (full markdown, raw text, and page arrays)
 * from lightweight metadata stored in localStorage.
 * Uses IndexedDB in the browser with a memory-cache fallback.
 *
 * Reliability contract:
 *  - A save is only reported as persisted after the IndexedDB transaction
 *    actually completes. Memory-only saves are reported explicitly so the UI
 *    can warn that a refresh will lose them.
 *  - Reading distinguishes "found", "missing" (no such content), and "error"
 *    (storage failure) so a failure is never silently treated as absence.
 */

import { MaterialPage } from './types';
import { getStorageScopeId } from './storageScope';

export interface MaterialContent {
  materialId: string;
  markdown: string;
  rawText?: string;
  pages?: MaterialPage[];
  updatedAt: string;
}

export type MaterialSaveResult =
  | { persisted: true; storage: 'indexeddb'; updatedAt: string }
  | { persisted: false; storage: 'memory'; updatedAt: string; error: string };

export type MaterialLoadResult =
  | { status: 'found'; storage: 'indexeddb' | 'memory'; content: MaterialContent }
  | { status: 'missing' }
  | { status: 'error'; error: string };

export interface MaterialDeleteResult {
  deleted: boolean;
  storage: 'indexeddb' | 'memory' | 'none';
  error?: string;
}

const LEGACY_DB_NAME = 'redcall_materials_db';
const DB_VERSION = 1;
const STORE_NAME = 'material_contents';

// In-memory cache for fast synchronous access and environments without IndexedDB.
// Keys are namespaced by scope so two accounts never share a cached body.
const memoryCache = new Map<string, MaterialContent>();

function getDbName(): string {
  const scopeId = getStorageScopeId();
  return scopeId === 'shared' ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_${scopeId}`;
}

function cacheKey(materialId: string): string {
  return `${getStorageScopeId()}::${materialId}`;
}

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.indexedDB);
}

function openDBByName(dbName: string): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'materialId' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('IndexedDB open error, falling back to in-memory storage.');
        resolve(null);
      };
    } catch {
      console.warn('IndexedDB unavailable, falling back to in-memory storage.');
      resolve(null);
    }
  });
}

function openDB(): Promise<IDBDatabase | null> {
  return openDBByName(getDbName());
}

/**
 * Copies every stored material body from a source scope's IndexedDB into the
 * current scope's IndexedDB. Existing target bodies are never overwritten, so
 * re-running the import cannot duplicate or clobber records.
 */
export async function importMaterialContentsFromScope(
  sourceScopeId: string
): Promise<{ available: boolean; copied: number; skipped: number; error?: string }> {
  const sourceName = sourceScopeId === 'shared' ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_${sourceScopeId}`;
  const targetName = getDbName();

  if (sourceName === targetName) {
    return { available: true, copied: 0, skipped: 0 };
  }
  if (!isIndexedDBAvailable()) {
    return { available: false, copied: 0, skipped: 0 };
  }

  const source = await openDBByName(sourceName);
  if (!source) {
    return { available: false, copied: 0, skipped: 0 };
  }
  const target = await openDBByName(targetName);
  if (!target) {
    return { available: false, copied: 0, skipped: 0, error: '대상 IndexedDB를 열 수 없습니다.' };
  }

  const contents = await new Promise<MaterialContent[]>((resolve) => {
    try {
      const tx = source.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as MaterialContent[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  let copied = 0;
  let skipped = 0;
  for (const content of contents) {
    if (!content || typeof content.materialId !== 'string') continue;
    const exists = await new Promise<boolean>((resolve) => {
      try {
        const tx = target.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(content.materialId);
        req.onsuccess = () => resolve(Boolean(req.result));
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    const written = await new Promise<boolean>((resolve) => {
      try {
        const tx = target.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.objectStore(STORE_NAME).put(content);
      } catch {
        resolve(false);
      }
    });
    if (written) copied += 1;
  }

  try {
    source.close();
    target.close();
  } catch {
    // ignore close failures
  }

  return { available: true, copied, skipped };
}

/** Raw list of material ids in a scope, used to verify an import. */
export async function listMaterialIdsInScope(scopeId: string): Promise<string[] | null> {
  const dbName = scopeId === 'shared' ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_${scopeId}`;
  if (!isIndexedDBAvailable()) return null;
  const db = await openDBByName(dbName);
  if (!db) return null;
  return new Promise<string[] | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Saves content. The memory cache is always updated so the current session can
 * read it, but the returned result states whether IndexedDB actually persisted it.
 */
export async function saveMaterialContent(
  materialId: string,
  content: {
    markdown: string;
    rawText?: string;
    pages?: MaterialPage[];
  }
): Promise<MaterialSaveResult> {
  const item: MaterialContent = {
    materialId,
    markdown: content.markdown,
    rawText: content.rawText,
    pages: content.pages,
    updatedAt: new Date().toISOString(),
  };

  // Always update memory cache so the current session sees the latest content.
  memoryCache.set(cacheKey(materialId), item);

  const db = await openDB();
  if (!db) {
    return {
      persisted: false,
      storage: 'memory',
      updatedAt: item.updatedAt,
      error: '브라우저 IndexedDB를 사용할 수 없어 메모리에만 보관했습니다.',
    };
  }

  return new Promise<MaterialSaveResult>((resolve) => {
    let settled = false;
    const finish = (result: MaterialSaveResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      // Transaction completion — not just request success — is the durability signal.
      tx.oncomplete = () =>
        finish({ persisted: true, storage: 'indexeddb', updatedAt: item.updatedAt });
      tx.onerror = () =>
        finish({
          persisted: false,
          storage: 'memory',
          updatedAt: item.updatedAt,
          error: tx.error?.message || 'IndexedDB 트랜잭션에 실패했습니다.',
        });
      tx.onabort = () =>
        finish({
          persisted: false,
          storage: 'memory',
          updatedAt: item.updatedAt,
          error: 'IndexedDB 트랜잭션이 중단되었습니다.',
        });

      tx.objectStore(STORE_NAME).put(item);
    } catch (err) {
      finish({
        persisted: false,
        storage: 'memory',
        updatedAt: item.updatedAt,
        error: err instanceof Error ? err.message : 'IndexedDB 저장 중 오류가 발생했습니다.',
      });
    }
  });
}

/**
 * Loads content, distinguishing absence from storage failure.
 */
export async function loadMaterialContentResult(materialId: string): Promise<MaterialLoadResult> {
  // Memory cache first (always authoritative for the current session).
  const cached = memoryCache.get(cacheKey(materialId));
  if (cached) {
    return { status: 'found', storage: 'memory', content: cached };
  }

  if (!isIndexedDBAvailable()) {
    // Without IndexedDB, the memory cache is the only store; absence means missing.
    return { status: 'missing' };
  }

  const db = await openDB();
  if (!db) {
    return { status: 'error', error: 'IndexedDB를 열 수 없습니다.' };
  }

  return new Promise<MaterialLoadResult>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(materialId);

      req.onsuccess = () => {
        const result = req.result as MaterialContent | undefined;
        if (result) {
          memoryCache.set(cacheKey(materialId), result);
          resolve({ status: 'found', storage: 'indexeddb', content: result });
        } else {
          resolve({ status: 'missing' });
        }
      };

      req.onerror = () => {
        resolve({ status: 'error', error: req.error?.message || 'IndexedDB 읽기에 실패했습니다.' });
      };
    } catch (err) {
      resolve({
        status: 'error',
        error: err instanceof Error ? err.message : 'IndexedDB 읽기 중 오류가 발생했습니다.',
      });
    }
  });
}

/**
 * Backward-compatible loader. Prefer `loadMaterialContentResult` when the UI
 * must distinguish a missing document from a storage failure.
 */
export async function loadMaterialContent(materialId: string): Promise<MaterialContent | null> {
  const result = await loadMaterialContentResult(materialId);
  return result.status === 'found' ? result.content : null;
}

export async function deleteMaterialContent(materialId: string): Promise<MaterialDeleteResult> {
  const hadMemory = memoryCache.delete(cacheKey(materialId));

  if (!isIndexedDBAvailable()) {
    return { deleted: hadMemory, storage: hadMemory ? 'memory' : 'none' };
  }

  const db = await openDB();
  if (!db) {
    return { deleted: hadMemory, storage: hadMemory ? 'memory' : 'none', error: 'IndexedDB를 열 수 없습니다.' };
  }

  return new Promise<MaterialDeleteResult>((resolve) => {
    let settled = false;
    const finish = (result: MaterialDeleteResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => finish({ deleted: true, storage: 'indexeddb' });
      tx.onerror = () =>
        finish({ deleted: hadMemory, storage: hadMemory ? 'memory' : 'none', error: tx.error?.message });
      tx.objectStore(STORE_NAME).delete(materialId);
    } catch (err) {
      finish({
        deleted: hadMemory,
        storage: hadMemory ? 'memory' : 'none',
        error: err instanceof Error ? err.message : 'IndexedDB 삭제 중 오류가 발생했습니다.',
      });
    }
  });
}

/**
 * Clears every stored material body (IndexedDB store + memory cache).
 * Used by the full data reset so orphaned bodies do not survive a reset.
 */
export async function clearAllMaterialContent(): Promise<MaterialDeleteResult> {
  memoryCache.clear();

  if (!isIndexedDBAvailable()) {
    return { deleted: true, storage: 'memory' };
  }

  const db = await openDB();
  if (!db) {
    return { deleted: true, storage: 'memory', error: 'IndexedDB를 열 수 없어 메모리 캐시만 정리했습니다.' };
  }

  return new Promise<MaterialDeleteResult>((resolve) => {
    let settled = false;
    const finish = (result: MaterialDeleteResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => finish({ deleted: true, storage: 'indexeddb' });
      tx.onerror = () =>
        finish({ deleted: true, storage: 'memory', error: tx.error?.message || 'IndexedDB 초기화 실패' });
      tx.objectStore(STORE_NAME).clear();
    } catch (err) {
      finish({
        deleted: true,
        storage: 'memory',
        error: err instanceof Error ? err.message : 'IndexedDB 초기화 중 오류가 발생했습니다.',
      });
    }
  });
}

/**
 * Gets cached content synchronously if available in memory
 */
export function getCachedMaterialContent(materialId: string): MaterialContent | null {
  return memoryCache.get(cacheKey(materialId)) || null;
}
