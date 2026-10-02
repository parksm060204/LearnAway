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

const DB_NAME = 'redcall_materials_db';
const DB_VERSION = 1;
const STORE_NAME = 'material_contents';

// In-memory cache for fast synchronous access and environments without IndexedDB
const memoryCache = new Map<string, MaterialContent>();

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.indexedDB);
}

function openDB(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

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
  memoryCache.set(materialId, item);

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
  if (memoryCache.has(materialId)) {
    return { status: 'found', storage: 'memory', content: memoryCache.get(materialId)! };
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
          memoryCache.set(materialId, result);
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
  const hadMemory = memoryCache.delete(materialId);

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
  return memoryCache.get(materialId) || null;
}
