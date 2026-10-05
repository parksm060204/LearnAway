import type { Material, MaterialPage, MaterialStoragePolicy } from './types';
import { scopedStorageKey } from './storageScope';
import { materialContentHash } from './cloud/hash';

/**
 * Local-first material storage policy.
 *
 * New materials default to keeping the converted body AND the original file on
 * this device only; the server stores just the metadata needed for learning
 * links. Uploading the body and/or the original is an explicit choice.
 */
export const DEFAULT_MATERIAL_POLICY: MaterialStoragePolicy = {
  syncBody: false,
  backupOriginal: false,
};

/** Legacy materials (no explicit policy) keep the previous synced behaviour. */
export function materialPolicyOf(material: Pick<Material, 'storagePolicy'>): MaterialStoragePolicy {
  return material.storagePolicy ?? { syncBody: true, backupOriginal: true };
}

// The default policy for NEW materials is stored per account (storageScope).
// The unscoped legacy key only ever applied before login; it is never copied
// into an account, so one account's choice cannot leak into another.
const POLICY_BASE_KEY = 'material_storage_policy_v1';

function policyStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

function parsePolicy(raw: string | null): MaterialStoragePolicy | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MaterialStoragePolicy>;
    return {
      syncBody: Boolean(parsed.syncBody),
      backupOriginal: Boolean(parsed.backupOriginal),
    };
  } catch {
    return null;
  }
}

/** Account-scoped default policy applied to NEW materials. */
export function loadDefaultMaterialPolicy(): MaterialStoragePolicy {
  const storage = policyStorage();
  if (!storage) return { ...DEFAULT_MATERIAL_POLICY };
  const parsed = parsePolicy(storage.getItem(scopedStorageKey(POLICY_BASE_KEY)));
  return parsed ?? { ...DEFAULT_MATERIAL_POLICY };
}

/**
 * Persists the account-scoped default policy and verifies the write.
 * Returns false when the value could not be stored, so callers never show a
 * failed save as success.
 */
export function saveDefaultMaterialPolicy(policy: MaterialStoragePolicy): boolean {
  const storage = policyStorage();
  if (!storage) return false;
  const key = scopedStorageKey(POLICY_BASE_KEY);
  const value = JSON.stringify({
    syncBody: Boolean(policy.syncBody),
    backupOriginal: Boolean(policy.backupOriginal),
  });
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    return false;
  }
}

export type MaterialLinkState =
  | 'local_kept'
  | 'body_synced'
  | 'original_backed_up'
  | 'synced'
  | 'needs_link'
  | 'save_failed';

export interface MaterialStorageStateInput {
  material: Material;
  /** The converted body is present on this device (IndexedDB). */
  hasLocalBody: boolean;
  /** The original file is present on this device (IndexedDB). */
  hasLocalOriginal: boolean;
  /** Cloud state from the server row (undefined when not fetched). */
  bodySynced?: boolean;
  originalBackedUp?: boolean;
  /** A local save (body or original) failed and needs a retry. */
  saveFailed?: boolean;
}

export interface MaterialStorageState {
  policy: MaterialStoragePolicy;
  local: { body: boolean; original: boolean };
  cloud: { body: boolean; original: boolean };
  state: MaterialLinkState;
  /** Korean labels for the material screen. */
  labels: string[];
  /**
   * The body is neither on this device nor in the cloud: the user must reconnect
   * the file (this is NOT corruption).
   */
  needsLink: boolean;
}

/**
 * Derives the storage state shown on the material screen. Metadata-only
 * materials on another device (no body locally, not synced) are reported as
 * "needs link", never as corruption.
 */
