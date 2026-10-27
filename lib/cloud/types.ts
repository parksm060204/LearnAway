import type { Material, MaterialPage, Subject } from '../types';

/** Row shape of `public.subjects`. */
export interface SubjectRow {
  id: string;
  user_id: string;
  name: string;
  code: string;
  semester: string | null;
  exam_at: string | null;
  exam_end_time: string | null;
  location: string | null;
  timezone: string;
  scope: string | null;
  chapters: string[] | null;
  domain: string | null;
  engine_name: string | null;
  last_evaluated_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

/** Payloads omit user_id: the DB default (auth.uid()) and RLS own it. */
export type SubjectUpsert = Omit<SubjectRow, 'user_id' | 'created_at' | 'updated_at'>;

export type MaterialUploadState = 'uploading' | 'ready' | 'failed' | 'deleting';

/** Row shape of `public.materials`. Heavy content lives in Storage. */
export interface MaterialRow {
  id: string;
  user_id: string;
  subject_id: string;
  kind: string;
  title: string;
  source_refs: string;
  status: string;
  status_message: string | null;
  is_converted: boolean;
  upload_state: MaterialUploadState;
  upload_error: string | null;
  version: number;
  /** Last job that switched a pending material version into the active row. */
  last_completed_job_id?: string | null;
  content_hash: string | null;
  // Storage policy + actual sync state (see migration 9).
  sync_body: boolean;
  backup_original: boolean;
  body_synced: boolean;
  original_backed_up: boolean;
  original_hash: string | null;
  file_size: number | null;
  original_path: string | null;
  markdown_path: string | null;
  pages_path: string | null;
  transcript_path: string | null;
  page_count: number | null;
  duration_minutes: number | null;
  speaker_count: number | null;
  speakers: string[] | null;
  has_ai_concepts: boolean;
  has_ai_problems: boolean;
  is_demo: boolean;
  uploaded_at: string;
  last_edited_at: string | null;
  // In-progress upload (separate from the active version).
  pending_job_id: string | null;
  pending_version: number | null;
  pending_upload_state: MaterialUploadState | null;
  pending_upload_error: string | null;
  pending_content_hash: string | null;
  pending_original_path: string | null;
  pending_markdown_path: string | null;
  pending_pages_path: string | null;
  pending_transcript_path: string | null;
  created_at: string;
  updated_at: string;
}

export type MaterialUpsert = Omit<MaterialRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface CloudMaterialContent {
  markdown: string;
  rawText?: string;
  pages?: MaterialPage[];
}

export interface CloudLibrary {
  subjects: Subject[];
  materials: Material[];
  /** materialId -> Storage path of the current original (if any). */
  originalPathByMaterialId: Record<string, string>;
}

export type RepoResult<T> = { ok: true; data: T; count?: number | null } | { ok: false; error: string };

export function repoError<T = never>(error: string): RepoResult<T> {
  return { ok: false, error };
}

export function repoOk<T>(data: T, count?: number | null): RepoResult<T> {
  return count !== undefined ? { ok: true, data, count } : { ok: true, data };
}

/** Range pagination parameters for PostgREST queries. */
export interface ListPage {
  from: number;
  to: number;
}

export const CLOUD_PAGE_SIZE = 1000;
export const CLOUD_MAX_PAGES = 100; // supports up to 100,000 items

/**
 * Robust paginated collector that retrieves every page from the server.
 * - Dynamically advances offset by the actual number of received rows rather than requested pageSize,
 *   preventing premature completion when server max-rows or reverse proxies clamp page size.
 * - Terminates when the server returns 0 rows (empty page) or when total count (if provided) is reached.
 * - Deduplicates rows by `id` so concurrent inserts shifting offsets never double-count.
 * - Aborts with error if any intermediate page fails; NEVER treats partial reads as complete.
 * - Explicitly returns error if the safety limit (maxPages) is exceeded with remaining records.
 */
export async function fetchAllPages<T extends { id: string }>(
  fetchPage: (page: ListPage) => Promise<RepoResult<T[]>>,
  pageSize = CLOUD_PAGE_SIZE,
  maxPages = CLOUD_MAX_PAGES
): Promise<RepoResult<T[]>> {
  const seen = new Set<string>();
  const all: T[] = [];
  let currentFrom = 0;
  let serverBatchSize: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const from = currentFrom;
    const to = from + pageSize - 1;
    const result = await fetchPage({ from, to });
    if (!result.ok) {
      return result;
    }

    const receivedCount = result.data.length;
    if (receivedCount === 0) {
      return repoOk(all, result.count);
    }

    for (const row of result.data) {
      if (row.id && seen.has(row.id)) continue;
      if (row.id) seen.add(row.id);
      all.push(row);
    }

    // If server provided total count and we've gathered all records, terminate early
    if (result.count != null && typeof result.count === 'number' && result.count >= 0) {
      if (all.length >= result.count || currentFrom + receivedCount >= result.count) {
        return repoOk(all, result.count);
      }
    }

    // If the server returns fewer items than the observed server batch size,
    // this is the final short page and we can complete without an unnecessary extra round-trip.
    if (serverBatchSize !== null && receivedCount < serverBatchSize) {
      return repoOk(all, result.count);
    }

    if (serverBatchSize === null) {
      serverBatchSize = receivedCount;
    } else {
      serverBatchSize = Math.max(serverBatchSize, receivedCount);
    }

    currentFrom += receivedCount;

    if (page === maxPages - 1) {
      return repoError(`데이터가 최대 페이지 한도(${maxPages}회 요청)를 초과하여 전체 목록을 수집할 수 없습니다.`);
    }
  }

  return repoOk(all);
}
