'use client';

import { createClient } from '../supabase/client';
import type { Material, MaterialKind, MaterialStoragePolicy } from '../types';
import { materialContentHash } from './hash';
import { materialBaseUpsert, materialObjectPaths } from './mappers';
import type { CloudMaterialContent, MaterialRow, RepoResult } from './types';
import { repoError, repoOk } from './types';

export const MATERIALS_BUCKET = 'materials';
export const SIGNED_URL_TTL_SECONDS = 300;

type SupabaseClient = ReturnType<typeof createClient>;

function toMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function getCurrentUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function uploadText(
  supabase: SupabaseClient,
  path: string,
  text: string,
  contentType: string
): Promise<RepoResult<{ path: string }>> {
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, new Blob([text], { type: contentType }), { upsert: true, contentType });
  if (error) return repoError(error.message);
  return repoOk({ path });
}

async function uploadBlob(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
  contentType: string
): Promise<RepoResult<{ path: string }>> {
  const { error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, blob, { upsert: true, contentType });
  if (error) return repoError(error.message);
  return repoOk({ path });
}

async function downloadText(supabase: SupabaseClient, path: string): Promise<RepoResult<string>> {
  const { data, error } = await supabase.storage.from(MATERIALS_BUCKET).download(path);
  if (error || !data) return repoError(error?.message ?? '자료 본문을 내려받지 못했습니다.');
  try {
    return repoOk(await data.text());
  } catch (error) {
    return repoError(toMessage(error, '자료 본문을 읽지 못했습니다.'));
  }
}

type ListResult = { ok: true; paths: string[] } | { ok: false; error: string };

/**
 * Recursively lists every object under a prefix. Distinguishes "no files" from
 * "listing failed", propagates sub-folder failures, and pages through results
 * so the per-request limit never silently drops objects.
 */
async function listAllPaths(supabase: SupabaseClient, prefix: string): Promise<ListResult> {
  const paths: string[] = [];
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .list(prefix, { limit: pageSize, offset });
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: '파일 목록을 불러오지 못했습니다.' };

    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        const sub = await listAllPaths(supabase, full);
        if (!sub.ok) return sub;
        paths.push(...sub.paths);
      } else {
        paths.push(full);
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return { ok: true, paths };
}

/** Creates a caller-owned job id BEFORE the first request, so the retry
 *  record can reference the exact job the server will stage. */
export function generateJobId(): string {  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMaterialRows(): Promise<RepoResult<MaterialRow[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk((data as MaterialRow[]) ?? []);
  } catch (error) {
    return repoError(toMessage(error, '자료 목록을 불러오지 못했습니다.'));
  }
}

/** Downloads the parsed body (markdown / rawText / pages) for a material row. */
export async function downloadMaterialContent(
  row: MaterialRow
): Promise<RepoResult<CloudMaterialContent>> {
  try {
    const supabase = createClient();
    let markdown = '';
    let rawText: string | undefined;
    let pages: CloudMaterialContent['pages'];

    if (row.markdown_path) {
      const md = await downloadText(supabase, row.markdown_path);
      if (!md.ok) return md;
      markdown = md.data;
    }
    if (row.transcript_path) {
      const tr = await downloadText(supabase, row.transcript_path);
      if (!tr.ok) return tr;
      rawText = tr.data;
    }
    if (row.pages_path) {
      const pg = await downloadText(supabase, row.pages_path);
      if (!pg.ok) return pg;
      try {
        const parsed: unknown = JSON.parse(pg.data);
        pages = Array.isArray(parsed) ? (parsed as CloudMaterialContent['pages']) : undefined;
      } catch {
        return repoError('저장된 페이지 데이터가 올바른 JSON이 아닙니다.');
      }
    }
    return repoOk({ markdown, rawText, pages });
  } catch (error) {
    return repoError(toMessage(error, '자료 본문을 불러오지 못했습니다.'));
  }
}

