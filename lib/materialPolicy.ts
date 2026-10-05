import type { Material, MaterialPage, MaterialStoragePolicy } from './types';
import { scopedStorageKey } from './storageScope';
import { materialContentHash } from './cloud/hash';
import { hashBlob } from './materialStorage';

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

/**
 * v2 adds per-entry file-state records (included / absent / error) so a backup
 * can distinguish "the file never existed" from "the file is missing" and from
 * "the file could not be read". v1 files remain readable: they carry the same
 * entries without the file-state record.
 */
export const MATERIAL_BACKUP_VERSION = 2;
export const SUPPORTED_MATERIAL_BACKUP_VERSIONS = [1, 2] as const;

/**
 * THE single source of backup size limits. Both the export path and the import
 * parser validate against THIS object, so a backup this app writes can always
 * be read back by this app.
 */
export const MATERIAL_BACKUP_LIMITS = {
  /** Rejected in the UI from the File size before the file is even read. */
  fileBytes: 400 * 1024 * 1024,
  /** Rejected by the parser from the serialized JSON text length. */
  textChars: 256 * 1024 * 1024,
  /** Maximum number of material entries. */
  materials: 10_000,
  /** Per-entry body text cap (markdown, rawText, and pages combined). */
  bodyTextChars: 20 * 1024 * 1024,
  /** Per-entry base64 cap for the original file (~168MB decoded). */
  originalBase64Chars: 224 * 1024 * 1024,
} as const;

export type MaterialBackupLimits = {
  fileBytes: number;
  textChars: number;
  materials: number;
  bodyTextChars: number;
  originalBase64Chars: number;
};

export type BackupLimitViolation = {
  id: string | null;
  title: string | null;
  reason: string;
};

function countBodyChars(body: NonNullable<MaterialBackupEntry['body']>): number {
  let total = body.markdown.length + (body.rawText?.length ?? 0);
  if (body.pages) {
    for (const page of body.pages) {
      total += page.markdown.length + (page.rawText?.length ?? 0);
    }
  }
  return total;
}

/**
 * Export-side twin of the parser's limit checks. The TOTAL is the EXACT length
 * of the serialized file (computed by stringifying one entry at a time, so the
 * peak memory is bounded by the largest entry, not by the whole backup), which
 * is the same number the parser checks on import. Uses THE SAME
 * MATERIAL_BACKUP_LIMITS, so anything this app exports can be imported back.
 */
export function findBackupLimitViolations(
  backup: MaterialBackupFile,
  limits: MaterialBackupLimits = MATERIAL_BACKUP_LIMITS
): BackupLimitViolation[] {
  const violations: BackupLimitViolation[] = [];
  if (backup.materials.length > limits.materials) {
    violations.push({
      id: null,
      title: null,
      reason: `자료 수(${backup.materials.length}건)가 처리 가능한 범위(${limits.materials}건)를 초과했습니다. 자료를 나누어 내보내 주세요.`,
    });
  }
  let entryChars = 0;
  for (const entry of backup.materials) {
    entryChars += JSON.stringify(entry).length;
    if (entry.body && countBodyChars(entry.body) > limits.bodyTextChars) {
      violations.push({
        id: entry.material.id,
        title: entry.material.title,
        reason: `본문이 처리 가능한 크기(${limits.bodyTextChars}자)를 초과했습니다.`,
      });
    }
    const originalChars = entry.original?.base64.length ?? 0;
    if (originalChars > limits.originalBase64Chars) {
      violations.push({
        id: entry.material.id,
        title: entry.material.title,
        reason: `원본 파일이 처리 가능한 크기(약 ${Math.floor(limits.originalBase64Chars / 4 / 1024 / 1024)}MB)를 초과했습니다.`,
      });
    }
  }
  // Exact serialized length: the fixed wrapper (…,"materials":[]) keeps its
  // brackets, and the entries are joined by commas inside them.
  const wrapper = JSON.stringify({ ...backup, materials: [] });
  const totalText =
    wrapper.length + entryChars + Math.max(0, backup.materials.length - 1);
  if (totalText > limits.textChars) {
    violations.push({
      id: null,
      title: null,
      reason: `백업 전체 크기가 처리 가능한 범위(${limits.textChars}자)를 초과했습니다. 자료를 나누어 내보내 주세요.`,
    });
  }
  return violations;
}

export type BackupFileState = 'included' | 'absent' | 'error';

export interface MaterialBackupEntry {
  /** Metadata-only material (heavy body fields removed, allowlist-based). */
  material: Material;
  body?: { markdown: string; rawText?: string; pages?: MaterialPage[] };
  original?: { contentType: string; hash: string; base64: string };
  /** v2: how each local file was captured at export time. */
  fileState?: { body: BackupFileState; original: BackupFileState };
  /** v2: the read error message when a file could not be read. */
  fileError?: { body?: string; original?: string };
}

