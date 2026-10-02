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

async function listAllPaths(supabase: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      paths.push(...(await listAllPaths(supabase, full)));
    } else {
      paths.push(full);
    }
  }
  return paths;
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
}

export interface MaterialWriteResult {
  row: MaterialRow;
  version: number;
}

/**
 * Creates or updates a material using the local id as the idempotency key.
 *
 * Sequence (not transactional — a DB row + Storage objects):
 *  1. write metadata with upload_state='uploading'
 *  2. upload original + bodies to deterministic versioned paths
 *  3. download bodies back and verify their content hash
 *  4. switch the row to upload_state='ready'
 * A failed attempt leaves upload_state='failed' and reuses the same version, so
 * a retry overwrites the same paths instead of creating duplicates. Editing an
 * already-ready material writes a NEW version, then switches the pointer.
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
      .select('id, version, upload_state')
      .eq('id', material.id)
      .maybeSingle();
    if (existingResult.error) return repoError(existingResult.error.message);
    const existing = existingResult.data as { version: number; upload_state: string } | null;

    const version =
      existing && existing.upload_state === 'ready' ? existing.version + 1 : existing?.version ?? 1;
    const paths = materialObjectPaths(userId, material.id, version, kind);
    const contentHash = materialContentHash(content);

    const base = materialBaseUpsert(material);
    const uploadingRow = {
      ...base,
      version,
      upload_state: 'uploading' as const,
      upload_error: null,
      content_hash: null,
      original_path: paths.original,
      markdown_path: paths.markdown,
      pages_path: content.pages && content.pages.length > 0 ? paths.pages : null,
      transcript_path: content.rawText ? paths.transcript : null,
    };

    const upserted = await supabase
      .from('materials')
      .upsert(uploadingRow, { onConflict: 'id' })
      .select('*')
      .single();
    if (upserted.error) return repoError(upserted.error.message);

    const fail = async (message: string): Promise<RepoResult<MaterialWriteResult>> => {
      await supabase
        .from('materials')
        .update({ upload_state: 'failed', upload_error: message })
        .eq('id', material.id);
      return repoError(message);
    };

    // Upload bodies first, then the original (so a failed body never looks ready).
    const mdUpload = await uploadText(supabase, paths.markdown, content.markdown ?? '', 'text/markdown');
    if (!mdUpload.ok) return fail(mdUpload.error);

    if (content.rawText) {
      const trUpload = await uploadText(supabase, paths.transcript, content.rawText, 'text/plain');
      if (!trUpload.ok) return fail(trUpload.error);
    }
    if (content.pages && content.pages.length > 0) {
      const pgUpload = await uploadText(
        supabase,
        paths.pages,
        JSON.stringify(content.pages),
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
    const verify = await downloadMaterialContent({
      ...(upserted.data as MaterialRow),
      markdown_path: paths.markdown,
      pages_path: content.pages && content.pages.length > 0 ? paths.pages : null,
      transcript_path: content.rawText ? paths.transcript : null,
    });
    if (!verify.ok) return fail(`본문 검증 실패: ${verify.error}`);
    const verifiedHash = materialContentHash(verify.data);
    if (verifiedHash !== contentHash) {
      return fail('저장된 본문이 원본과 일치하지 않습니다.');
    }

    const ready = await supabase
      .from('materials')
      .update({
        upload_state: 'ready',
        upload_error: null,
        content_hash: contentHash,
        version,
        original_path: input.original ? paths.original : null,
        markdown_path: paths.markdown,
        pages_path: content.pages && content.pages.length > 0 ? paths.pages : null,
        transcript_path: content.rawText ? paths.transcript : null,
        is_converted: true,
        status: 'ready',
        last_edited_at: new Date().toISOString(),
      })
      .eq('id', material.id)
      .select('*')
      .single();
    if (ready.error) return fail(ready.error.message);

    return repoOk({ row: ready.data as MaterialRow, version });
  } catch (error) {
    return repoError(toMessage(error, '자료를 저장하지 못했습니다.'));
  }
}

/**
 * Deletes a material's Storage objects first, then its DB row. A Storage
 * failure is reported and the row is kept so deletion is never falsely
 * reported as successful.
 */
export async function deleteMaterial(id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const supabase = createClient();
    const userId = await getCurrentUserId(supabase);
    if (!userId) return repoError('로그인이 필요합니다.');

    const paths = await listAllPaths(supabase, `${userId}/${id}`);
    if (paths.length > 0) {
      const { error } = await supabase.storage.from(MATERIALS_BUCKET).remove(paths);
      if (error) return repoError(`파일 삭제 실패: ${error.message}`);
    }

    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) return repoError(error.message);
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
