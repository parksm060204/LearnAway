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
const DB_VERSION = 2;
const STORE_NAME = 'material_contents';
const ORIGINAL_STORE_NAME = 'material_originals';

// In-memory cache for fast synchronous access and environments without IndexedDB.
// Keys are namespaced by scope so two accounts never share a cached body.
const memoryCache = new Map<string, MaterialContent>();

/**
 * Ids (scope::material) whose body is confirmed DURABLY persisted in that
 * scope's IndexedDB (transaction complete, or read back from IndexedDB).
 * A memory-cache presence is NOT persistence and never marks this set, so
 * callers can safely strip duplicated local copies only for confirmed ids.
 */
const persistedBodyIds = new Set<string>();

function markBodyPersisted(scopeId: string, materialId: string): void {
  persistedBodyIds.add(`${scopeId}::${materialId}`);
}

function unmarkBodyPersisted(scopeId: string, materialId: string): void {
  persistedBodyIds.delete(`${scopeId}::${materialId}`);
}

/** True when the CURRENT scope has a durably persisted body for this material. */
export function isMaterialBodyPersisted(materialId: string): boolean {
  return persistedBodyIds.has(`${getStorageScopeId()}::${materialId}`);
}

/**
 * Withdraws a durability mark, e.g. when a post-write read-back verification
 * fails. Callers must then keep any local duplicate until the move is retried.
 */
export function unmarkMaterialBodyPersistedInScope(scopeId: string, materialId: string): void {
  unmarkBodyPersisted(scopeId, materialId);
}

/** @internal Clears persistence marks for the CURRENT scope (full reset). */
function clearBodyPersistenceMarksForCurrentScope(): void {
  const prefix = `${getStorageScopeId()}::`;
  for (const key of Array.from(persistedBodyIds)) {
    if (key.startsWith(prefix)) persistedBodyIds.delete(key);
  }
}