export interface MaterialBackupFile {
  version: number;
  exportedAt?: string;
  materials: MaterialBackupEntry[];
}

/**
 * Metadata fields allowed in a backup. The export NEVER blanket-copies the
 * material object: only these fields are written, so unknown or future fields
 * (and any credential-shaped field) cannot leak into a backup.
 */
const MATERIAL_BACKUP_FIELDS = [
  'id',
  'subjectId',
  'kind',
  'title',
  'sourceRefs',
  'pageCount',
  'durationMinutes',
  'status',
  'statusMessage',
  'isConverted',
  'isDemo',
  'uploadedAt',
  'lastEditedAt',
  'speakerCount',
  'speakers',
  'hasAiConcepts',
  'hasAiProblems',
  'storagePolicy',
  'originalHash',
  'fileSize',
  'bodyHash',
] as const;

/**
 * Allowlist projection of a material for backup. Heavy body fields
 * (parsedMarkdown/rawText/pages) are never copied here; the body travels in
 * `entry.body` from IndexedDB (or from the metadata-embedded fallback below).
 */
export function materialBackupMetadata(material: Material): Material {
  const source = material as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of MATERIAL_BACKUP_FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out as unknown as Material;
}

/**
 * Metadata-embedded body (demo materials and legacy records keep their body
 * inline). Used as a fallback when IndexedDB has no separate body, so such a
 * material is still backed up completely.
 */
function embeddedMaterialBody(
  material: Material
): { markdown: string; rawText?: string; pages?: MaterialPage[] } | null {
  if (typeof material.parsedMarkdown !== 'string') return null;
  const body: { markdown: string; rawText?: string; pages?: MaterialPage[] } = {
    markdown: material.parsedMarkdown,
  };
  if (typeof material.rawText === 'string') body.rawText = material.rawText;
  if (Array.isArray(material.pages)) body.pages = material.pages;
  return body;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'base64');
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type BackupBodyLoadResult =
  | { status: 'found'; body: { markdown: string; rawText?: string; pages?: MaterialPage[] } }
  | { status: 'missing' }
  | { status: 'error'; error: string };

export type BackupOriginalLoadResult =
  | { status: 'found'; original: { contentType: string; hash: string; data: Uint8Array } }
  | { status: 'missing' }
  | { status: 'error'; error: string };

export type MaterialBackupLoaders = {
  loadBody: (materialId: string) => Promise<BackupBodyLoadResult>;
  loadOriginal: (materialId: string) => Promise<BackupOriginalLoadResult>;
};

/**
 * Accepts both the discriminated loader result and the legacy plain/null shape
 * ({ body } or null) so older loaders keep working.
 */
function normalizeBodyResult(value: unknown): BackupBodyLoadResult {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'status' in value) {
    const record = value as { status?: unknown; error?: unknown; body?: unknown };
    if (record.status === 'missing') return { status: 'missing' };
    if (record.status === 'found' && record.body && typeof record.body === 'object') {
      return { status: 'found', body: record.body as { markdown: string; rawText?: string; pages?: MaterialPage[] } };
    }
    return {
      status: 'error',
      error: typeof record.error === 'string' && record.error ? record.error : '본문을 읽지 못했습니다.',
    };
  }
  if (!value) return { status: 'missing' };
  return { status: 'found', body: value as { markdown: string; rawText?: string; pages?: MaterialPage[] } };
}

function normalizeOriginalResult(value: unknown): BackupOriginalLoadResult {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'status' in value) {
    const record = value as { status?: unknown; error?: unknown; original?: unknown };
    if (record.status === 'missing') return { status: 'missing' };
    if (
      record.status === 'found' &&
      record.original &&
      typeof record.original === 'object' &&
      typeof (record.original as { contentType?: unknown }).contentType === 'string' &&
      typeof (record.original as { hash?: unknown }).hash === 'string'
    ) {
      return { status: 'found', original: record.original as { contentType: string; hash: string; data: Uint8Array } };
    }
    return {
      status: 'error',
      error: typeof record.error === 'string' && record.error ? record.error : '원본을 읽지 못했습니다.',
    };
  }
  if (!value) return { status: 'missing' };
  return { status: 'found', original: value as { contentType: string; hash: string; data: Uint8Array } };
}

/**
 * Builds a backup. Read failures are RECORDED as `fileState: 'error'` (with the
 * error message) instead of being silently swallowed as absence, so the export
 * report can distinguish 누락 from 읽기 실패. Per-entry size limits are enforced
 * while building (failing fast before more memory is committed); the caller
 * must still run findBackupLimitViolations() on the result BEFORE serializing.
 */
