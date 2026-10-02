import type { SupabaseClient } from '@supabase/supabase-js';
import type { Concept, ConceptDraft, Problem, ProblemDraft, ProblemVersionSnapshot } from '../types';
import {
  conceptToUpsert,
  conceptDraftToUpsert,
  problemToUpsert,
  problemDraftToUpsert,
  rowToConcept,
  rowToConceptDraft,
  rowToProblem,
  rowToProblemDraft,
} from './learningMappers';
import type {
  ConceptDraftRow,
  ConceptRow,
  ProblemDraftRow,
  ProblemRow,
  ProblemVersionRow,
} from './learningTypes';
import type { RepoResult } from './types';
import { repoError, repoOk } from './types';

function message(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listConcepts(supabase: SupabaseClient): Promise<RepoResult<Concept[]>> {
  try {
    const { data, error } = await supabase
      .from('concepts')
      .select('*')
      .order('order_index', { ascending: true });
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptRow[]) ?? []).map(rowToConcept));
  } catch (error) {
    return repoError(message(error, '개념을 불러오지 못했습니다.'));
  }
}

export async function listConceptDrafts(supabase: SupabaseClient): Promise<RepoResult<ConceptDraft[]>> {
  try {
    const { data, error } = await supabase
      .from('concept_drafts')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptDraftRow[]) ?? []).map(rowToConceptDraft));
  } catch (error) {
    return repoError(message(error, '개념 초안을 불러오지 못했습니다.'));
  }
}

export async function listProblems(supabase: SupabaseClient): Promise<RepoResult<Problem[]>> {
  try {
    const { data, error } = await supabase
      .from('problems')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemRow[]) ?? []).map(rowToProblem));
  } catch (error) {
    return repoError(message(error, '문제를 불러오지 못했습니다.'));
  }
}

export async function listProblemDrafts(supabase: SupabaseClient): Promise<RepoResult<ProblemDraft[]>> {
  try {
    const { data, error } = await supabase
      .from('problem_drafts')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemDraftRow[]) ?? []).map(rowToProblemDraft));
  } catch (error) {
    return repoError(message(error, '문제 초안을 불러오지 못했습니다.'));
  }
}