export function deriveMaterialStorageState(input: MaterialStorageStateInput): MaterialStorageState {
  const policy = materialPolicyOf(input.material);
  const local = { body: input.hasLocalBody, original: input.hasLocalOriginal };
  const cloud = { body: Boolean(input.bodySynced), original: Boolean(input.originalBackedUp) };

  const needsLink = !local.body && !cloud.body;
  const labels: string[] = [];
  if (input.saveFailed) labels.push('저장 실패 · 재시도 필요');
  if (local.body || local.original) labels.push('이 기기에 보관됨');
  if (cloud.body) labels.push('본문 동기화됨');
  if (cloud.original) labels.push('원본 백업됨');
  if (needsLink) labels.push('이 기기에서 파일 연결 필요');

  let state: MaterialLinkState;
  if (input.saveFailed) state = 'save_failed';
  else if (needsLink) state = 'needs_link';
  else if (cloud.body && cloud.original) state = 'synced';
  else if (cloud.body) state = 'body_synced';
  else if (cloud.original) state = 'original_backed_up';
  else state = 'local_kept';

  return { policy, local, cloud, state, labels, needsLink };
}

/** True only when a candidate file's hash matches the expected identity. */
export function reconnectHashMatches(expectedHash: string | undefined, candidateHash: string): boolean {
  return Boolean(expectedHash) && expectedHash === candidateHash;
}

// ---------------------------------------------------------------------------
// Backup / restore (metadata + local files). Never contains API keys/tokens.
// ---------------------------------------------------------------------------

export const MATERIAL_BACKUP_VERSION = 1;

export interface MaterialBackupEntry {
  /** Metadata-only material (heavy body fields removed). */
  material: Material;
  body?: { markdown: string; rawText?: string; pages?: MaterialPage[] };
  original?: { contentType: string; hash: string; base64: string };
}

export interface MaterialBackupFile {
  version: number;
  exportedAt: string;
  materials: MaterialBackupEntry[];
}

/** Metadata-only copy: never carries credentials (materials have none). */
export function sanitizeMaterialForBackup(material: Material): Material {
  const copy: Material = { ...material };
  delete copy.parsedMarkdown;
  delete copy.rawText;
  delete copy.pages;
  return copy;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type MaterialBackupLoaders = {
  loadBody: (materialId: string) => Promise<{ markdown: string; rawText?: string; pages?: MaterialPage[] } | null>;
  loadOriginal: (materialId: string) => Promise<{ contentType: string; hash: string; data: Uint8Array } | null>;
};

export async function buildMaterialBackup(
  materials: Material[],
  loaders: MaterialBackupLoaders
): Promise<MaterialBackupFile> {
  const entries: MaterialBackupEntry[] = [];
  for (const material of materials) {
    const entry: MaterialBackupEntry = { material: sanitizeMaterialForBackup(material) };
    const body = await loaders.loadBody(material.id).catch(() => null);
    if (body) entry.body = body;
    const original = await loaders.loadOriginal(material.id).catch(() => null);
    if (original) {
      entry.original = { contentType: original.contentType, hash: original.hash, base64: bytesToBase64(original.data) };
    }
    entries.push(entry);
  }
  return { version: MATERIAL_BACKUP_VERSION, exportedAt: new Date().toISOString(), materials: entries };
}

export type MaterialBackupParse =
  | { ok: true; backup: MaterialBackupFile }
  | { ok: false; error: string };

export function parseMaterialBackup(text: string): MaterialBackupParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '백업 파일을 해석할 수 없습니다.' };
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (!record || !Array.isArray(record.materials) || typeof record.version !== 'number') {
    return { ok: false, error: '백업 파일 형식이 올바르지 않습니다.' };
  }
  return { ok: true, backup: parsed as MaterialBackupFile };
}

/** Rejects a backup that somehow carries credential-looking fields. */
export function backupContainsSecrets(backup: MaterialBackupFile): boolean {
  const text = JSON.stringify(backup);
  return /api[_-]?key|authorization|bearer\s|access[_-]?token|refresh[_-]?token/i.test(text);
}

// ---------------------------------------------------------------------------
// Reconnect decisions (pure): re-linking a file to metadata-only material.
// ---------------------------------------------------------------------------

export type ReconnectDecision = 'accept' | 'mismatch' | 'confirm-required';