export async function buildMaterialBackup(
  materials: Material[],
  loaders: MaterialBackupLoaders,
  limits: MaterialBackupLimits = MATERIAL_BACKUP_LIMITS
): Promise<MaterialBackupFile> {
  const entries: MaterialBackupEntry[] = [];
  for (const material of materials) {
    const entry: MaterialBackupEntry = { material: materialBackupMetadata(material) };
    const fileState: { body: BackupFileState; original: BackupFileState } = { body: 'absent', original: 'absent' };
    const fileError: { body?: string; original?: string } = {};

    let bodyResult: BackupBodyLoadResult;
    try {
      bodyResult = normalizeBodyResult(await loaders.loadBody(material.id));
    } catch (error) {
      bodyResult = { status: 'error', error: error instanceof Error ? error.message : '본문을 읽지 못했습니다.' };
    }
    if (bodyResult.status === 'found') {
      entry.body = bodyResult.body;
      fileState.body = 'included';
    } else if (bodyResult.status === 'missing') {
      // Demo materials and legacy records keep the body inside the metadata;
      // fall back to it so the backup stays complete.
      const embedded = embeddedMaterialBody(material);
      if (embedded) {
        entry.body = embedded;
        fileState.body = 'included';
      } else {
        fileState.body = 'absent';
      }
    } else {
      fileState.body = 'error';
      fileError.body = bodyResult.error;
    }
    if (entry.body && countBodyChars(entry.body) > limits.bodyTextChars) {
      throw new Error(`자료 "${material.title}"의 본문이 처리 가능한 크기(${limits.bodyTextChars}자)를 초과해 내보내기를 중단했습니다.`);
    }

    let originalResult: BackupOriginalLoadResult;
    try {
      originalResult = normalizeOriginalResult(await loaders.loadOriginal(material.id));
    } catch (error) {
      originalResult = { status: 'error', error: error instanceof Error ? error.message : '원본을 읽지 못했습니다.' };
    }
    if (originalResult.status === 'found') {
      const base64 = bytesToBase64(originalResult.original.data);
      if (base64.length > limits.originalBase64Chars) {
        throw new Error(
          `자료 "${material.title}"의 원본 파일이 처리 가능한 크기(약 ${Math.floor(limits.originalBase64Chars / 4 / 1024 / 1024)}MB)를 초과해 내보내기를 중단했습니다.`
        );
      }
      entry.original = {
        contentType: originalResult.original.contentType,
        hash: originalResult.original.hash,
        base64,
      };
      fileState.original = 'included';
    } else if (originalResult.status === 'error') {
      fileState.original = 'error';
      fileError.original = originalResult.error;
    } else {
      fileState.original = 'absent';
    }

    entry.fileState = fileState;
    if (fileError.body || fileError.original) entry.fileError = fileError;
    entries.push(entry);
  }
  return { version: MATERIAL_BACKUP_VERSION, exportedAt: new Date().toISOString(), materials: entries };
}

/**
 * Serializes the backup into SEPARATE text parts (header + one part per entry
 * + footer) instead of one whole JSON string, so the download step never has to
 * materialize the entire file in memory on top of the already-built entries.
 * Each part is bounded by the per-entry limits already enforced while building.
 *
 * The joined text is byte-for-byte the same as JSON.stringify(backup).
 */
export function materialBackupBlobParts(backup: MaterialBackupFile): string[] {
  if (typeof backup.version !== 'number' || !Number.isFinite(backup.version)) {
    throw new Error('백업 버전 기록이 올바르지 않습니다.');
  }
  const parts: string[] = ['{"version":', JSON.stringify(backup.version)];
  if (backup.exportedAt !== undefined) {
    parts.push(',"exportedAt":', JSON.stringify(backup.exportedAt));
  }
  parts.push(',"materials":[');
  for (let i = 0; i < backup.materials.length; i += 1) {
    if (i > 0) parts.push(',');
    parts.push(JSON.stringify(backup.materials[i]));
  }
  parts.push(']}');
  return parts;
}

// ---------------------------------------------------------------------------
// Parse + pre-write validation. A malformed file is rejected BEFORE any write.
// ---------------------------------------------------------------------------

export type MaterialBackupParse =
  | { ok: true; backup: MaterialBackupFile }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const MATERIAL_KINDS = ['pdf', 'transcript', 'handout'] as const;
const MATERIAL_STATUSES = ['ready', 'converting', 'failed', 'needs_review'] as const;

