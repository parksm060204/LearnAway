'use client';

import { createClient } from '../supabase/client';
import type { Material, MaterialKind } from '../types';
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

function generateJobId(): string {
  try {
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MaterialWriteInput {
  material: Material;
  content: CloudMaterialContent;
  original?: { blob: Blob; contentType: string } | null;
  jobId?: string;
}

export interface MaterialWriteResult {
  row: MaterialRow;
  version: number;
  jobId: string;
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

    const existingResult = await supabase
      .from('materials')
      .select('*')
      .eq('id', material.id)
      .maybeSingle();
    if (existingResult.error) return repoError(existingResult.error.message);
    const existing = (existingResult.data as MaterialRow | null) ?? null;
    const activeVersion = existing?.version ?? 0;

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
    const pagesProvided = content.pages !== undefined;
    // Never lose an existing original when no replacement file is provided.
    const pendingOriginalPath = input.original
      ? paths.original
      : existing?.original_path ?? existing?.pending_original_path ?? null;

    const pending = {
      pending_job_id: jobId,
      pending_version: version,
      pending_upload_state: 'uploading' as const,
      pending_upload_error: null,
      pending_content_hash: null,
      pending_original_path: pendingOriginalPath,
      pending_markdown_path: paths.markdown,
      pending_pages_path: pagesProvided ? paths.pages : null,
      pending_transcript_path: content.rawText ? paths.transcript : null,
    };

    if (!existing) {
      const base = materialBaseUpsert(material);
      const inserted = await supabase
        .from('materials')
        .upsert(
          {
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
          },
          { onConflict: 'id,user_id' }
        )
        .select('*')
        .single();
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
    if (input.original) {
      const ogUpload = await uploadBlob(
        supabase,
        paths.original,
        input.original.blob,
        input.original.contentType
      );
      if (!ogUpload.ok) return fail(ogUpload.error);
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

    // Activate only if this job still owns the pending slot AND the active
    // version is still the base version this job started from.
    const switched = await supabase
      .from('materials')
      .update({
        version,
        upload_state: 'ready',
        upload_error: null,
        content_hash: contentHash,
        original_path: pendingOriginalPath,
        markdown_path: paths.markdown,
        pages_path: pagesProvided ? paths.pages : null,
        transcript_path: content.rawText ? paths.transcript : null,
        // Cloud upload completion is separate from conversion status.
        status: material.status,
        is_converted: material.isConverted ?? material.status === 'ready',
        last_edited_at: new Date().toISOString(),
        pending_job_id: null,
        pending_version: null,
        pending_upload_state: null,
        pending_upload_error: null,
        pending_content_hash: null,
        pending_original_path: null,
        pending_markdown_path: null,
        pending_pages_path: null,
        pending_transcript_path: null,
      })
      .eq('id', material.id)
      .eq('pending_job_id', jobId)
      .eq('version', activeVersion)
      .select('*')
      .single();
    if (switched.error) {
      // Lost the race to another job: discard only this job's own objects.
      await cleanupJobObjects(supabase, userId, material.id, jobId);
      return repoError('다른 작업이 먼저 완료되어 이번 업로드 결과를 반영하지 않았습니다. 다시 시도해 주세요.');
    }

    return repoOk({ row: switched.data as MaterialRow, version, jobId });
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