/**
 * Decides whether a candidate original file may be linked:
 * - accept: hashes match,
 * - mismatch: hashes differ -> existing record is preserved, never overwritten,
 * - confirm-required: the record carries no identity hash, so only an explicit
 *   user confirmation may link the file (never an automatic match).
 */
export function decideOriginalReconnect(
  expectedHash: string | undefined,
  candidateHash: string
): ReconnectDecision {
  if (!expectedHash) return 'confirm-required';
  return expectedHash === candidateHash ? 'accept' : 'mismatch';
}

// ---------------------------------------------------------------------------
// Restore planning (pure): never silently overwrites existing records.
// ---------------------------------------------------------------------------

export interface RestoreConflict {
  id: string;
  title: string;
  reason: string;
}

export interface RestoreMissingFile {
  id: string;
  title: string;
  which: Array<'body' | 'original'>;
}

export interface RestorePlan {
  /** Entry ids safe to write (new, or already-identical files). */
  toRestore: string[];
  /** Entry ids whose files already exist unchanged locally. */
  alreadyPresent: string[];
  /** Same id but different content: skipped, reported, never overwritten. */
  conflicts: RestoreConflict[];
  /** Entries with no files at all (metadata only): restored as metadata. */
  missingFiles: RestoreMissingFile[];
}

export interface RestoreExistingSnapshot {
  id: string;
  /** Hash of the locally stored body, or null when absent. */
  localBodyHash: string | null;
  /** Hash of the locally stored original, or null when absent. */
  localOriginalHash: string | null;
}

/**
 * Plans a restore without writing anything. Identity is checked by content
 * hash (never name or path alone). Existing records are never overwritten.
 */
export function planMaterialRestore(
  entries: MaterialBackupEntry[],
  existing: RestoreExistingSnapshot[]
): RestorePlan {
  const toRestore: string[] = [];
  const alreadyPresent: string[] = [];
  const conflicts: RestoreConflict[] = [];
  const missingFiles: RestoreMissingFile[] = [];

  for (const entry of entries) {
    const cur = existing.find((e) => e.id === entry.material.id);
    const entryBodyHash = entry.body ? materialContentHash(entry.body) : null;
    const entryOriginalHash = entry.original?.hash ?? null;

    if (!entry.body && !entry.original) {
      if (cur) {
        alreadyPresent.push(entry.material.id);
      } else {
        toRestore.push(entry.material.id);
      }
      missingFiles.push({ id: entry.material.id, title: entry.material.title, which: ['body', 'original'] });
      continue;
    }

    if (!cur) {
      toRestore.push(entry.material.id);
      const which: Array<'body' | 'original'> = [];
      if (!entry.body) which.push('body');
      if (!entry.original) which.push('original');
      if (which.length > 0) {
        missingFiles.push({ id: entry.material.id, title: entry.material.title, which });
      }
      continue;
    }

    const localBody = cur.localBodyHash ?? null;
    const localOriginal = cur.localOriginalHash ?? null;
    const bodyDiffers =
      entryBodyHash !== null && localBody !== null && entryBodyHash !== localBody;
    const originalDiffers =
      entryOriginalHash !== null && localOriginal !== null && entryOriginalHash !== localOriginal;
    if (bodyDiffers || originalDiffers) {
      conflicts.push({
        id: entry.material.id,
        title: entry.material.title,
        reason: '같은 ID에 다른 내용이 이미 있습니다. 덮어쓰지 않고 건너뜁니다.',
      });
      continue;
    }
    // Files this side lacks can be added; identical files are skipped.
    const bodyAddable = entryBodyHash !== null && localBody === null;
    const originalAddable = entryOriginalHash !== null && localOriginal === null;
    if (bodyAddable || originalAddable) {
      toRestore.push(entry.material.id);
      continue;
    }
    // Identical files: keep the existing record, do not rewrite it.
    alreadyPresent.push(entry.material.id);
  }

  return { toRestore, alreadyPresent, conflicts, missingFiles };
}