/** Strict allowlist parse of one material. Wrong types are rejected, not coerced. */
function parseBackupMaterial(value: unknown, index: number): Material | string {
  const rec = asRecord(value);
  if (!rec) return `백업 항목 ${index + 1}에 자료 정보가 없습니다.`;
  const id = rec.id;
  if (typeof id !== 'string' || !id.trim()) return `백업 항목 ${index + 1}에 자료 ID가 없거나 형식이 올바르지 않습니다.`;
  if (typeof rec.subjectId !== 'string' || !rec.subjectId.trim()) return `자료 ${id}의 과목 ID가 없거나 형식이 올바르지 않습니다.`;
  if (!MATERIAL_KINDS.includes(rec.kind as (typeof MATERIAL_KINDS)[number])) return `자료 ${id}의 종류(kind)가 올바르지 않습니다.`;
  if (typeof rec.title !== 'string' || !rec.title.trim()) return `자료 ${id}의 제목이 없거나 형식이 올바르지 않습니다.`;
  if (!MATERIAL_STATUSES.includes(rec.status as (typeof MATERIAL_STATUSES)[number])) return `자료 ${id}의 상태(status)가 올바르지 않습니다.`;
  if (typeof rec.isConverted !== 'boolean') return `자료 ${id}의 변환 여부(isConverted)가 올바르지 않습니다.`;
  if (typeof rec.uploadedAt !== 'string' || !rec.uploadedAt.trim()) return `자료 ${id}의 등록 시각(uploadedAt)이 올바르지 않습니다.`;

  const material: Material = {
    id,
    subjectId: rec.subjectId,
    kind: rec.kind as Material['kind'],
    title: rec.title,
    sourceRefs: typeof rec.sourceRefs === 'string' ? rec.sourceRefs : '',
    status: rec.status as Material['status'],
    isConverted: rec.isConverted,
    uploadedAt: rec.uploadedAt,
  };

  const setOptionalNumber = (field: string, target: (v: number) => void, min: number): string | null => {
    const raw = rec[field];
    if (raw === undefined) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || !Number.isInteger(raw)) {
      return `자료 ${id}의 ${field} 값이 올바르지 않습니다.`;
    }
    target(raw);
    return null;
  };
  let failure = setOptionalNumber('pageCount', (v) => { material.pageCount = v; }, 1);
  if (failure) return failure;
  failure = setOptionalNumber('durationMinutes', (v) => { material.durationMinutes = v; }, 1);
  if (failure) return failure;
  failure = setOptionalNumber('speakerCount', (v) => { material.speakerCount = v; }, 0);
  if (failure) return failure;

  if (rec.statusMessage !== undefined) {
    if (typeof rec.statusMessage !== 'string') return `자료 ${id}의 상태 메시지 형식이 올바르지 않습니다.`;
    material.statusMessage = rec.statusMessage;
  }
  if (rec.isDemo !== undefined) {
    if (typeof rec.isDemo !== 'boolean') return `자료 ${id}의 데모 여부(isDemo)가 올바르지 않습니다.`;
    material.isDemo = rec.isDemo;
  }
  if (rec.lastEditedAt !== undefined) {
    if (typeof rec.lastEditedAt !== 'string' || !rec.lastEditedAt.trim()) return `자료 ${id}의 수정 시각이 올바르지 않습니다.`;
    material.lastEditedAt = rec.lastEditedAt;
  }
  if (rec.speakers !== undefined) {
    if (!Array.isArray(rec.speakers) || !rec.speakers.every((s) => typeof s === 'string')) {
      return `자료 ${id}의 화자 목록 형식이 올바르지 않습니다.`;
    }
    material.speakers = rec.speakers as string[];
  }
  for (const flag of ['hasAiConcepts', 'hasAiProblems'] as const) {
    if (rec[flag] !== undefined) {
      if (typeof rec[flag] !== 'boolean') return `자료 ${id}의 ${flag} 값이 올바르지 않습니다.`;
      material[flag] = rec[flag];
    }
  }
  if (rec.storagePolicy !== undefined) {
    const policy = asRecord(rec.storagePolicy);
    if (
      !policy ||
      typeof policy.syncBody !== 'boolean' ||
      typeof policy.backupOriginal !== 'boolean'
    ) {
      return `자료 ${id}의 저장 정책(storagePolicy) 형식이 올바르지 않습니다.`;
    }
    material.storagePolicy = { syncBody: policy.syncBody, backupOriginal: policy.backupOriginal };
  }
  if (rec.originalHash !== undefined) {
    if (typeof rec.originalHash !== 'string' || !rec.originalHash.trim()) return `자료 ${id}의 원본 해시가 올바르지 않습니다.`;
    material.originalHash = rec.originalHash;
  }
  if (rec.fileSize !== undefined) {
    if (typeof rec.fileSize !== 'number' || !Number.isFinite(rec.fileSize) || rec.fileSize < 0) {
      return `자료 ${id}의 파일 크기가 올바르지 않습니다.`;
    }
    material.fileSize = rec.fileSize;
  }
  if (rec.bodyHash !== undefined) {
    if (typeof rec.bodyHash !== 'string' || !rec.bodyHash.trim()) return `자료 ${id}의 본문 식별 정보가 올바르지 않습니다.`;
    material.bodyHash = rec.bodyHash;
  }
  // Any field outside the allowlist is dropped here (never copied through), so
  // a tampered or hand-crafted file cannot smuggle credential-shaped fields.
  return material;
}

