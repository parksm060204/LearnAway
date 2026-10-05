import type { Material, MaterialPage, MaterialStoragePolicy } from './types';

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

const DEFAULT_POLICY_KEY = 'redcall_material_storage_policy_v1';

/** User-chosen default policy applied to NEW materials. */
export function loadDefaultMaterialPolicy(): MaterialStoragePolicy {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DEFAULT_POLICY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MaterialStoragePolicy>;
        return {
          syncBody: Boolean(parsed.syncBody),
          backupOriginal: Boolean(parsed.backupOriginal),
        };
      }
    }
  } catch {
    // fall through to the local-first default
  }
  return { ...DEFAULT_MATERIAL_POLICY };
}

export function saveDefaultMaterialPolicy(policy: MaterialStoragePolicy): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        DEFAULT_POLICY_KEY,
        JSON.stringify({ syncBody: Boolean(policy.syncBody), backupOriginal: Boolean(policy.backupOriginal) })
      );
    }
  } catch {
    // best effort
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

export function base64ToBytes(value: string): Uint8Array {
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