/**
 * Reads the SERVER's current row for one material: body hash, version, the
 * pending job (if any), and the metadata columns the server persists. A lookup
 * failure is reported as an error — callers must never treat it as "no body"
 * or "not saved". Missing columns (pre-migration rows) arrive as undefined so
 * a retry verdict can treat them as insufficient evidence rather than proof.
 */
export interface MaterialServerState {
  hash: string | null;
  hasBody: boolean;
  version: number;
  pendingJobId: string | null;
  completedJobId?: string | null;
  metadata: {
    title?: string;
    status?: string;
    kind?: string;
    /** Derived without migration-9 columns: a stored body path means synced. */
    syncBody?: boolean;
  } | null;
}

export async function getMaterialServerBodyHash(
  materialId: string
): Promise<RepoResult<MaterialServerState>> {
  try {
    const rows = await listMaterialRows();
    if (!rows.ok) return rows;
    const row = rows.data.find((r) => r.id === materialId);
    if (!row) return repoOk({ hash: null, hasBody: false, version: 0, pendingJobId: null, completedJobId: null, metadata: null });
    const version = row.version ?? 0;
    const pendingJobId = row.pending_job_id ?? null;
    const completedJobId = row.last_completed_job_id;
    const metadata = {
      title: row.title ?? undefined,
      status: row.status ?? undefined,
      kind: row.kind ?? undefined,
      syncBody: Boolean(row.markdown_path) || Boolean((row as { body_synced?: unknown }).body_synced),
    };
    if (!row.markdown_path && !row.transcript_path && !row.pages_path) {
      return repoOk({ hash: null, hasBody: false, version, pendingJobId, completedJobId, metadata });
    }
    const content = await downloadMaterialContent(row);
    if (!content.ok) return content;
    return repoOk({ hash: materialContentHash(content.data), hasBody: true, version, pendingJobId, completedJobId, metadata });
  } catch (error) {
    return repoError(toMessage(error, '서버 본문을 확인하지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MaterialWriteInput {
  material: Material;
  content: CloudMaterialContent;
  original?: { blob: Blob; contentType: string } | null;
  jobId?: string;
  /** Defaults to the legacy behaviour (sync body + back up original). */
  policy?: MaterialStoragePolicy;
  /**
   * Optimistic concurrency: the write proceeds ONLY when the row still holds
   * this version (the version confirmed right before the attempt). A newer row
   * is refused as stale WITHOUT touching the pending slot, uploads or cleanup,
   * so a checked base can never be silently bypassed.
   */
  expectedVersion?: number;
}

const LEGACY_WRITE_POLICY: MaterialStoragePolicy = { syncBody: true, backupOriginal: true };

export interface MaterialMetadataInput {
  material: Material;
  bodySynced?: boolean;
  originalBackedUp?: boolean;
}

/**
 * Metadata-only cloud write for a local-first material: stores the learning
 * link (id/owner/subject/title/kind/hashes/policy) WITHOUT uploading the body or
 * the original. Never touches an existing row's paths, version or sync state.
 */
export const MIGRATION_9_COLUMNS = [
  'sync_body',
  'backup_original',
  'body_synced',
  'original_backed_up',
  'original_hash',
  'file_size',
] as const;

export function isMissingMigration9ColumnError(error: unknown): boolean {
  if (!error) return false;
  const errObj = typeof error === 'object' && error !== null ? (error as { code?: string; message?: string; details?: string }) : null;
  const code = errObj?.code;
  const msg = typeof error === 'string' ? error : errObj?.message || '';
  const details = errObj?.details || '';
  const fullText = `${msg} ${details}`;

  // Never treat auth/permission/constraint/timeout/network errors as missing column
  if (code && ['42501', '23502', '23503', '23505', '23514', '08000', '08003', '08006', '57014'].includes(code)) {
    return false;
  }

  const isUndefinedColumn =
    code === '42703' ||
    /(?:column[\s\S]*does not exist|column[\s\S]*schema cache)/i.test(fullText);

  if (!isUndefinedColumn) return false;

  return MIGRATION_9_COLUMNS.some((col) => fullText.includes(col));
}

export function stripMigration9Columns<T extends Record<string, unknown>>(payload: T): T {
  const copy = { ...payload };
  for (const col of MIGRATION_9_COLUMNS) {
    delete copy[col];
  }
  return copy;
}

let cachedMigration9Status: boolean | null = null;

export async function checkMigration9Applied(forceRefresh = false): Promise<boolean> {
  if (!forceRefresh && cachedMigration9Status !== null) {
    return cachedMigration9Status;
  }
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('materials')
      .select('sync_body,backup_original,body_synced,original_backed_up,original_hash,file_size')
      .limit(0);
    if (!error) {
      cachedMigration9Status = true;
      return true;
    }
    if (isMissingMigration9ColumnError(error)) {
      cachedMigration9Status = false;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

export async function writeMaterialMetadata(
  input: MaterialMetadataInput
): Promise<RepoResult<MaterialRow & { fallbackUsed?: boolean }>> {
  try {
    const supabase = createClient();
    const userId = await getCurrentUserId(supabase);
    if (!userId) return repoError('로그인이 필요합니다.');

    const base = materialBaseUpsert(input.material);
    const existingResult = await supabase
      .from('materials')
      .select('*,last_completed_job_id')
      .eq('id', input.material.id)
      .maybeSingle();
    if (existingResult.error) return repoError(existingResult.error.message);
    const existing = (existingResult.data as MaterialRow | null) ?? null;

    let fallbackUsed = false;
    if (!existing) {
      const payload: Record<string, unknown> = {
        ...base,
        version: 0,
        upload_state: 'ready',
        upload_error: null,
        content_hash: null,
        body_synced: input.bodySynced ?? false,
        original_backed_up: input.originalBackedUp ?? false,
        original_path: null,
        markdown_path: null,
        pages_path: null,
        transcript_path: null,
      };
      let inserted = await supabase
        .from('materials')
        .upsert(payload, { onConflict: 'id,user_id' })
        .select('*')
        .single();
      if (inserted.error && isMissingMigration9ColumnError(inserted.error)) {
        fallbackUsed = true;
        inserted = await supabase
          .from('materials')
          .upsert(stripMigration9Columns(payload), { onConflict: 'id,user_id' })
          .select('*')
          .single();
      }
      if (inserted.error) return repoError(inserted.error.message);
      const row = inserted.data as MaterialRow & { fallbackUsed?: boolean };
      if (fallbackUsed) row.fallbackUsed = true;
      return repoOk(row);
    }

    // Metadata-only update: never touch version, paths or sync state.
    let updated = await supabase
      .from('materials')
      .update(base)
      .eq('id', input.material.id)
      .select('*')
      .single();
    if (updated.error && isMissingMigration9ColumnError(updated.error)) {
      fallbackUsed = true;
      updated = await supabase
        .from('materials')
        .update(stripMigration9Columns(base as unknown as Record<string, unknown>))
        .eq('id', input.material.id)
        .select('*')
        .single();
    }
    if (updated.error) return repoError(updated.error.message);
    const row = updated.data as MaterialRow & { fallbackUsed?: boolean };
    if (fallbackUsed) row.fallbackUsed = true;
    return repoOk(row);
  } catch (error) {
    return repoError(toMessage(error, '자료 메타데이터를 저장하지 못했습니다.'));
  }
}

export interface MaterialWriteResult {
  row: MaterialRow;
  version: number;
  jobId: string;
  fallbackUsed?: boolean;
}

/**
 * Creates or updates a material using the local id as the idempotency key.
 *
 * Ownership + versioning:
 *  - Each call owns a unique job id; Storage paths include the job id, so two
 *    jobs never write the same object.
 *  - `pending_*` holds the in-progress upload; the active version is untouched
 *    until the switch.
 *  - A caller-provided job id is a retry of THAT job only. An unrelated pending
 *    job is never adopted.
 *  - The switch verifies user + material + job id + base version, so a late job
 *    cannot overwrite a newer successful one. A losing/failed job cleans up only
 *    its own objects (never the active ones).
 *  - `version = 0` means "no active version yet"; the first successful upload
 *    activates version 1.
 */
export async function writeMaterial(input: MaterialWriteInput): Promise<RepoResult<MaterialWriteResult>> {
  try {
    const supabase = createClient();
    const userId = await getCurrentUserId(supabase);
    if (!userId) return repoError('로그인이 필요합니다.');

    const { material, content } = input;
    const kind = material.kind as MaterialKind;
    const policy = input.policy ?? LEGACY_WRITE_POLICY;
    const syncBody = policy.syncBody;
    const backupOriginal = policy.backupOriginal;

    const existingResult = await supabase
      .from('materials')
      .select('*')
      .eq('id', material.id)
      .maybeSingle();
    if (existingResult.error) return repoError(existingResult.error.message);
    const existing = (existingResult.data as MaterialRow | null) ?? null;
    const activeVersion = existing?.version ?? 0;

    // Optimistic concurrency on the checked base: if the caller confirmed this
    // base version just before the attempt, refuse (without any side effect)
    // when the row has moved since. A refreshed "latest" must never be adopted
    // as the new base to bypass a conflict.
    if (input.expectedVersion !== undefined && activeVersion !== input.expectedVersion) {
      return repoError(
        `MATERIAL_VERSION_STALE: 서버 자료가 먼저 변경되었습니다(기대 v${input.expectedVersion}, 현재 v${activeVersion}). 덮어쓰지 않았습니다.`
      );
    }

    // A provided job id is only a retry when it matches the current pending job.
    const sameJobRetry = Boolean(
      input.jobId &&
        existing?.pending_job_id === input.jobId &&
        existing.pending_version &&
        existing.pending_version > activeVersion
    );
    const jobId = input.jobId ?? generateJobId();
    const version = sameJobRetry ? (existing!.pending_version as number) : activeVersion + 1;

    const paths = materialObjectPaths(userId, material.id, jobId, kind);
    const contentHash = materialContentHash(content);
    // Only upload what the policy allows; anything not selected is never sent.
    const pagesProvided = syncBody && content.pages !== undefined;
    const shouldUploadOriginal = Boolean(input.original) && backupOriginal;
    // Never lose an existing original when it is not being replaced/disabled.
    const pendingOriginalPath = input.original
      ? (backupOriginal ? paths.original : existing?.original_path ?? existing?.pending_original_path ?? null)
      : existing?.original_path ?? existing?.pending_original_path ?? null;

    // A completed-job identity is required to recover response-loss retries.
    // Check the migration before claiming a pending slot or uploading any file.
    const jobIdentitySchema = await supabase
      .from('materials')
      .select('last_completed_job_id')
      .eq('id', material.id)
      .limit(1);
    if (jobIdentitySchema.error) {
      return repoError('서버 자료 작업 ID 검증을 사용할 수 없습니다. 데이터베이스 migration 적용 상태를 확인해 주세요.');
    }

    const pending = {
      pending_job_id: jobId,
      pending_version: version,
      pending_upload_state: 'uploading' as const,
      pending_upload_error: null,
      pending_content_hash: null,
      pending_original_path: pendingOriginalPath,
      pending_markdown_path: syncBody ? paths.markdown : null,
      pending_pages_path: pagesProvided ? paths.pages : null,
      pending_transcript_path: syncBody && content.rawText ? paths.transcript : null,
    };

    let fallbackUsed = false;
    if (!existing) {
      const base = materialBaseUpsert(material);
      const payload: Record<string, unknown> = {
        ...base,
        version: 0,
        upload_state: 'uploading',
        upload_error: null,
        content_hash: null,
        original_path: null,
        markdown_path: null,
        pages_path: null,
        transcript_path: null,
        ...pending,
      };
      let inserted = await supabase
        .from('materials')
        .upsert(payload, { onConflict: 'id,user_id' })
        .select('*')
        .single();
      if (inserted.error && isMissingMigration9ColumnError(inserted.error)) {
        fallbackUsed = true;
        inserted = await supabase
          .from('materials')
          .upsert(stripMigration9Columns(payload), { onConflict: 'id,user_id' })
          .select('*')
          .single();
      }
      if (inserted.error) return repoError(inserted.error.message);
    } else {
      // Claim the pending slot for this job. Last claim wins; the switch below
      // decides the winner atomically.
      const claimed = await supabase
        .from('materials')
        .update(pending)
        .eq('id', material.id)
        .select('*')
        .single();
      if (claimed.error) return repoError(claimed.error.message);
    }

    const fail = async (message: string): Promise<RepoResult<MaterialWriteResult>> => {
      const patch: Record<string, unknown> = {
        pending_upload_state: 'failed',
        pending_upload_error: message,
      };
      if (activeVersion === 0) {
        patch.upload_state = 'failed';
        patch.upload_error = message;
      }
      // Guarded by job id so a late failure cannot change another job's state.
      await supabase
        .from('materials')
        .update(patch)
        .eq('id', material.id)
        .eq('pending_job_id', jobId);
      await cleanupJobObjects(supabase, userId, material.id, jobId);
      return repoError(message);
    };

    if (syncBody) {
      const mdUpload = await uploadText(supabase, paths.markdown, content.markdown ?? '', 'text/markdown');
      if (!mdUpload.ok) return fail(mdUpload.error);
      if (content.rawText) {
        const trUpload = await uploadText(supabase, paths.transcript, content.rawText, 'text/plain');
        if (!trUpload.ok) return fail(trUpload.error);
      }
      if (pagesProvided) {
        // An empty array is stored (not dropped) so read-back and hash agree.
        const pgUpload = await uploadText(
          supabase,
          paths.pages,
          JSON.stringify(content.pages ?? []),
          'application/json'
        );
        if (!pgUpload.ok) return fail(pgUpload.error);
      }

      // Verify bodies by downloading them back and recomputing the hash.
      const verifyRow = {
        ...(existing ?? {}),
        id: material.id,
        markdown_path: paths.markdown,
        pages_path: pagesProvided ? paths.pages : null,
        transcript_path: content.rawText ? paths.transcript : null,
      } as MaterialRow;
      const verify = await downloadMaterialContent(verifyRow);
      if (!verify.ok) return fail(`본문 검증 실패: ${verify.error}`);
      if (materialContentHash(verify.data) !== contentHash) {
        return fail('저장된 본문이 원본과 일치하지 않습니다.');
      }
    }
    if (shouldUploadOriginal) {
      const ogUpload = await uploadBlob(
        supabase,
        paths.original,
        input.original!.blob,
        input.original!.contentType
      );
      if (!ogUpload.ok) return fail(ogUpload.error);
    }

    // Activate only if this job still owns the pending slot AND the active
    // version is still the base version this job started from.
    const switchPayload: Record<string, unknown> = {
      version,
      upload_state: 'ready',
      upload_error: null,
      content_hash: contentHash,
      original_path: pendingOriginalPath,
      // Preserve an existing cloud body when it is not being re-synced.
      markdown_path: syncBody ? paths.markdown : existing?.markdown_path ?? null,
      pages_path: pagesProvided ? paths.pages : existing?.pages_path ?? null,
      transcript_path: syncBody && content.rawText ? paths.transcript : existing?.transcript_path ?? null,
      body_synced: syncBody || Boolean(existing?.markdown_path),
      original_backed_up: Boolean(pendingOriginalPath),
      // Cloud upload completion is separate from conversion status.
      status: material.status,
      is_converted: material.isConverted ?? material.status === 'ready',
      last_edited_at: new Date().toISOString(),
      pending_job_id: null,
      last_completed_job_id: jobId,
      pending_version: null,
      pending_upload_state: null,
      pending_upload_error: null,
      pending_content_hash: null,
      pending_original_path: null,
      pending_markdown_path: null,
      pending_pages_path: null,
      pending_transcript_path: null,
    };
    let switched = await supabase
      .from('materials')
      .update(switchPayload)
      .eq('id', material.id)
      .eq('pending_job_id', jobId)
      .eq('version', activeVersion)
      .select('*')
      .single();
    if (switched.error && isMissingMigration9ColumnError(switched.error)) {
      fallbackUsed = true;
      switched = await supabase
        .from('materials')
        .update(stripMigration9Columns(switchPayload))
        .eq('id', material.id)
        .eq('pending_job_id', jobId)
        .eq('version', activeVersion)
        .select('*')
        .single();
    }
    if (switched.error) {
      // Lost the race to another job: discard only this job's own objects.
      await cleanupJobObjects(supabase, userId, material.id, jobId);
      return repoError('다른 작업이 먼저 완료되어 이번 업로드 결과를 반영하지 않았습니다. 다시 시도해 주세요.');
    }

    const row = switched.data as MaterialRow & { fallbackUsed?: boolean };
    if (fallbackUsed) row.fallbackUsed = true;
    return repoOk({ row, version, jobId, fallbackUsed });
  } catch (error) {
    return repoError(toMessage(error, '자료를 저장하지 못했습니다.'));
  }
}

/** Removes only the objects created by one upload job (never active objects). */
async function cleanupJobObjects(
  supabase: SupabaseClient,
  userId: string,
  materialId: string,
  jobId: string
): Promise<void> {
  const listed = await listAllPaths(supabase, `${userId}/${materialId}/${jobId}`);
  if (!listed.ok || listed.paths.length === 0) return;
  try {
    await supabase.storage.from(MATERIALS_BUCKET).remove(listed.paths);
  } catch {
    // best effort; the failed job's objects are not referenced by the active row
  }
}

/**
 * Deletes a material's Storage objects first, then its DB row.
 *
 * A listing failure or a partial removal is reported and the DB row is kept.
 * If files are gone but the DB delete fails, the row is marked 'deleting' so a
 * retry can finish the job and the material is not shown as a normal ready one.
 */
export async function deleteMaterial(id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const supabase = createClient();
    const userId = await getCurrentUserId(supabase);
    if (!userId) return repoError('로그인이 필요합니다.');

    const listed = await listAllPaths(supabase, `${userId}/${id}`);
    if (!listed.ok) return repoError(`파일 목록 조회 실패: ${listed.error}`);

    if (listed.paths.length > 0) {
      const { error } = await supabase.storage.from(MATERIALS_BUCKET).remove(listed.paths);
      if (error) return repoError(`파일 삭제 실패: ${error.message}`);
      const after = await listAllPaths(supabase, `${userId}/${id}`);
      if (!after.ok) return repoError(`파일 삭제 확인 실패: ${after.error}`);
      if (after.paths.length > 0) {
        return repoError('일부 파일이 삭제되지 않았습니다. 다시 시도해 주세요.');
      }
    }

    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) {
      await supabase
        .from('materials')
        .update({ upload_state: 'deleting', upload_error: `DB 행 삭제 실패: ${error.message}` })
        .eq('id', id);
      return repoError(
        `파일은 삭제됐지만 DB 행 삭제에 실패했습니다. 다시 시도해 주세요. (${error.message})`
      );
    }
    return repoOk({ id });
  } catch (error) {
    return repoError(toMessage(error, '자료를 삭제하지 못했습니다.'));
  }
}

/** Short-lived signed URL for private original viewing / download. */
export async function createMaterialSignedUrl(
  path: string,
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<RepoResult<string>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return repoError(error?.message ?? '보기 링크를 만들지 못했습니다.');
    return repoOk(data.signedUrl);
  } catch (error) {
    return repoError(toMessage(error, '보기 링크를 만들지 못했습니다.'));
  }
}