function parseBackupBody(
  value: unknown,
  id: string,
  limits: MaterialBackupLimits
): MaterialBackupEntry['body'] | null | string {
  const rec = asRecord(value);
  if (!rec) return `자료 ${id}의 본문 형식이 올바르지 않습니다.`;
  if (typeof rec.markdown !== 'string') return `자료 ${id}의 본문(markdown)이 텍스트가 아닙니다.`;
  const body: NonNullable<MaterialBackupEntry['body']> = { markdown: rec.markdown };
  if (rec.rawText !== undefined) {
    if (typeof rec.rawText !== 'string') return `자료 ${id}의 원문 텍스트(rawText) 형식이 올바르지 않습니다.`;
    body.rawText = rec.rawText;
  }
  if (rec.pages !== undefined) {
    if (!Array.isArray(rec.pages)) return `자료 ${id}의 페이지 데이터 형식이 올바르지 않습니다.`;
    const pages: MaterialPage[] = [];
    for (const pageValue of rec.pages) {
      const page = asRecord(pageValue);
      if (!page) return `자료 ${id}의 페이지 항목 형식이 올바르지 않습니다.`;
      if (
        typeof page.pageNumber !== 'number' ||
        !Number.isInteger(page.pageNumber) ||
        page.pageNumber < 1
      ) {
        return `자료 ${id}의 페이지 번호가 올바르지 않습니다.`;
      }
      if (typeof page.markdown !== 'string') return `자료 ${id}의 페이지 본문이 텍스트가 아닙니다.`;
      if (typeof page.hasText !== 'boolean') return `자료 ${id}의 페이지 텍스트 여부가 올바르지 않습니다.`;
      const parsedPage: MaterialPage = {
        pageNumber: page.pageNumber,
        markdown: page.markdown,
        hasText: page.hasText,
      };
      if (page.rawText !== undefined) {
        if (typeof page.rawText !== 'string') return `자료 ${id}의 페이지 원문 형식이 올바르지 않습니다.`;
        parsedPage.rawText = page.rawText;
      }
      pages.push(parsedPage);
    }
    body.pages = pages;
  }
  if (countBodyChars(body) > limits.bodyTextChars) {
    return `자료 ${id}의 본문이 처리 가능한 크기(${limits.bodyTextChars}자)를 초과했습니다.`;
  }
  return body;
}

function parseBackupOriginal(
  value: unknown,
  material: Material,
  limits: MaterialBackupLimits
): MaterialBackupEntry['original'] | null | string {
  const rec = asRecord(value);
  if (!rec) return `자료 ${material.id}의 원본 형식이 올바르지 않습니다.`;
  if (typeof rec.contentType !== 'string' || !rec.contentType.trim()) {
    return `자료 ${material.id}의 원본 형식(contentType)이 올바르지 않습니다.`;
  }
  if (typeof rec.hash !== 'string' || !rec.hash.trim()) return `자료 ${material.id}의 원본 해시가 없습니다.`;
  if (typeof rec.base64 !== 'string') return `자료 ${material.id}의 원본 데이터 형식이 올바르지 않습니다.`;
  if (rec.base64.length > limits.originalBase64Chars) {
    return `자료 ${material.id}의 원본이 처리 가능한 크기(${limits.originalBase64Chars}자)를 초과했습니다.`;
  }
  if (rec.base64.length % 4 !== 0 || !BASE64_PATTERN.test(rec.base64)) {
    return `자료 ${material.id}의 원본 데이터를 해석할 수 없습니다. (base64 형식 오류)`;
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(rec.base64);
  } catch {
    return `자료 ${material.id}의 원본 데이터를 해석할 수 없습니다.`;
  }
  if (bytes.byteLength === 0) return `자료 ${material.id}의 원본 데이터가 비어 있습니다.`;
  if (typeof material.fileSize === 'number' && material.fileSize !== bytes.byteLength) {
    return `자료 ${material.id}의 원본 크기(${bytes.byteLength}바이트)가 선언된 크기(${material.fileSize}바이트)와 일치하지 않습니다.`;
  }
  return { contentType: rec.contentType, hash: rec.hash, base64: rec.base64 };
}

function parseBackupFileState(value: unknown, id: string): NonNullable<MaterialBackupEntry['fileState']> | string {
  const rec = asRecord(value);
  if (!rec) return `자료 ${id}의 파일 상태 기록 형식이 올바르지 않습니다.`;
  const states: BackupFileState[] = ['included', 'absent', 'error'];
  if (!states.includes(rec.body as BackupFileState) || !states.includes(rec.original as BackupFileState)) {
    return `자료 ${id}의 파일 상태 기록이 올바르지 않습니다.`;
  }
  return { body: rec.body as BackupFileState, original: rec.original as BackupFileState };
}