function scopeIdToDbName(scopeId: string): string {
  return scopeId === 'shared' ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_${scopeId}`;
}

function getDbName(): string {
  return scopeIdToDbName(getStorageScopeId());
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
        if (!db.objectStoreNames.contains(ORIGINAL_STORE_NAME)) {
          db.createObjectStore(ORIGINAL_STORE_NAME, { keyPath: 'materialId' });
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

export interface MaterialImportResult {
  available: boolean;
  copied: number;
  skipped: number;
  failed: number;
  verified: boolean;
  error?: string;
  /** Distinct failure reasons, so callers can explain recovery accurately. */
  readFailed: number;
  writeFailed: number;
  aborted: number;
  conflicts: number;
  verifyFailed: number;
  conflictIds: string[];
}

interface MaterialImportCounts {
  copied: number;
  skipped: number;
  failed: number;
  readFailed: number;
  writeFailed: number;
  aborted: number;
  conflicts: number;
  verifyFailed: number;
  conflictIds: string[];
}

function emptyCounts(): MaterialImportCounts {
  return {
    copied: 0,
    skipped: 0,
    failed: 0,
    readFailed: 0,
    writeFailed: 0,
    aborted: 0,
    conflicts: 0,
    verifyFailed: 0,
    conflictIds: [],
  };
}

function readAllContents(db: IDBDatabase): Promise<MaterialContent[] | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as MaterialContent[]) || []);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Deterministic serialization with sorted object keys, used to compare material
 * content identity independently of property order or `updatedAt`.
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * Content identity fingerprint. Comparison rules:
 *  - `markdown` is required; a missing value is treated as an empty string.
 *  - `rawText`: `undefined`, `null` and `''` are equivalent (absent text).
 *  - `pages`: `undefined`, `null` and a non-array are equivalent (absent pages).
 *  - `updatedAt` (and any other field) is storage metadata, NOT identity.
 */
export function materialContentFingerprint(content: {
  markdown?: string;
  rawText?: string;
  pages?: MaterialPage[];
}): string {
  return stableStringify({
    markdown: typeof content.markdown === 'string' ? content.markdown : '',
    rawText: typeof content.rawText === 'string' ? content.rawText : '',
    pages: Array.isArray(content.pages) ? content.pages : null,
  });
}

type ContentRead =
  | { status: 'found'; content: MaterialContent }
  | { status: 'missing' }
  | { status: 'error' };

type ContentWrite = { status: 'ok' } | { status: 'error' } | { status: 'abort' };

function readContent(db: IDBDatabase, materialId: string): Promise<ContentRead> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(materialId);
      req.onsuccess = () => {
        const result = req.result as MaterialContent | undefined;
        resolve(result ? { status: 'found', content: result } : { status: 'missing' });
      };
      req.onerror = () => resolve({ status: 'error' });
    } catch {
      resolve({ status: 'error' });
    }
  });
}

function writeContent(db: IDBDatabase, content: MaterialContent): Promise<ContentWrite> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ContentWrite) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => finish({ status: 'ok' });
      tx.onerror = () => finish({ status: 'error' });
      tx.onabort = () => finish({ status: 'abort' });
      tx.objectStore(STORE_NAME).put(content);
    } catch {
      finish({ status: 'error' });
    }
  });
}

function describeImportFailure(counts: MaterialImportCounts): string {
  const parts: string[] = [];
  if (counts.readFailed > 0) parts.push(`읽기 실패 ${counts.readFailed}`);
  if (counts.writeFailed > 0) parts.push(`쓰기 실패 ${counts.writeFailed}`);
  if (counts.aborted > 0) parts.push(`트랜잭션 중단 ${counts.aborted}`);
  if (counts.conflicts > 0) parts.push(`내용 충돌 ${counts.conflicts}`);
  if (counts.verifyFailed > 0) parts.push(`재검증 실패 ${counts.verifyFailed}`);
  return `자료 본문 이전 미완료 (${parts.join(', ')})`;
}

/**
 * Copies stored material bodies from a source scope's IndexedDB into a target
 * scope's IndexedDB. The target scope can be pinned explicitly so a mid-run
 * account change cannot redirect writes to a different account.
 *
 * Content identity (markdown/rawText/pages, ignoring updatedAt) is compared:
 *  - same id, same content  -> skipped (safe, idempotent)
 *  - same id, different content -> conflict (never overwritten)
 *  - absent -> copied, then read back and re-verified after the transaction
 * Any read/write/abort/conflict/verify failure makes the result unverified, so
 * callers must not write the overall import completion marker.
 */
export async function importMaterialContentsFromScope(
  sourceScopeId: string,
  targetScopeId?: string
): Promise<MaterialImportResult> {
  const resolvedTargetScopeId = targetScopeId ?? getStorageScopeId();
  const sourceName = scopeIdToDbName(sourceScopeId);
  const targetName = scopeIdToDbName(resolvedTargetScopeId);

  if (sourceName === targetName) {
    return { available: true, verified: true, ...emptyCounts() };
  }
  if (!isIndexedDBAvailable()) {
    // Without IndexedDB there are no durable material bodies to move.
    return { available: false, verified: true, ...emptyCounts() };
  }

  const source = await openDBByName(sourceName);
  if (!source) {
    return {
      available: false,
      verified: false,
      ...emptyCounts(),
      readFailed: 1,
      error: '원본 자료 저장소를 열 수 없습니다.',
    };
  }
  const target = await openDBByName(targetName);
  if (!target) {
    try {
      source.close();
    } catch {
      // ignore close failures
    }
    return {
      available: false,
      verified: false,
      ...emptyCounts(),
      writeFailed: 1,
      error: '대상 자료 저장소를 열 수 없습니다.',
    };
  }

  const contents = await readAllContents(source);
  if (!contents) {
    try {
      source.close();
      target.close();
    } catch {
      // ignore close failures
    }
    return {
      available: true,
      verified: false,
      ...emptyCounts(),
      readFailed: 1,
      error: '원본 자료를 읽지 못했습니다.',
    };
  }

  const counts = emptyCounts();

  for (const content of contents) {
    if (!content || typeof content.materialId !== 'string') continue;
    const sourceFingerprint = materialContentFingerprint(content);

    const existing = await readContent(target, content.materialId);
    if (existing.status === 'error') {
      counts.readFailed += 1;
      continue;
    }
    if (existing.status === 'found') {
      if (materialContentFingerprint(existing.content) === sourceFingerprint) {
        counts.skipped += 1;
      } else {
        counts.conflicts += 1;
        counts.conflictIds.push(content.materialId);
      }
      continue;
    }

    const write = await writeContent(target, content);
    if (write.status === 'abort') {
      counts.aborted += 1;
      continue;
    }
    if (write.status === 'error') {
      counts.writeFailed += 1;
      continue;
    }

    // Re-read the target after the transaction completes and verify content.
    const verify = await readContent(target, content.materialId);
    if (verify.status === 'found' && materialContentFingerprint(verify.content) === sourceFingerprint) {
      counts.copied += 1;
    } else {
      counts.verifyFailed += 1;
    }
  }

  try {
    source.close();
    target.close();
  } catch {
    // ignore close failures
  }

  const failed =
    counts.readFailed +
    counts.writeFailed +
    counts.aborted +
    counts.conflicts +
    counts.verifyFailed;

  return {
    available: true,
    copied: counts.copied,
    skipped: counts.skipped,
    failed,
    verified: failed === 0,
    ...(failed === 0 ? {} : { error: describeImportFailure(counts) }),
    readFailed: counts.readFailed,
    writeFailed: counts.writeFailed,
    aborted: counts.aborted,
    conflicts: counts.conflicts,
    verifyFailed: counts.verifyFailed,
    conflictIds: counts.conflictIds,
  };
}

/**
 * A material import is complete only when every body was copied/re-verified and
 * no read/write/abort/conflict/verify failure occurred. Callers must gate their
 * "import completed" marker on this.
 */
export function isMaterialImportVerified(result: MaterialImportResult): boolean {
  return result.verified && result.failed === 0 && !result.error;
}

/** Ids of material bodies stored locally in the current scope (presence only). */
export async function listMaterialContentIds(): Promise<string[] | null> {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDB();
  if (!db) return null;
  return new Promise<string[] | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
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
  return saveMaterialContentInScope(getStorageScopeId(), materialId, content);
}

/**
 * Scope-pinned save: the target database is resolved from the EXPLICIT scope
 * id, so a global account change mid-flight can never redirect the write into
 * another account's store.
 */
export async function saveMaterialContentInScope(
  scopeId: string,
  materialId: string,
  content: {
    markdown: string;
    rawText?: string;
    pages?: MaterialPage[];
  }
): Promise<MaterialSaveResult> {
  const key = `${scopeId}::${materialId}`;
  const item: MaterialContent = {
    materialId,
    markdown: content.markdown,
    rawText: content.rawText,
    pages: content.pages,
    updatedAt: new Date().toISOString(),
  };

  // Always update memory cache so the current session sees the latest content.
  memoryCache.set(key, item);

  const db = await openDBByName(scopeIdToDbName(scopeId));
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
      tx.oncomplete = () => {
        markBodyPersisted(scopeId, materialId);
        finish({ persisted: true, storage: 'indexeddb', updatedAt: item.updatedAt });
      };
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
  return loadMaterialContentInScope(getStorageScopeId(), materialId);
}

export interface MaterialLoadOptions {
  /**
   * Skip the memory cache and read IndexedDB directly. Verification paths MUST
   * use this: a memory-cache hit is not proof that the value was persisted.
   */
  skipMemoryCache?: boolean;
}

/**
 * Scope-pinned load. Reads (and durability-marks) the EXPLICIT scope's store.
 */
export async function loadMaterialContentInScope(
  scopeId: string,
  materialId: string,
  options: MaterialLoadOptions = {}
): Promise<MaterialLoadResult> {
  const key = `${scopeId}::${materialId}`;

  if (!options.skipMemoryCache) {
    const cached = memoryCache.get(key);
    if (cached) {
      return { status: 'found', storage: 'memory', content: cached };
    }
  }

  if (!isIndexedDBAvailable()) {
    // Without IndexedDB, the memory cache is the only store; absence means missing.
    return { status: 'missing' };
  }

  const db = await openDBByName(scopeIdToDbName(scopeId));
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
          memoryCache.set(key, result);
          markBodyPersisted(scopeId, materialId);
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

/**
 * Reads a body from an explicitly named scope (e.g. the migration-originals
 * backup) without switching the active scope. Used so cloud caching cannot
 * overwrite the local originals kept for migration.
 */
export async function loadMaterialContentFromScope(
  scopeId: string,
  materialId: string,
  options: MaterialLoadOptions = {}
): Promise<MaterialLoadResult> {
  return loadMaterialContentInScope(scopeId, materialId, options);
}

export async function deleteMaterialContent(materialId: string): Promise<MaterialDeleteResult> {
  const hadMemory = memoryCache.delete(cacheKey(materialId));
  unmarkBodyPersisted(getStorageScopeId(), materialId);

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
  clearBodyPersistenceMarksForCurrentScope();

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

// ---------------------------------------------------------------------------
// Local originals (PDF / source files) — local-first, IndexedDB only.
// Stored as ArrayBuffer (portable + structured-cloneable) and re-verified on
// read-back. A failed persist is NEVER reported as success.
// ---------------------------------------------------------------------------

export interface MaterialOriginalRecord {
  materialId: string;
  data: ArrayBuffer;
  contentType: string;
  size: number;
  hash: string;
  updatedAt: string;
}

export type OriginalSaveResult =
  | { persisted: true; storage: 'indexeddb'; hash: string; size: number; updatedAt: string }
  | { persisted: false; storage: 'none'; hash: string; size: number; updatedAt: string; error: string };

export type OriginalLoadResult =
  | { status: 'found'; storage: 'indexeddb'; blob: Blob; contentType: string; hash: string; size: number; updatedAt: string }
  | { status: 'missing' }
  | { status: 'error'; error: string };

/** SHA-256 of a Blob (hex, prefixed) with a byte-level FNV fallback. */
export async function hashBlob(blob: Blob): Promise<string> {
  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    return `oh_unreadable_l${blob.size}`;
  }
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return 'oh_' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through to FNV
    }
  }
  const bytes = new Uint8Array(buffer);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return `oh_${(h >>> 0).toString(16).padStart(8, '0')}_l${bytes.length}`;
}

type OriginalRead =
  | { status: 'found'; record: MaterialOriginalRecord }
  | { status: 'missing' }
  | { status: 'error' };

function readOriginal(db: IDBDatabase, materialId: string): Promise<OriginalRead> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ORIGINAL_STORE_NAME, 'readonly');
      const req = tx.objectStore(ORIGINAL_STORE_NAME).get(materialId);
      req.onsuccess = () => {
        const result = req.result as MaterialOriginalRecord | undefined;
        resolve(result ? { status: 'found', record: result } : { status: 'missing' });
      };
      req.onerror = () => resolve({ status: 'error' });
    } catch {
      resolve({ status: 'error' });
    }
  });
}

function writeOriginal(db: IDBDatabase, record: MaterialOriginalRecord): Promise<'ok' | 'error' | 'abort'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'ok' | 'error' | 'abort') => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
      tx.oncomplete = () => finish('ok');
      tx.onerror = () => finish('error');
      tx.onabort = () => finish('abort');
      tx.objectStore(ORIGINAL_STORE_NAME).put(record);
    } catch {
      finish('error');
    }
  });
}

/** Persists a local original and verifies it by reading it back. */
export async function saveMaterialOriginal(
  materialId: string,
  blob: Blob,
  contentType: string,
  knownHash?: string
): Promise<OriginalSaveResult> {
  return saveMaterialOriginalInScope(getStorageScopeId(), materialId, blob, contentType, knownHash);
}

/** Scope-pinned original save: the target store comes from the explicit scope. */
export async function saveMaterialOriginalInScope(
  scopeId: string,
  materialId: string,
  blob: Blob,
  contentType: string,
  knownHash?: string
): Promise<OriginalSaveResult> {
  const updatedAt = new Date().toISOString();
  let data: ArrayBuffer;
  try {
    data = await blob.arrayBuffer();
  } catch {
    return { persisted: false, storage: 'none', hash: knownHash ?? '', size: blob.size, updatedAt, error: '원본 파일을 읽지 못했습니다.' };
  }
  const hash = knownHash || (await hashBlob(blob));
  const record: MaterialOriginalRecord = { materialId, data, contentType, size: data.byteLength, hash, updatedAt };

  const db = await openDBByName(scopeIdToDbName(scopeId));
  if (!db) {
    return { persisted: false, storage: 'none', hash, size: record.size, updatedAt, error: '브라우저 IndexedDB를 사용할 수 없어 원본을 이 기기에 보관하지 못했습니다.' };
  }
  const write = await writeOriginal(db, record);
  if (write !== 'ok') {
    return { persisted: false, storage: 'none', hash, size: record.size, updatedAt, error: write === 'abort' ? '원본 저장 트랜잭션이 중단되었습니다.' : '원본 저장에 실패했습니다.' };
  }
  const verify = await readOriginal(db, materialId);
  if (verify.status !== 'found' || verify.record.hash !== hash || verify.record.size !== record.size) {
    return { persisted: false, storage: 'none', hash, size: record.size, updatedAt, error: '원본 저장을 검증하지 못했습니다.' };
  }
  return { persisted: true, storage: 'indexeddb', hash, size: record.size, updatedAt };
}

export async function loadMaterialOriginal(materialId: string): Promise<OriginalLoadResult> {
  return loadMaterialOriginalInScope(getStorageScopeId(), materialId);
}

/** Scope-pinned original load: verification reads the same explicit store. */
export async function loadMaterialOriginalInScope(
  scopeId: string,
  materialId: string
): Promise<OriginalLoadResult> {
  if (!isIndexedDBAvailable()) return { status: 'missing' };
  const db = await openDBByName(scopeIdToDbName(scopeId));
  if (!db) return { status: 'error', error: 'IndexedDB를 열 수 없습니다.' };
  const result = await readOriginal(db, materialId);
  if (result.status === 'missing') return { status: 'missing' };
  if (result.status === 'error') return { status: 'error', error: 'IndexedDB 읽기에 실패했습니다.' };
  const record = result.record;
  return {
    status: 'found',
    storage: 'indexeddb',
    blob: new Blob([record.data], { type: record.contentType }),
    contentType: record.contentType,
    hash: record.hash,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}

export async function deleteMaterialOriginal(materialId: string): Promise<MaterialDeleteResult> {
  if (!isIndexedDBAvailable()) return { deleted: true, storage: 'none' };
  const db = await openDB();
  if (!db) return { deleted: false, storage: 'none', error: 'IndexedDB를 열 수 없습니다.' };
  return new Promise<MaterialDeleteResult>((resolve) => {
    let settled = false;
    const finish = (result: MaterialDeleteResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const tx = db.transaction(ORIGINAL_STORE_NAME, 'readwrite');
      tx.oncomplete = () => finish({ deleted: true, storage: 'indexeddb' });
      tx.onerror = () => finish({ deleted: false, storage: 'none', error: tx.error?.message });
      tx.objectStore(ORIGINAL_STORE_NAME).delete(materialId);
    } catch (err) {
      finish({ deleted: false, storage: 'none', error: err instanceof Error ? err.message : '원본 삭제 중 오류가 발생했습니다.' });
    }
  });
}

/** Ids of originals stored locally (current scope), for reconnect/backup. */
export async function listMaterialOriginalIds(): Promise<string[] | null> {
  if (!isIndexedDBAvailable()) return [];
  const db = await openDB();
  if (!db) return null;
  return new Promise<string[] | null>((resolve) => {
    try {
      const tx = db.transaction(ORIGINAL_STORE_NAME, 'readonly');
      const req = tx.objectStore(ORIGINAL_STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Storage usage + persistence
// ---------------------------------------------------------------------------

export interface LocalStorageEstimate {
  supported: boolean;
  usage?: number;
  quota?: number;
}

export async function estimateLocalStorageUsage(): Promise<LocalStorageEstimate> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { supported: true, usage, quota };
    }
  } catch {
    // ignore
  }
  return { supported: false };
}

/** Requests persistent storage when supported; the result is never guaranteed. */
export async function requestPersistentStorage(): Promise<'granted' | 'denied' | 'unsupported'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      return granted ? 'granted' : 'denied';
    }
  } catch {
    // ignore
  }
  return 'unsupported';
}