export async function listProblemVersions(
  supabase: SupabaseClient,
  problemId: string
): Promise<RepoResult<ProblemVersionSnapshot[]>> {
  try {
    const { data, error } = await supabase
      .from('problem_versions')
      .select('*')
      .eq('problem_id', problemId)
      .order('version', { ascending: true });
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemVersionRow[]) ?? []).map((r) => r.snapshot as unknown as ProblemVersionSnapshot));
  } catch (error) {
    return repoError(message(error, '문제 버전 이력을 불러오지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Draft writes (idempotent by draft id; job id recorded for AI generation)
// ---------------------------------------------------------------------------

export async function upsertConceptDrafts(
  supabase: SupabaseClient,
  drafts: ConceptDraft[],
  jobId?: string
): Promise<RepoResult<ConceptDraft[]>> {
  try {
    if (drafts.length === 0) return repoOk([]);
    const rows = drafts.map((draft) => ({ ...conceptDraftToUpsert(draft), generation_job_id: jobId ?? null }));
    const { data, error } = await supabase
      .from('concept_drafts')
      .upsert(rows, { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptDraftRow[]) ?? []).map(rowToConceptDraft));
  } catch (error) {
    return repoError(message(error, '개념 초안을 저장하지 못했습니다.'));
  }
}

export async function upsertProblemDrafts(
  supabase: SupabaseClient,
  drafts: ProblemDraft[],
  jobId?: string
): Promise<RepoResult<ProblemDraft[]>> {
  try {
    if (drafts.length === 0) return repoOk([]);
    const rows = drafts.map((draft) => ({ ...problemDraftToUpsert(draft), generation_job_id: jobId ?? null }));
    const { data, error } = await supabase
      .from('problem_drafts')
      .upsert(rows, { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemDraftRow[]) ?? []).map(rowToProblemDraft));
  } catch (error) {
    return repoError(message(error, '문제 초안을 저장하지 못했습니다.'));
  }
}

/** Saves an edited draft and bumps its content_version (optimistic concurrency). */
export async function updateConceptDraft(
  supabase: SupabaseClient,
  draft: ConceptDraft,
  expectedContentVersion: number
): Promise<RepoResult<ConceptDraft>> {
  try {
    const row = { ...conceptDraftToUpsert(draft), content_version: expectedContentVersion + 1, edited_by_user: true } as Record<string, unknown>;
    const { data, error } = await supabase
      .from('concept_drafts')
      .update(row)
      .eq('id', draft.id)
      .eq('content_version', expectedContentVersion)
      .select('*')
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoError('다른 곳에서 초안이 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.');
    return repoOk(rowToConceptDraft(data as ConceptDraftRow));
  } catch (error) {
    return repoError(message(error, '개념 초안을 수정하지 못했습니다.'));
  }
}

export async function updateProblemDraft(
  supabase: SupabaseClient,
  draft: ProblemDraft,
  expectedContentVersion: number
): Promise<RepoResult<ProblemDraft>> {
  try {
    const row = { ...problemDraftToUpsert(draft), content_version: expectedContentVersion + 1, edited_by_user: true } as Record<string, unknown>;
    const { data, error } = await supabase
      .from('problem_drafts')
      .update(row)
      .eq('id', draft.id)
      .eq('content_version', expectedContentVersion)
      .select('*')
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoError('다른 곳에서 초안이 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.');
    return repoOk(rowToProblemDraft(data as ProblemDraftRow));
  } catch (error) {
    return repoError(message(error, '문제 초안을 수정하지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Approval (transactional RPC; idempotent; optimistic-locked)
// ---------------------------------------------------------------------------

export interface ApprovalResult {
  id: string;
  alreadyApproved: boolean;
}

function approvalErrorCode(error: { message?: string; code?: string } | null): string {
  const raw = `${error?.message ?? ''} ${error?.code ?? ''}`;
  if (raw.includes('DRAFT_STALE')) return 'stale';
  if (raw.includes('DRAFT_NOT_FOUND')) return 'missing';
  if (raw.includes('DRAFT_NOT_PENDING')) return 'not_pending';
  if (raw.includes('RUBRIC_NOT_100')) return 'rubric';
  if (raw.includes('DRAFT_INCOMPLETE')) return 'incomplete';
  if (raw.includes('NO_CONCEPT_LINK')) return 'no_concept';
  return 'error';
}

export async function approveConceptDraft(
  supabase: SupabaseClient,
  draft: ConceptDraft,
  concept: Concept,
  expectedUpdatedAt: string | null
): Promise<RepoResult<ApprovalResult>> {
  try {
    const { data, error } = await supabase.rpc('approve_concept_draft', {
      p_draft_id: draft.id,
      p_expected_updated_at: expectedUpdatedAt,
      p_concept: concept as unknown as Record<string, unknown>,
    });
    if (error) return repoError(`${approvalErrorCode(error)}:${error.message}`);
    return repoOk({ id: String(data), alreadyApproved: false });
  } catch (error) {
    return repoError(message(error, '개념 승인에 실패했습니다.'));
  }
}

export async function approveProblemDraft(
  supabase: SupabaseClient,
  draft: ProblemDraft,
  problem: Problem,
  expectedUpdatedAt: string | null
): Promise<RepoResult<ApprovalResult>> {
  try {
    const { data, error } = await supabase.rpc('approve_problem_draft', {
      p_draft_id: draft.id,
      p_expected_updated_at: expectedUpdatedAt,
      p_problem: problem as unknown as Record<string, unknown>,
    });
    if (error) return repoError(`${approvalErrorCode(error)}:${error.message}`);
    return repoOk({ id: String(data), alreadyApproved: false });
  } catch (error) {
    return repoError(message(error, '문제 승인에 실패했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Bulk upserts / deletes (migration + edits)
// ---------------------------------------------------------------------------

export async function upsertConcepts(supabase: SupabaseClient, concepts: Concept[]): Promise<RepoResult<Concept[]>> {
  try {
    if (concepts.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('concepts')
      .upsert(concepts.map(conceptToUpsert), { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptRow[]) ?? []).map(rowToConcept));
  } catch (error) {
    return repoError(message(error, '개념을 저장하지 못했습니다.'));
  }
}

export async function upsertProblems(supabase: SupabaseClient, problems: Problem[]): Promise<RepoResult<Problem[]>> {
  try {
    if (problems.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('problems')
      .upsert(problems.map(problemToUpsert), { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemRow[]) ?? []).map(rowToProblem));
  } catch (error) {
    return repoError(message(error, '문제를 저장하지 못했습니다.'));
  }
}

/** Appends immutable version snapshots for a problem (migration/versioning). */
export async function upsertProblemVersions(
  supabase: SupabaseClient,
  problemId: string,
  subjectId: string,
  snapshots: ProblemVersionSnapshot[]
): Promise<RepoResult<ProblemVersionSnapshot[]>> {
  try {
    if (snapshots.length === 0) return repoOk([]);
    const rows = snapshots.map((snapshot) => ({
      problem_id: problemId,
      subject_id: subjectId,
      version: snapshot.version,
      snapshot: snapshot as unknown as Record<string, unknown>,
    }));
    // Versions are immutable: ON CONFLICT DO NOTHING (insert-only policy).
    const { error } = await supabase
      .from('problem_versions')
      .upsert(rows, { onConflict: 'problem_id,version,user_id', ignoreDuplicates: true });
    if (error) return repoError(error.message);
    return repoOk(snapshots);
  } catch (error) {
    return repoError(message(error, '문제 버전을 저장하지 못했습니다.'));
  }
}

export async function deleteConcept(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('concepts').delete().eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '개념을 삭제하지 못했습니다.'));
  }
}

export async function deleteProblem(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('problems').delete().eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '문제를 삭제하지 못했습니다.'));
  }
}