/**
 * Full structural validation of a backup file. Unsupported versions are
 * rejected with an explicit error (never reinterpreted as the current version).
 * Uses the SAME MATERIAL_BACKUP_LIMITS as the export path.
 */
export function parseMaterialBackup(
  text: string,
  limits: MaterialBackupLimits = MATERIAL_BACKUP_LIMITS
): MaterialBackupParse {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: '백업 파일이 비어 있습니다.' };
  }
  if (text.length > limits.textChars) {
    return { ok: false, error: '백업 파일이 처리 가능한 크기를 초과했습니다.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '백업 파일을 해석할 수 없습니다.' };
  }
  const record = asRecord(parsed);
  if (!record) return { ok: false, error: '백업 파일 형식이 올바르지 않습니다.' };
  const version = record.version;
  if (
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    !SUPPORTED_MATERIAL_BACKUP_VERSIONS.includes(version as (typeof SUPPORTED_MATERIAL_BACKUP_VERSIONS)[number])
  ) {
    return {
      ok: false,
      error: `지원하지 않는 백업 버전입니다 (지원: v${SUPPORTED_MATERIAL_BACKUP_VERSIONS.join(', v')}, 파일: ${String(version)}).`,
    };
  }
  if (record.exportedAt !== undefined && (typeof record.exportedAt !== 'string' || !record.exportedAt.trim())) {
    return { ok: false, error: '백업 내보낸 시각 형식이 올바르지 않습니다.' };
  }
  if (!Array.isArray(record.materials)) {
    return { ok: false, error: '백업 파일 형식이 올바르지 않습니다. (자료 목록이 없습니다)' };
  }
  if (record.materials.length > limits.materials) {
    return { ok: false, error: '백업 자료 수가 처리 가능한 범위를 초과했습니다.' };
  }

  const entries: MaterialBackupEntry[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < record.materials.length; i += 1) {
    const entryRecord = asRecord(record.materials[i]);
    if (!entryRecord) return { ok: false, error: `백업 항목 ${i + 1}의 형식이 올바르지 않습니다.` };
    const material = parseBackupMaterial(entryRecord.material, i);
    if (typeof material === 'string') return { ok: false, error: material };
    if (seenIds.has(material.id)) {
      return { ok: false, error: `중복된 자료 ID가 있습니다: ${material.id}` };
    }
    seenIds.add(material.id);

    const entry: MaterialBackupEntry = { material };
    if (entryRecord.body !== undefined) {
      const body = parseBackupBody(entryRecord.body, material.id, limits);
      if (typeof body === 'string') return { ok: false, error: body };
      if (body) entry.body = body;
    }
    if (entryRecord.original !== undefined) {
      const original = parseBackupOriginal(entryRecord.original, material, limits);
      if (typeof original === 'string') return { ok: false, error: original };
      if (original) entry.original = original;
    }
    if (entryRecord.fileState !== undefined) {
      const fileState = parseBackupFileState(entryRecord.fileState, material.id);
      if (typeof fileState === 'string') return { ok: false, error: fileState };
      entry.fileState = fileState;
    }
    if (entryRecord.fileError !== undefined) {
      const fileErrorRecord = asRecord(entryRecord.fileError);
      if (!fileErrorRecord) return { ok: false, error: `자료 ${material.id}의 읽기 오류 기록 형식이 올바르지 않습니다.` };
      const fileError: { body?: string; original?: string } = {};
      for (const which of ['body', 'original'] as const) {
        const raw = fileErrorRecord[which];
        if (raw === undefined) continue;
        if (typeof raw !== 'string') return { ok: false, error: `자료 ${material.id}의 읽기 오류 기록 형식이 올바르지 않습니다.` };
        fileError[which] = raw;
      }
      if (fileError.body || fileError.original) entry.fileError = fileError;
    }
    entries.push(entry);
  }

  return {
    ok: true,
    backup: {
      version,
      ...(typeof record.exportedAt === 'string' ? { exportedAt: record.exportedAt } : {}),
      materials: entries,
    },
  };
}

/**
 * Defense-in-depth: rejects a backup whose OBJECT KEYS look like credential
 * fields. Values (titles, lecture markdown, transcripts) are never scanned, so
 * lecture content that merely mentions Authorization or access_token is fine.
 */
const SECRET_FIELD_PATTERN = /api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|secret|bearer|password|credential/i;

function containsSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretField);
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) return true;
    if (containsSecretField(child)) return true;
  }
  return false;
}

export function backupContainsSecrets(backup: MaterialBackupFile): boolean {
  return containsSecretField(backup);
}

export interface BackupOriginalHashVerification {
  ok: boolean;
  mismatched: Array<{ id: string; title: string }>;
  error?: string;
}

/**
 * Verifies every original's bytes against its declared hash BEFORE any write.
 * Uses the same hashBlob algorithm that produced the hash at save time.
 */
