/**
 * REDCALL Academic Study Suite - Decoupled Material Content Storage
 * 
 * Separates heavy document content (full markdown, raw text, and page arrays)
 * from lightweight metadata stored in localStorage.
 * Uses IndexedDB in the browser with memory-cache fallback.
 */

import { MaterialPage } from './types';

export interface MaterialContent {
  materialId: string;
  markdown: string;
  rawText?: string;
  pages?: MaterialPage[];
  updatedAt: string;
}

const DB_NAME = 'redcall_materials_db';
const DB_VERSION = 1;
const STORE_NAME = 'material_contents';

// In-memory cache for fast synchronous access and environments without IndexedDB
const memoryCache = new Map<string, MaterialContent>();

function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
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

      request.onerror = (e) => {
        console.warn('IndexedDB open error, falling back to in-memory storage:', e);
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB unavailable:', err);
      resolve(null);
    }
  });
}

export async function saveMaterialContent(
  materialId: string,
  content: {
    markdown: string;
    rawText?: string;
    pages?: MaterialPage[];
  }
): Promise<void> {
  const item: MaterialContent = {
    materialId,
    markdown: content.markdown,
    rawText: content.rawText,
    pages: content.pages,
    updatedAt: new Date().toISOString(),
  };

  // Always update memory cache
  memoryCache.set(materialId, item);

  const db = await openDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);

      req.onsuccess = () => resolve();
      req.onerror = () => {
        console.error('Failed to put material content into IndexedDB:', req.error);
        resolve(); // Don't crash if IndexedDB fails, memory cache is intact
      };
    } catch (err) {
      console.warn('Error saving to IndexedDB:', err);
      resolve();
    }
  });
}

export async function loadMaterialContent(materialId: string): Promise<MaterialContent | null> {
  // Check memory cache first
  if (memoryCache.has(materialId)) {
    return memoryCache.get(materialId)!;
  }

  const db = await openDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(materialId);

      req.onsuccess = () => {
        const result = req.result as MaterialContent | undefined;
        if (result) {
          memoryCache.set(materialId, result);
          resolve(result);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        console.warn('Failed to load material content from IndexedDB:', req.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('Error reading from IndexedDB:', err);
      resolve(null);
    }
  });
}

export async function deleteMaterialContent(materialId: string): Promise<void> {
  memoryCache.delete(materialId);

  const db = await openDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(materialId);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Gets cached content synchronously if available in memory
 */
export function getCachedMaterialContent(materialId: string): MaterialContent | null {
  return memoryCache.get(materialId) || null;
}
