/**
 * Durable, device-local drafts of an in-progress material body edit.
 *
 * Rules (AGENTS.md: data preservation / privacy):
 *  - A draft is stored in its OWN IndexedDB (per account scope), separate from
 *    the saved body in `materialStorage`. The saved body is never touched here.
 *  - Drafts are NEVER uploaded: this module imports nothing from `lib/cloud`.
 *  - Every API takes an EXPLICIT scope id so a late result from a flow that
 *    started in account A can never be written to / read from account B.
 *  - Persistence is only reported after a transaction completes AND a read-back
 *    matches. There is no in-memory fallback: if IndexedDB is unavailable the
 *    save fails, so callers never claim a durable save that did not happen.
 */

export const DRAFT_DB_BASE = 'redcall_material_drafts_db';
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = 'material_drafts';
export const DRAFT_SCHEMA_VERSION = 1;

export interface MaterialDraftRecord {
  materialId: string;
  scopeId: string;
  /** The edited (unsaved) markdown body. */
  draftMarkdown: string;
  /** Hash of the saved body this draft was based on. */
  baseHash: string;
  /** `lastEditedAt` of the material when the draft was created (null if never edited). */
  baseLastEditedAt: string | null;
  /** When this draft was written (ISO). */
  savedAt: string;
  schemaVersion: number;
}

export interface MaterialDraftInput {
  materialId: string;
  draftMarkdown: string;
  baseHash: string;
  baseLastEditedAt: string | null;
  savedAt?: string;
}

export type DraftSaveResult =
  | { ok: true; record: MaterialDraftRecord }
  | { ok: false; error: string };

export type DraftLoadResult =
  | { status: 'found'; record: MaterialDraftRecord }
  | { status: 'none' }
  | { status: 'error'; error: string };

export type DraftDeleteResult = { ok: true } | { ok: false; error: string };

/** How a stored draft relates to the body that is saved right now. */
export type DraftRelation =
  /** Draft was made from the current saved body: safe to offer for restore. */
  | 'restorable'
  /** Saved body changed since the draft was made: NEVER auto-apply. */
  | 'conflict'
  /** Draft text equals the saved body: nothing to restore. */
  | 'identical';

function validScopeId(scopeId: string): boolean {
  return scopeId === 'shared' || /^u_.+/.test(scopeId);
}

export function draftDbNameForScope(scopeId: string): string {
  return scopeId === 'shared' ? DRAFT_DB_BASE : `${DRAFT_DB_BASE}_${scopeId}`;
}

function openDraftDb(scopeId: string): Promise<{ db: IDBDatabase } | { error: string }> {
  if (!validScopeId(scopeId)) {
    return Promise.resolve({ error: '알 수 없는 저장소 스코프입니다.' });
  }
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve({ error: '이 브라우저에서는 임시 보존용 저장소(IndexedDB)를 사용할 수 없습니다.' });
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(draftDbNameForScope(scopeId), DRAFT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: 'materialId' });
        }
      };
      request.onsuccess = () => resolve({ db: request.result });
      request.onerror = () => resolve({ error: '임시 보존용 저장소를 열지 못했습니다.' });
    } catch {
      resolve({ error: '임시 보존용 저장소를 열지 못했습니다.' });
    }
  });
}

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function readRecord(db: IDBDatabase, materialId: string): Promise<DraftLoadResult> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const req = tx.objectStore(DRAFT_STORE).get(materialId);
      req.onsuccess = () => {
        const value = req.result as MaterialDraftRecord | undefined;
        if (!value) resolve({ status: 'none' });
        else if (
          typeof value.draftMarkdown !== 'string' ||
          typeof value.baseHash !== 'string' ||
          typeof value.savedAt !== 'string'
        ) {
          resolve({ status: 'error', error: '임시 편집본 형식이 올바르지 않습니다.' });
        } else resolve({ status: 'found', record: value });
      };
      req.onerror = () => resolve({ status: 'error', error: errorText(req.error, '임시 편집본을 읽지 못했습니다.') });
    } catch (error) {
      resolve({ status: 'error', error: errorText(error, '임시 편집본을 읽지 못했습니다.') });
    }
  });
}

/**
 * Writes a draft and verifies it by reading it back. `ok: true` means the
 * draft is durably stored in the given scope's own database.
 */