export async function verifyBackupOriginalHashes(
  backup: MaterialBackupFile
): Promise<BackupOriginalHashVerification> {
  const mismatched: Array<{ id: string; title: string }> = [];
  for (const entry of backup.materials) {
    if (!entry.original) continue;
    try {
      const bytes = base64ToBytes(entry.original.base64);
      const actual = await hashBlob(new Blob([bytes], { type: entry.original.contentType || 'application/pdf' }));
      if (actual !== entry.original.hash) {
        mismatched.push({ id: entry.material.id, title: entry.material.title });
      }
    } catch {
      mismatched.push({ id: entry.material.id, title: entry.material.title });
    }
  }
  if (mismatched.length > 0) {
    return {
      ok: false,
      mismatched,
      error: '원본 데이터가 선언된 해시와 일치하지 않습니다.',
    };
  }
  return { ok: true, mismatched };
}

// ---------------------------------------------------------------------------
// Export completeness: 포함됨 / 없음 / 읽기 실패 per file, per material.
// ---------------------------------------------------------------------------

export interface BackupCompletenessIssue {
  id: string;
  title: string;
  which: 'body' | 'original';
  state: 'absent' | 'error';
  message?: string;
}

export interface BackupCompletenessSummary {
  complete: boolean;
  issues: BackupCompletenessIssue[];
  materialsWithIssues: number;
}

/**
 * Expected files:
 *  - body: the material is converted (a body should exist somewhere);
 *  - original: a PDF material with a recorded original identity (originalHash).
 * Files that never existed are NOT issues; a missing expected file or a read
 * failure makes the backup a 부분 백업.
 */
