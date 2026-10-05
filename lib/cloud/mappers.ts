import type {
  Material,
  MaterialConversionStatus,
  MaterialKind,
  Subject,
  Timezone,
} from '../types';
import type { CloudMaterialContent, MaterialRow, MaterialUpsert, SubjectRow, SubjectUpsert } from './types';

const DEFAULT_TIMEZONE: Timezone = 'Asia/Seoul';

export function rowToSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    ownerId: row.user_id,
    name: row.name,
    code: row.code ?? '',
    semester: row.semester ?? undefined,
    examAt: row.exam_at ?? undefined,
    examEndTime: row.exam_end_time ?? undefined,
    location: row.location ?? undefined,
    timezone: (row.timezone as Timezone) || DEFAULT_TIMEZONE,
    scope: row.scope ?? undefined,
    chapters: row.chapters ?? undefined,
    lastEvaluatedAt: row.last_evaluated_at ?? undefined,
    engineName: row.engine_name ?? undefined,
    domain: (row.domain as Subject['domain']) ?? undefined,
    isDemo: row.is_demo,
  };
}

/** Payload for insert/upsert. user_id is intentionally omitted (DB + RLS own it). */
export function subjectToUpsert(subject: Subject): SubjectUpsert {
  return {
    id: subject.id,
    name: subject.name,
    code: subject.code ?? '',
    semester: subject.semester ?? null,
    exam_at: subject.examAt ?? null,
    exam_end_time: subject.examEndTime ?? null,
    location: subject.location ?? null,
    timezone: subject.timezone ?? DEFAULT_TIMEZONE,
    scope: subject.scope ?? null,
    chapters: subject.chapters ?? [],
    domain: subject.domain ?? null,
    engine_name: subject.engineName ?? null,
    last_evaluated_at: subject.lastEvaluatedAt ?? null,
    is_demo: subject.isDemo ?? false,
  };
}

/** App-level material metadata (no Storage paths / version / upload state). */
export function materialBaseUpsert(
  material: Material
): Pick<
  MaterialUpsert,
  | 'id'
  | 'subject_id'
  | 'kind'
  | 'title'
  | 'source_refs'
  | 'status'
  | 'status_message'
  | 'is_converted'
  | 'page_count'
  | 'duration_minutes'
  | 'speaker_count'
  | 'speakers'
  | 'has_ai_concepts'
  | 'has_ai_problems'
  | 'is_demo'
  | 'uploaded_at'
  | 'last_edited_at'
  | 'sync_body'
  | 'backup_original'
  | 'original_hash'
  | 'file_size'
> {
  return {
    id: material.id,
    subject_id: material.subjectId,
    kind: material.kind,
    title: material.title,
    source_refs: material.sourceRefs ?? '',
    status: material.status,
    status_message: material.statusMessage ?? null,
    is_converted: material.isConverted ?? material.status === 'ready',
    page_count: material.pageCount ?? null,
    duration_minutes: material.durationMinutes ?? null,
    speaker_count: material.speakerCount ?? null,
    speakers: material.speakers ?? [],
    has_ai_concepts: material.hasAiConcepts ?? false,
    has_ai_problems: material.hasAiProblems ?? false,
    is_demo: material.isDemo ?? false,
    uploaded_at: material.uploadedAt,
    last_edited_at: material.lastEditedAt ?? null,
    // Legacy materials (no explicit policy) keep the previous behaviour.
    sync_body: material.storagePolicy?.syncBody ?? true,
    backup_original: material.storagePolicy?.backupOriginal ?? true,
    original_hash: material.originalHash ?? null,
    file_size: material.fileSize ?? null,
  };
}

export function rowToMaterial(row: MaterialRow, content?: CloudMaterialContent): Material {
  return {
    id: row.id,
    subjectId: row.subject_id,
    kind: row.kind as MaterialKind,
    title: row.title,
    sourceRefs: row.source_refs ?? '',
    pageCount: row.page_count ?? undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    parsedMarkdown: content?.markdown,
    rawText: content?.rawText,
    pages: content?.pages,
    status: row.status as MaterialConversionStatus,
    statusMessage: row.status_message ?? undefined,
    isConverted: row.is_converted,
    isDemo: row.is_demo,
    uploadedAt: row.uploaded_at,
    lastEditedAt: row.last_edited_at ?? undefined,
    speakerCount: row.speaker_count ?? undefined,
    speakers: row.speakers ?? undefined,
    hasAiConcepts: row.has_ai_concepts,
    hasAiProblems: row.has_ai_problems,
    storagePolicy: {
      syncBody: row.sync_body ?? true,
      backupOriginal: row.backup_original ?? true,
    },
    originalHash: row.original_hash ?? undefined,
    fileSize: row.file_size ?? undefined,
  };
}

/**
 * Job-scoped Storage paths: <uid>/<materialId>/<jobId>/<file>.
 *
 * Each upload job owns its own folder, so two concurrent jobs (or a late
 * retry) can never write over each other's objects. The active row points at
 * the winning job's paths; the DB stores the version number separately.
 */
export function materialObjectPaths(
  userId: string,
  materialId: string,
  jobId: string,
  kind: MaterialKind
) {
  const base = `${userId}/${materialId}/${jobId}`;
  const originalExt = kind === 'pdf' ? 'pdf' : 'txt';
  return {
    base,
    original: `${base}/original.${originalExt}`,
    transcript: `${base}/transcript.txt`,
    markdown: `${base}/markdown.md`,
    pages: `${base}/pages.json`,
  };
}
