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

export type MaterialUploadState = 'uploading' | 'ready' | 'failed';

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
  content_hash: string | null;
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

export type RepoResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function repoError<T = never>(error: string): RepoResult<T> {
  return { ok: false, error };
}

export function repoOk<T>(data: T): RepoResult<T> {
  return { ok: true, data };
}