export function summarizeBackupCompleteness(backup: MaterialBackupFile): BackupCompletenessSummary {
  const issues: BackupCompletenessIssue[] = [];
  for (const entry of backup.materials) {
    const bodyState = entry.fileState?.body ?? (entry.body ? 'included' : 'absent');
    const originalState = entry.fileState?.original ?? (entry.original ? 'included' : 'absent');
    const bodyExpected = entry.material.isConverted === true;
    const originalExpected = entry.material.kind === 'pdf' && Boolean(entry.material.originalHash);

    if (bodyState === 'error' || (bodyExpected && bodyState !== 'included')) {
      issues.push({
        id: entry.material.id,
        title: entry.material.title,
        which: 'body',
        state: bodyState === 'error' ? 'error' : 'absent',
        message: entry.fileError?.body,
      });
    }
    if (originalState === 'error' || (originalExpected && originalState !== 'included')) {
      issues.push({
        id: entry.material.id,
        title: entry.material.title,
        which: 'original',
        state: originalState === 'error' ? 'error' : 'absent',
        message: entry.fileError?.original,
      });
    }
  }
  return {
    complete: issues.length === 0,
    issues,
    materialsWithIssues: new Set(issues.map((issue) => issue.id)).size,
  };
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

export interface RestoreUnreadableFile {
  id: string;
  title: string;
  which: Array<'body' | 'original'>;
}

export interface RestorePlan {
  /** Entry ids safe to write (new metadata, missing files, or both). */
  toRestore: string[];
  /** Entry ids whose metadata and files already exist unchanged locally. */
  alreadyPresent: string[];
  /** Same id but different content/identity: skipped, reported, never overwritten. */
  conflicts: RestoreConflict[];
  /** Entries whose metadata must be created (subset of toRestore). */
  metadataToCreate: string[];
  /** Entries whose files are missing from the backup (reconnect needed). */
  missingFiles: RestoreMissingFile[];
  /** Files whose local read failed: writes are suppressed until retried. */
  unreadableFiles: RestoreUnreadableFile[];
  /** New metadata whose backup subjectId does not exist in this account. */
  needsSubjectChoice: Array<{ id: string; title: string; subjectId: string }>;
}

export interface RestoreExistingSnapshot {
  id: string;
  /** Whether material metadata with this id exists in this account. */
  metadataExists?: boolean;
  /** The existing metadata when present (used for identity comparison). */
  metadata?: Material;
  /** Local body presence: found / missing / error (storage failure). */
  localBody?: 'found' | 'missing' | 'error';
  /** Hash of the locally stored body, or null when absent/unreadable. */
  localBodyHash?: string | null;
  /** Local original presence: found / missing / error (storage failure). */
  localOriginal?: 'found' | 'missing' | 'error';
  /** Hash of the locally stored original, or null when absent/unreadable. */
  localOriginalHash?: string | null;
}

interface RestoredExistingView {
  metadataExists: boolean;
  metadata?: Material;
  localBody: 'found' | 'missing' | 'error';
  localBodyHash: string | null;
  localOriginal: 'found' | 'missing' | 'error';
  localOriginalHash: string | null;
}

function viewExisting(snapshot: RestoreExistingSnapshot | undefined): RestoredExistingView {
  if (!snapshot) {
    return {
      metadataExists: false,
      localBody: 'missing',
      localBodyHash: null,
      localOriginal: 'missing',
      localOriginalHash: null,
    };
  }
  return {
    metadataExists: snapshot.metadataExists ?? true,
    metadata: snapshot.metadata,
    localBody: snapshot.localBody ?? (snapshot.localBodyHash ? 'found' : 'missing'),
    localBodyHash: snapshot.localBodyHash ?? null,
    localOriginal: snapshot.localOriginal ?? (snapshot.localOriginalHash ? 'found' : 'missing'),
    localOriginalHash: snapshot.localOriginalHash ?? null,
  };
}

/**
 * Plans a restore without writing anything. Identity is checked by content
 * hash (never name or path alone). Existing records are never overwritten.
 *
 * Metadata existence and file existence are tracked SEPARATELY: a new
 * metadata-only entry is restored as metadata (파일 연결 필요), and a file-only
 * id still gets its missing metadata created. A read ERROR never turns into a
 * write.
 */
export function planMaterialRestore(
  entries: MaterialBackupEntry[],
  existing: RestoreExistingSnapshot[],
  options?: { knownSubjectIds?: string[] }
): RestorePlan {
  const toRestore: string[] = [];
  const alreadyPresent: string[] = [];
  const conflicts: RestoreConflict[] = [];
  const metadataToCreate: string[] = [];
  const missingFiles: RestoreMissingFile[] = [];
  const unreadableFiles: RestoreUnreadableFile[] = [];
  const needsSubjectChoice: Array<{ id: string; title: string; subjectId: string }> = [];

  for (const entry of entries) {
    const view = viewExisting(existing.find((e) => e.id === entry.material.id));
    const entryBodyHash = entry.body ? materialContentHash(entry.body) : null;
    const entryOriginalHash = entry.original?.hash ?? null;

    // Identity conflict: the same id already exists with a different subject or
    // kind. Restoring over it could mix two different materials, so refuse.
    if (
      view.metadataExists &&
      view.metadata &&
      (view.metadata.subjectId !== entry.material.subjectId || view.metadata.kind !== entry.material.kind)
    ) {
      conflicts.push({
        id: entry.material.id,
        title: entry.material.title,
        reason: '같은 ID의 기존 자료와 과목·종류가 달라 덮어쓰지 않습니다.',
      });
      continue;
    }

    const writeFiles: Array<'body' | 'original'> = [];
    let fileConflict = false;

    if (entry.body) {
      if (view.localBody === 'error') {
        unreadableFiles.push({ id: entry.material.id, title: entry.material.title, which: ['body'] });
      } else if (view.localBody === 'found') {
        if (entryBodyHash !== null && view.localBodyHash !== null && entryBodyHash !== view.localBodyHash) {
          conflicts.push({
            id: entry.material.id,
            title: entry.material.title,
            reason: '같은 ID에 다른 본문이 이미 있습니다. 덮어쓰지 않고 건너뜁니다.',
          });
          fileConflict = true;
        }
      } else {
        writeFiles.push('body');
      }
    }
    if (entry.original) {
      if (view.localOriginal === 'error') {
        unreadableFiles.push({ id: entry.material.id, title: entry.material.title, which: ['original'] });
      } else if (view.localOriginal === 'found') {
        if (entryOriginalHash !== null && view.localOriginalHash !== null && entryOriginalHash !== view.localOriginalHash) {
          conflicts.push({
            id: entry.material.id,
            title: entry.material.title,
            reason: '같은 ID에 다른 원본이 이미 있습니다. 덮어쓰지 않고 건너뜁니다.',
          });
          fileConflict = true;
        }
      } else {
        writeFiles.push('original');
      }
    }

    const metadataNeeded = !view.metadataExists;
    if (metadataNeeded && options?.knownSubjectIds && !options.knownSubjectIds.includes(entry.material.subjectId)) {
      needsSubjectChoice.push({
        id: entry.material.id,
        title: entry.material.title,
        subjectId: entry.material.subjectId,
      });
      continue;
    }

    if (fileConflict) continue;

    if (writeFiles.length > 0 || metadataNeeded) {
      toRestore.push(entry.material.id);
      if (metadataNeeded) metadataToCreate.push(entry.material.id);
    } else {
      alreadyPresent.push(entry.material.id);
    }

    // Report files the backup itself lacks, so the user knows what to reconnect.
    const which: Array<'body' | 'original'> = [];
    if (!entry.body) which.push('body');
    if (!entry.original) which.push('original');
    if (which.length > 0) {
      missingFiles.push({ id: entry.material.id, title: entry.material.title, which });
    }
  }

  return { toRestore, alreadyPresent, conflicts, metadataToCreate, missingFiles, unreadableFiles, needsSubjectChoice };
}