export async function saveMaterialDraftInScope(
  scopeId: string,
  input: MaterialDraftInput
): Promise<DraftSaveResult> {
  if (!input.materialId) return { ok: false, error: '자료 ID가 없습니다.' };
  const opened = await openDraftDb(scopeId);
  if ('error' in opened) return { ok: false, error: opened.error };
  const { db } = opened;

  const record: MaterialDraftRecord = {
    materialId: input.materialId,
    scopeId,
    draftMarkdown: input.draftMarkdown,
    baseHash: input.baseHash,
    baseLastEditedAt: input.baseLastEditedAt,
    savedAt: input.savedAt ?? new Date().toISOString(),
    schemaVersion: DRAFT_SCHEMA_VERSION,
  };

  const written = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      let settled = false;
      const done = (result: { ok: true } | { ok: false; error: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.oncomplete = () => done({ ok: true });
      tx.onerror = () => done({ ok: false, error: errorText(tx.error, '임시 편집본을 저장하지 못했습니다.') });
      tx.onabort = () => done({ ok: false, error: errorText(tx.error, '임시 편집본 저장이 중단되었습니다.') });
      const req = tx.objectStore(DRAFT_STORE).put(record);
      req.onerror = () => done({ ok: false, error: errorText(req.error, '임시 편집본을 저장하지 못했습니다.') });
    } catch (error) {
      resolve({ ok: false, error: errorText(error, '임시 편집본을 저장하지 못했습니다.') });
    }
  });
  if (!written.ok) {
    db.close();
    return written;
  }

  const verify = await readRecord(db, input.materialId);
  db.close();
  if (verify.status !== 'found') {
    return { ok: false, error: '임시 편집본 저장을 검증하지 못했습니다.' };
  }
  const stored = verify.record;
  if (
    stored.draftMarkdown !== record.draftMarkdown ||
    stored.baseHash !== record.baseHash ||
    stored.savedAt !== record.savedAt ||
    stored.scopeId !== scopeId
  ) {
    return { ok: false, error: '저장된 임시 편집본이 입력과 일치하지 않습니다.' };
  }
  return { ok: true, record: stored };
}

export async function loadMaterialDraftInScope(scopeId: string, materialId: string): Promise<DraftLoadResult> {
  const opened = await openDraftDb(scopeId);
  if ('error' in opened) return { status: 'error', error: opened.error };
  const result = await readRecord(opened.db, materialId);
  opened.db.close();
  // A record that claims another scope is never surfaced.
  if (result.status === 'found' && result.record.scopeId !== scopeId) return { status: 'none' };
  return result;
}

/** Removes ONLY this material's draft. The saved body is never touched. */
export async function deleteMaterialDraftInScope(scopeId: string, materialId: string): Promise<DraftDeleteResult> {
  const opened = await openDraftDb(scopeId);
  if ('error' in opened) return { ok: false, error: opened.error };
  const { db } = opened;
  const result = await new Promise<DraftDeleteResult>((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => resolve({ ok: false, error: errorText(tx.error, '임시 편집본을 삭제하지 못했습니다.') });
      tx.onabort = () => resolve({ ok: false, error: errorText(tx.error, '임시 편집본 삭제가 중단되었습니다.') });
      tx.objectStore(DRAFT_STORE).delete(materialId);
    } catch (error) {
      resolve({ ok: false, error: errorText(error, '임시 편집본을 삭제하지 못했습니다.') });
    }
  });
  db.close();
  return result;
}

export async function listMaterialDraftIdsInScope(scopeId: string): Promise<string[] | null> {
  const opened = await openDraftDb(scopeId);
  if ('error' in opened) return null;
  const { db } = opened;
  const ids = await new Promise<string[] | null>((resolve) => {
    try {
      const req = db.transaction(DRAFT_STORE, 'readonly').objectStore(DRAFT_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return ids;
}

/**
 * Decides how a stored draft may be used. A draft is only `restorable` when it
 * was made from the exact saved body that exists now; otherwise it is a
 * `conflict` and must never be applied automatically.
 */
export function evaluateDraftAgainstBase(
  draft: Pick<MaterialDraftRecord, 'baseHash' | 'draftMarkdown'>,
  current: { baseHash: string; markdown?: string }
): DraftRelation {
  if (current.markdown !== undefined && draft.draftMarkdown === current.markdown) return 'identical';
  if (draft.baseHash !== current.baseHash) return 'conflict';
  return 'restorable';
}
