import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Concept,
  ConceptDraft,
  Problem,
  ProblemDraft,
  ProblemQualityStatus,
  ProblemReport,
  ProblemSourceRef,
  ProblemVersionSnapshot,
  SourceVerificationStatus,
} from '../types';
import {
  conceptDraftContentUpsert,
  conceptDraftToUpsert,
  conceptToUpsert,
  problemDraftContentUpsert,
  problemDraftToUpsert,
  problemToUpsert,
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
import type { ListPage, RepoResult } from './types';
import { fetchAllPages, repoError, repoOk } from './types';
import {
  isCompleteProblemSnapshot,
  snapshotEvaluationMatchesProblem,
} from '../problemComparison';

export {
  isCompleteProblemSnapshot,
  snapshotEvaluationMatchesProblem,
} from '../problemComparison';

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

export async function listConcepts(
  supabase: SupabaseClient,
  page?: ListPage
): Promise<RepoResult<Concept[]>> {
  if (!page) {
    return fetchAllPages((p) => listConcepts(supabase, p));
  }
  try {
    const { data, error } = await supabase
      .from('concepts')
      .select('*')
      .order('order_index', { ascending: true })
      .order('id', { ascending: true })
      .range(page.from, page.to);
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptRow[]) ?? []).map(rowToConcept));
  } catch (error) {
    return repoError(message(error, '개념을 불러오지 못했습니다.'));
  }
}

export async function listConceptDrafts(
  supabase: SupabaseClient,
  page?: ListPage
): Promise<RepoResult<ConceptDraft[]>> {
  if (!page) {
    return fetchAllPages((p) => listConceptDrafts(supabase, p));
  }
  try {
    const { data, error } = await supabase
      .from('concept_drafts')
      .select('*')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to);
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptDraftRow[]) ?? []).map(rowToConceptDraft));
  } catch (error) {
    return repoError(message(error, '개념 초안을 불러오지 못했습니다.'));
  }
}

export async function listProblems(
  supabase: SupabaseClient,
  page?: ListPage
): Promise<RepoResult<Problem[]>> {
  if (!page) {
    return fetchAllPages((p) => listProblems(supabase, p));
  }
  try {
    const { data, error } = await supabase
      .from('problems')
      .select('*')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to);
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemRow[]) ?? []).map(rowToProblem));
  } catch (error) {
    return repoError(message(error, '문제를 불러오지 못했습니다.'));
  }
}

export async function listProblemDrafts(
  supabase: SupabaseClient,
  page?: ListPage
): Promise<RepoResult<ProblemDraft[]>> {
  if (!page) {
    return fetchAllPages((p) => listProblemDrafts(supabase, p));
  }
  try {
    const { data, error } = await supabase
      .from('problem_drafts')
      .select('*')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page.from, page.to);
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
// Draft writes
// ---------------------------------------------------------------------------

/** Content-only upsert for AI generation / persistence retries.
 *  CRITICAL: If a draft has been edited by the user (edited_by_user = true)
 *  or already approved/rejected, the user's title, description, and definition
 *  are STRICTLY PRESERVED and never overwritten by subsequent AI generation runs. */
export async function upsertConceptDrafts(
  supabase: SupabaseClient,
  drafts: ConceptDraft[],
  jobId?: string
): Promise<RepoResult<ConceptDraft[]>> {
  try {
    if (drafts.length === 0) return repoOk([]);
    const ids = drafts.map((d) => d.id);
    const { data: existingRows, error: fetchErr } = await supabase
      .from('concept_drafts')
      .select('*')
      .in('id', ids);

    if (fetchErr) return repoError(fetchErr.message);

    const existingMap = new Map<string, ConceptDraftRow>(
      ((existingRows as ConceptDraftRow[]) ?? []).map((r) => [r.id, r])
    );

    const rowsToUpsert: ReturnType<typeof conceptDraftContentUpsert>[] = [];
    const preservedDrafts: ConceptDraft[] = [];

    for (const draft of drafts) {
      const existing = existingMap.get(draft.id);
      if (existing) {
        const payload = (existing.payload || {}) as Record<string, unknown>;
        const isUserEdited = existing.edited_by_user || payload.editedByUser;
        const isApprovedOrRejected =
          existing.is_approved ||
          existing.status === 'approved' ||
          existing.status === 'rejected';

        // Persist needs_source_review to server concept_drafts if requested,
        // while strictly preserving user edits, approved state, content_version,
        // and protecting drafts already generated or re-verified against a newer source.
        if (draft.needsSourceReview === true) {
          const existingSourceHash = (payload.sourceMarkdownHash as string) || '';
          const isSameOrUnsetVersion =
            !draft.sourceMarkdownHash ||
            !existingSourceHash ||
            existingSourceHash === draft.sourceMarkdownHash;

          if (isSameOrUnsetVersion && !existing.needs_source_review) {
            const updatedPayload = {
              ...payload,
              needsSourceReview: true,
              ...(payload.sourceEvidence
                ? {
                    sourceEvidence: {
                      ...(payload.sourceEvidence as Record<string, unknown>),
                      verified: false,
                      verificationNote: '근거 자료 본문이 수정되어 재검토가 필요합니다.',
                    },
                  }
                : {}),
            };

            const { error: updateErr } = await supabase
              .from('concept_drafts')
              .update({
                needs_source_review: true,
                payload: updatedPayload,
              })
              .eq('id', draft.id);

            if (updateErr) return repoError(updateErr.message);
            existing.needs_source_review = true;
            existing.payload = updatedPayload;
          }
        }

        if (isUserEdited || isApprovedOrRejected) {
          // Strictly preserve user edits and approved state!
          const preserved = rowToConceptDraft(existing);
          if (
            draft.sourceEvidence &&
            (!preserved.sourceEvidence || preserved.sourceEvidence.quote !== draft.sourceEvidence.quote)
          ) {
            const existingAddl = Array.isArray(preserved.additionalEvidences)
              ? preserved.additionalEvidences
              : [];
            const alreadyPresent = existingAddl.some(
              (e) => e.quote === draft.sourceEvidence?.quote
            );
            if (!alreadyPresent) {
              preserved.additionalEvidences = [...existingAddl, draft.sourceEvidence];
            }
          }
          preservedDrafts.push(preserved);
          continue;
        }

        // Unedited draft from same or prior job: retain server content version
        preservedDrafts.push(rowToConceptDraft(existing));
        continue;
      }

      // Brand new draft: insert without overwriting on conflict
      rowsToUpsert.push(conceptDraftContentUpsert(draft, jobId ?? null));
    }

    if (rowsToUpsert.length > 0) {
      const { error } = await supabase
        .from('concept_drafts')
        .upsert(rowsToUpsert, { onConflict: 'id,user_id', ignoreDuplicates: true });
      if (error) return repoError(error.message);
    }

    // Authoritative re-query of all requested drafts to guarantee that any concurrent
    // user edits, approvals, or existing server state are fully preserved without overwrite.
    const { data: finalRows, error: finalErr } = await supabase
      .from('concept_drafts')
      .select('*')
      .in('id', ids);

    if (finalErr) return repoError(finalErr.message);

    const finalMap = new Map<string, ConceptDraftRow>(
      ((finalRows as ConceptDraftRow[]) ?? []).map((r) => [r.id, r])
    );

    const orderedResults = drafts
      .map((d) => {
        const row = finalMap.get(d.id);
        return row ? rowToConceptDraft(row) : undefined;
      })
      .filter((d): d is ConceptDraft => Boolean(d));

    return repoOk(orderedResults);
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
    const ids = drafts.map((d) => d.id);
    const { data: existingRows, error: fetchErr } = await supabase
      .from('problem_drafts')
      .select('*')
      .in('id', ids);

    if (fetchErr) return repoError(fetchErr.message);

    const existingMap = new Map<string, ProblemDraftRow>(
      ((existingRows as ProblemDraftRow[]) ?? []).map((r) => [r.id, r])
    );

    const rowsToUpsert: ReturnType<typeof problemDraftContentUpsert>[] = [];

    for (const draft of drafts) {
      const existing = existingMap.get(draft.id);
      if (existing) {
        continue;
      }

      rowsToUpsert.push(problemDraftContentUpsert(draft, jobId ?? null));
    }

    if (rowsToUpsert.length > 0) {
      const { error } = await supabase
        .from('problem_drafts')
        .upsert(rowsToUpsert, { onConflict: 'id,user_id', ignoreDuplicates: true });
      if (error) return repoError(error.message);
    }

    const { data: finalRows, error: finalErr } = await supabase
      .from('problem_drafts')
      .select('*')
      .in('id', ids);

    if (finalErr) return repoError(finalErr.message);

    const finalMap = new Map<string, ProblemDraftRow>(
      ((finalRows as ProblemDraftRow[]) ?? []).map((r) => [r.id, r])
    );

    const orderedResults = drafts
      .map((d) => {
        const row = finalMap.get(d.id);
        return row ? rowToProblemDraft(row) : undefined;
      })
      .filter((d): d is ProblemDraft => Boolean(d));

    return repoOk(orderedResults);
  } catch (error) {
    return repoError(message(error, '문제 초안을 저장하지 못했습니다.'));
  }
}

/** Full draft upsert used by migration (explicitly sets approval columns). */
export async function upsertConceptDraftsFull(
  supabase: SupabaseClient,
  drafts: ConceptDraft[],
  jobId?: string
): Promise<RepoResult<ConceptDraft[]>> {
  try {
    if (drafts.length === 0) return repoOk([]);
    const rows = drafts.map((draft) => ({ ...conceptDraftToUpsert(draft), generation_job_id: jobId ?? null }));
    const { data, error } = await supabase.from('concept_drafts').upsert(rows, { onConflict: 'id,user_id' }).select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ConceptDraftRow[]) ?? []).map(rowToConceptDraft));
  } catch (error) {
    return repoError(message(error, '개념 초안을 저장하지 못했습니다.'));
  }
}

export async function upsertProblemDraftsFull(
  supabase: SupabaseClient,
  drafts: ProblemDraft[],
  jobId?: string
): Promise<RepoResult<ProblemDraft[]>> {
  try {
    if (drafts.length === 0) return repoOk([]);
    const rows = drafts.map((draft) => ({ ...problemDraftToUpsert(draft), generation_job_id: jobId ?? null }));
    const { data, error } = await supabase.from('problem_drafts').upsert(rows, { onConflict: 'id,user_id' }).select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ProblemDraftRow[]) ?? []).map(rowToProblemDraft));
  } catch (error) {
    return repoError(message(error, '문제 초안을 저장하지 못했습니다.'));
  }
}

/** Saves an edited draft and bumps its content_version (optimistic concurrency).
 *  Approval pointer/state are preserved unless the caller marks it pending. */
export async function updateConceptDraft(
  supabase: SupabaseClient,
  draft: ConceptDraft,
  expectedContentVersion: number
): Promise<RepoResult<ConceptDraft>> {
  try {
    const row = {
      subject_id: draft.subjectId,
      material_id: draft.materialId ?? null,
      title: draft.title,
      status: draft.status ?? 'draft',
      is_approved: draft.isApproved ?? false,
      content_version: expectedContentVersion + 1,
      edited_by_user: true,
      payload: draft as unknown as Record<string, unknown>,
    };
    const { data, error } = await supabase
      .from('concept_drafts')
      .update(row)
      .eq('id', draft.id)
      .eq('content_version', expectedContentVersion)
      .select('*')
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoError('stale: 다른 곳에서 초안이 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.');
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
    const row = {
      subject_id: draft.subjectId,
      title: draft.title,
      type: draft.type,
      status: draft.status ?? 'draft',
      is_approved: draft.isApproved ?? false,
      is_demo: draft.isDemo ?? false,
      content_version: expectedContentVersion + 1,
      edited_by_user: true,
      payload: draft as unknown as Record<string, unknown>,
    };
    const { data, error } = await supabase
      .from('problem_drafts')
      .update(row)
      .eq('id', draft.id)
      .eq('content_version', expectedContentVersion)
      .select('*')
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoError('stale: 다른 곳에서 초안이 먼저 수정되었습니다. 새로고침 후 다시 시도해 주세요.');
    return repoOk(rowToProblemDraft(data as ProblemDraftRow));
  } catch (error) {
    return repoError(message(error, '문제 초안을 수정하지 못했습니다.'));
  }
}

export async function rejectConceptDraft(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('concept_drafts').update({ status: 'rejected', is_approved: false }).eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '개념 초안을 거절하지 못했습니다.'));
  }
}

export async function rejectProblemDraft(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('problem_drafts').update({ status: 'rejected', is_approved: false }).eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '문제 초안을 거절하지 못했습니다.'));
  }
}

export async function deleteConceptDraft(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('concept_drafts').delete().eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '개념 초안을 삭제하지 못했습니다.'));
  }
}

export async function deleteProblemDraft(supabase: SupabaseClient, id: string): Promise<RepoResult<{ id: string }>> {
  try {
    const { error } = await supabase.from('problem_drafts').delete().eq('id', id);
    if (error) return repoError(error.message);
    return repoOk({ id });
  } catch (error) {
    return repoError(message(error, '문제 초안을 삭제하지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Single-entity reads (used to reconcile after approval)
// ---------------------------------------------------------------------------

export async function getConceptDraftById(supabase: SupabaseClient, id: string): Promise<RepoResult<ConceptDraft | null>> {
  try {
    const { data, error } = await supabase.from('concept_drafts').select('*').eq('id', id).maybeSingle();
    if (error) return repoError(error.message);
    return repoOk(data ? rowToConceptDraft(data as ConceptDraftRow) : null);
  } catch (error) {
    return repoError(message(error, '개념 초안을 다시 읽지 못했습니다.'));
  }
}

export async function getProblemDraftById(supabase: SupabaseClient, id: string): Promise<RepoResult<ProblemDraft | null>> {
  try {
    const { data, error } = await supabase.from('problem_drafts').select('*').eq('id', id).maybeSingle();
    if (error) return repoError(error.message);
    return repoOk(data ? rowToProblemDraft(data as ProblemDraftRow) : null);
  } catch (error) {
    return repoError(message(error, '문제 초안을 다시 읽지 못했습니다.'));
  }
}

export async function getConceptById(supabase: SupabaseClient, id: string): Promise<RepoResult<Concept | null>> {
  try {
    const { data, error } = await supabase.from('concepts').select('*').eq('id', id).maybeSingle();
    if (error) return repoError(error.message);
    return repoOk(data ? rowToConcept(data as ConceptRow) : null);
  } catch (error) {
    return repoError(message(error, '개념을 다시 읽지 못했습니다.'));
  }
}

export async function getProblemById(supabase: SupabaseClient, id: string): Promise<RepoResult<Problem | null>> {
  try {
    const { data, error } = await supabase.from('problems').select('*').eq('id', id).maybeSingle();
    if (error) return repoError(error.message);
    return repoOk(data ? rowToProblem(data as ProblemRow) : null);
  } catch (error) {
    return repoError(message(error, '문제를 다시 읽지 못했습니다.'));
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
  if (raw.includes('DRAFT_NOT_FOUND') || raw.includes('PROBLEM_NOT_FOUND') || raw.includes('REPORT_NOT_FOUND')) return 'missing';
  if (raw.includes('DRAFT_NOT_PENDING')) return 'not_pending';
  if (raw.includes('RUBRIC_NOT_100')) return 'rubric';
  if (raw.includes('DRAFT_INCOMPLETE') || raw.includes('PROBLEM_INCOMPLETE') || raw.includes('REPORT_INVALID') || raw.includes('DISMISS_REASON_REQUIRED')) return 'incomplete';
  if (raw.includes('NO_CONCEPT_LINK')) return 'no_concept';
  if (raw.includes('ENTITY_ID_CONFLICT')) return 'id_conflict';
  if (raw.includes('DRAFT_SCOPE_MISMATCH')) return 'scope';
  if (raw.includes('VERSION_CONFLICT')) return 'version_conflict';
  if (
    raw.includes('UNAUTHENTICATED') ||
    raw.includes('FORBIDDEN') ||
    raw.includes('42501') ||
    /permission denied/i.test(raw)
  ) {
    return 'forbidden';
  }
  if (
    raw.includes('42883') ||
    raw.includes('PGRST202') ||
    /could not find the function/i.test(raw) ||
    /not found in schema cache/i.test(raw) ||
    /function .* does not exist/i.test(raw)
  ) {
    return 'not_configured';
  }
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

export interface ProblemQualityPatch {
  qualityStatus?: ProblemQualityStatus | string;
  isOutdated?: boolean;
  needsSourceReview?: boolean;
  expectedVersion?: number;
  expectedUpdatedAt?: string;
  addReport?: ProblemReport;
  dismissReport?: {
    reportId: string;
    resolutionNote: string;
    resolvedAt?: string;
  };
  resolveOpenReports?: boolean;
  resolutionNote?: string;
  reviewNotes?: string;
  lastReviewedAt?: string;
  sourceMaterials?: ProblemSourceRef[];
  sourceContentVersion?: string;
  sourceVerificationStatus?: SourceVerificationStatus;
  sourcePage?: string;
  reports?: ProblemReport[];
  /**
   * @deprecated Full payload writes are forbidden for quality updates.
   * If passed by legacy callers, only allowed quality/review fields are extracted;
   * problem body, answer, rubric, and version are strictly ignored.
   */
  payload?: Record<string, unknown>;
}

/**
 * Extracts only allowed quality/review/source-verification fields from a patch,
 * ensuring problem body, model answer, rubric, hints, conceptIds, and version
 * are never sent or overwritten during quality updates.
 */
export function sanitizeProblemQualityPatch(patch: ProblemQualityPatch): Record<string, unknown> {
  const legacyPayload =
    patch.payload && typeof patch.payload === 'object'
      ? (patch.payload as Record<string, unknown>)
      : undefined;

  const clean: Record<string, unknown> = {};

  const qualityStatus =
    patch.qualityStatus ?? (typeof legacyPayload?.qualityStatus === 'string' ? legacyPayload.qualityStatus : undefined);
  if (qualityStatus !== undefined) clean.qualityStatus = qualityStatus;

  const isOutdated =
    patch.isOutdated ?? (typeof legacyPayload?.isOutdated === 'boolean' ? legacyPayload.isOutdated : undefined);
  if (isOutdated !== undefined) clean.isOutdated = isOutdated;

  const needsSourceReview =
    patch.needsSourceReview ??
    (typeof legacyPayload?.needsSourceReview === 'boolean' ? legacyPayload.needsSourceReview : undefined);
  if (needsSourceReview !== undefined) clean.needsSourceReview = needsSourceReview;

  if (typeof patch.expectedVersion === 'number' && Number.isFinite(patch.expectedVersion)) {
    clean.expectedVersion = patch.expectedVersion;
  }
  if (typeof patch.expectedUpdatedAt === 'string' && patch.expectedUpdatedAt.trim()) {
    clean.expectedUpdatedAt = patch.expectedUpdatedAt.trim();
  }
  if (patch.addReport && typeof patch.addReport === 'object') {
    clean.addReport = patch.addReport;
  }
  if (patch.dismissReport && typeof patch.dismissReport === 'object') {
    clean.dismissReport = patch.dismissReport;
  }
  if (typeof patch.resolveOpenReports === 'boolean') {
    clean.resolveOpenReports = patch.resolveOpenReports;
  }
  if (typeof patch.resolutionNote === 'string') {
    clean.resolutionNote = patch.resolutionNote;
  }

  const reviewNotes =
    patch.reviewNotes ?? (typeof legacyPayload?.reviewNotes === 'string' ? legacyPayload.reviewNotes : undefined);
  if (reviewNotes !== undefined) clean.reviewNotes = reviewNotes;

  const lastReviewedAt =
    patch.lastReviewedAt ??
    (typeof legacyPayload?.lastReviewedAt === 'string' ? legacyPayload.lastReviewedAt : undefined);
  if (lastReviewedAt !== undefined) clean.lastReviewedAt = lastReviewedAt;

  const sourceMaterials =
    patch.sourceMaterials ?? (Array.isArray(legacyPayload?.sourceMaterials) ? legacyPayload.sourceMaterials : undefined);
  if (sourceMaterials !== undefined) clean.sourceMaterials = sourceMaterials;

  const sourceContentVersion =
    patch.sourceContentVersion ??
    (typeof legacyPayload?.sourceContentVersion === 'string' ? legacyPayload.sourceContentVersion : undefined);
  if (sourceContentVersion !== undefined) clean.sourceContentVersion = sourceContentVersion;

  const sourceVerificationStatus =
    patch.sourceVerificationStatus ??
    (typeof legacyPayload?.sourceVerificationStatus === 'string'
      ? legacyPayload.sourceVerificationStatus
      : undefined);
  if (sourceVerificationStatus !== undefined) clean.sourceVerificationStatus = sourceVerificationStatus;

  const sourcePage =
    patch.sourcePage ?? (typeof legacyPayload?.sourcePage === 'string' ? legacyPayload.sourcePage : undefined);
  if (sourcePage !== undefined) clean.sourcePage = sourcePage;

  const reports =
    patch.reports ?? (Array.isArray(legacyPayload?.reports) ? (legacyPayload.reports as ProblemReport[]) : undefined);
  if (reports !== undefined) clean.reports = reports;

  return clean;
}

/**
 * Atomically merges report lists in memory (mirroring `public.merge_problem_reports` in SQL)
 * for fallback or client-side verification.
 */
export function mergeProblemReportsAtomically(
  existingReports: ProblemReport[] | undefined,
  patch: ProblemQualityPatch
): ProblemReport[] {
  const legacyPayload =
    patch.payload && typeof patch.payload === 'object'
      ? (patch.payload as Record<string, unknown>)
      : undefined;
  const incomingReports =
    patch.reports ??
    (Array.isArray(legacyPayload?.reports) ? (legacyPayload.reports as ProblemReport[]) : undefined);

  let reports: ProblemReport[] = Array.isArray(existingReports)
    ? existingReports.map((r) => ({ ...r }))
    : [];
  const nowIso = patch.lastReviewedAt || new Date().toISOString();

  const isRecentDuplicate = (list: ProblemReport[], candidate: ProblemReport): boolean => {
    const candDetails = (candidate.details ?? '').trim();
    if (!candDetails) return false;
    return list.some((r) => {
      if (r.id && candidate.id && r.id === candidate.id) return true;
      if (r.status === 'dismissed' || r.status === 'resolved') return false;
      if (r.type !== candidate.type) return false;
      if ((r.details ?? '').trim() !== candDetails) return false;
      const tA = new Date(candidate.createdAt || nowIso).getTime();
      const tB = new Date(r.createdAt || nowIso).getTime();
      if (Number.isFinite(tA) && Number.isFinite(tB) && Math.abs(tA - tB) < 15000) {
        return true;
      }
      return false;
    });
  };

  if (Array.isArray(incomingReports)) {
    for (const item of incomingReports) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      const existingIdx = reports.findIndex((r) => r.id === item.id);
      if (existingIdx >= 0) {
        const cur = reports[existingIdx];
        if (
          (cur.status === 'open' || cur.status === 'under_review') &&
          (item.status === 'under_review' || item.status === 'resolved' || item.status === 'dismissed')
        ) {
          reports[existingIdx] = { ...cur, ...item };
        }
      } else if (!isRecentDuplicate(reports, item)) {
        reports = [{ ...item }, ...reports];
      }
    }
  }

  if (patch.addReport) {
    const rep = patch.addReport;
    if (!isRecentDuplicate(reports, rep)) {
      reports = [
        {
          id: rep.id,
          problemId: rep.problemId,
          ...(rep.attemptId ? { attemptId: rep.attemptId } : {}),
          type: rep.type,
          details: rep.details.trim(),
          createdAt: rep.createdAt || nowIso,
          status: rep.status || 'open',
        },
        ...reports,
      ];
    }
  }

  if (patch.dismissReport) {
    const { reportId, resolutionNote, resolvedAt } = patch.dismissReport;
    reports = reports.map((r) =>
      r.id === reportId
        ? {
            ...r,
            status: 'dismissed',
            resolutionNote: resolutionNote.trim(),
            resolvedAt: r.resolvedAt || resolvedAt || nowIso,
          }
        : r
    );
  }

  const nextStatus =
    patch.qualityStatus ?? (typeof legacyPayload?.qualityStatus === 'string' ? legacyPayload.qualityStatus : undefined);

  if (nextStatus === 'under_review') {
    reports = reports.map((r) => (r.status === 'open' ? { ...r, status: 'under_review' } : r));
  }

  if (patch.resolveOpenReports || nextStatus === 'reapproved') {
    const resolveNote =
      (patch.resolutionNote ?? patch.reviewNotes ?? '').trim() ||
      '문제 검토 및 수정/보완 완료 후 사용자 재승인';
    reports = reports.map((r) =>
      r.status === 'open' || r.status === 'under_review'
        ? {
            ...r,
            status: 'resolved',
            resolutionNote: resolveNote,
            resolvedAt: nowIso,
          }
        : r
    );
  }

  return reports;
}

/**
 * Persists a quality/review status change (report, dismiss, suspend, reapprove, outdated flag)
 * without EVER overwriting the server's problem body, model answer, rubric, or version.
 */
export async function updateProblemQuality(
  supabase: SupabaseClient,
  id: string,
  patch: ProblemQualityPatch
): Promise<RepoResult<Problem>> {
  try {
    if (patch.addReport) {
      if (!patch.addReport.id?.trim() || !patch.addReport.type?.trim() || !patch.addReport.details?.trim()) {
        return repoError('incomplete:REPORT_INVALID: 신고 ID, 유형, 상세 사유가 필요합니다.');
      }
    }
    if (patch.dismissReport) {
      if (!patch.dismissReport.reportId?.trim() || !patch.dismissReport.resolutionNote?.trim()) {
        return repoError('incomplete:DISMISS_REASON_REQUIRED: 신고 ID와 기각 사유가 필요합니다.');
      }
    }

    const sanitizedPatch = sanitizeProblemQualityPatch(patch);

    if (typeof supabase.rpc !== 'function') {
      return repoError(
        'not_configured:RPC_NOT_CONFIGURED: 문제 품질 갱신 RPC(update_problem_quality)가 설정되지 않았습니다. 최신 DB 마이그레이션을 적용해 주세요.'
      );
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc('update_problem_quality', {
      p_problem_id: id,
      p_patch: sanitizedPatch,
    });

    if (rpcErr) {
      return repoError(`${approvalErrorCode(rpcErr)}:${rpcErr.message}`);
    }

    if (
      !rpcData ||
      typeof rpcData !== 'object' ||
      Array.isArray(rpcData) ||
      typeof (rpcData as { id?: unknown }).id !== 'string' ||
      !(rpcData as { payload?: unknown }).payload ||
      typeof (rpcData as { payload?: unknown }).payload !== 'object'
    ) {
      return repoError(
        'invalid_rpc_response:INVALID_RPC_RESPONSE: 문제 품질 갱신 RPC(update_problem_quality) 응답 형식이 올바르지 않습니다.'
      );
    }

    return repoOk(rowToProblem(rpcData as ProblemRow));
  } catch (error) {
    return repoError(message(error, '문제 품질 상태를 저장하지 못했습니다.'));
  }
}

export async function getProblemVersionSnapshot(
  supabase: SupabaseClient,
  problemId: string,
  version: number
): Promise<RepoResult<ProblemVersionSnapshot | null>> {
  try {
    const { data, error } = await supabase
      .from('problem_versions')
      .select('*')
      .eq('problem_id', problemId)
      .eq('version', version)
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoOk(null);
    const row = data as ProblemVersionRow;
    const snap = (row.snapshot ?? {}) as unknown as ProblemVersionSnapshot;
    return repoOk({ ...snap, version: row.version ?? version });
  } catch (error) {
    return repoError(message(error, '문제 버전 스냅샷을 불러오지 못했습니다.'));
  }
}

function buildSnapshotFromProblem(problem: Problem, version: number): ProblemVersionSnapshot {
  return {
    version,
    title: problem.title,
    promptText: problem.promptText,
    type: problem.type,
    conceptIds: Array.isArray(problem.conceptIds) ? [...problem.conceptIds] : [],
    appliedConditionNote: problem.appliedConditionNote,
    mathFormula: problem.mathFormula,
    codeSnippet: problem.codeSnippet,
    timeStandardMinutes: problem.timeStandardMinutes,
    hints: Array.isArray(problem.hints) ? [...problem.hints] : [],
    modelAnswer: problem.modelAnswer,
    rubric: Array.isArray(problem.rubric) ? [...problem.rubric] : [],
    editedAt: problem.lastReviewedAt || new Date().toISOString(),
    editReason: problem.reviewNotes,
    difficultyLevel: problem.difficultyLevel,
    sourceMaterialId: problem.sourceMaterialId,
    sourceConceptIds: problem.sourceConceptIds ? [...problem.sourceConceptIds] : undefined,
    sourceExcerpt: problem.sourceExcerpt,
    sourcePage: problem.sourcePage,
    sourceContentVersion: problem.sourceContentVersion,
    sourceVerificationStatus: problem.sourceVerificationStatus,
  };
}

export type ReviseProblemFailureReason =
  | 'read_error'
  | 'snapshot_missing'
  | 'snapshot_incomplete'
  | 'content_mismatch';

export type ReviseProblemVerificationStatus =
  | 'verified_current'
  | 'verified_snapshot_only'
  | 'verification_failed';

export type ReviseProblemOutcome =
  | 'verified_current'
  | 'verified_snapshot_only'
  | 'verification_failed'
  | 'save_uncertain'
  | 'save_failed';

export type ReviseProblemVerifiedResult = {
  outcome: 'verified_current' | 'verified_snapshot_only';
  ok: true;
  savedToServer: true;
  contentVerified: true;
  verificationStatus: 'verified_current' | 'verified_snapshot_only';
  /** Authoritative problem state built from verified server data at `confirmedVersion`. */
  data: Problem;
  confirmedVersion: number;
  confirmedSnapshot: ProblemVersionSnapshot;
  /** Latest server problem row (may have a higher version if another request succeeded afterwards). */
  latestServerProblem: Problem | null;
  serverAdvancedBeyondConfirmed: boolean;
};

export type ReviseProblemVerificationFailedResult = {
  outcome: 'verification_failed';
  /** Verification failure never masquerades as full completion (`ok: true`) and never exposes request-derived `data`. */
  ok: false;
  savedToServer: true;
  contentVerified: false;
  verificationStatus: 'verification_failed';
  verificationFailureReason: ReviseProblemFailureReason;
  verificationError: string;
  confirmedVersion: number;
  serverSnapshot: ProblemVersionSnapshot | null;
  latestServerProblem: Problem | null;
  serverAdvancedBeyondConfirmed: boolean;
  error: string;
  data?: never;
};

export type ReviseProblemRepoResult =
  | ReviseProblemVerifiedResult
  | ReviseProblemVerificationFailedResult
  | {
      outcome: 'save_uncertain';
      ok: false;
      savedToServer: 'unknown';
      contentVerified: false;
      verificationStatus: 'save_uncertain';
      error: string;
      data?: never;
    }
  | {
      outcome: 'save_failed';
      ok: false;
      savedToServer: false;
      contentVerified: false;
      verificationStatus: 'save_failed';
      error: string;
      data?: never;
    };

function isUncertainTransportError(error: unknown): boolean {
  const code = approvalErrorCode(
    error && typeof error === 'object' ? (error as { message?: string; code?: string }) : null
  );
  // Explicit business/auth/config rejections are known not to have committed.
  if (
    code === 'version_conflict' ||
    code === 'missing' ||
    code === 'forbidden' ||
    code === 'not_configured' ||
    code === 'incomplete' ||
    code === 'no_concept' ||
    code === 'id_conflict' ||
    code === 'rubric' ||
    code === 'scope'
  ) {
    return false;
  }
  const msg =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  return /failed to fetch|fetch failed|network|timeout|timed out|econnreset|etimedout|enotfound|econnrefused|aborted|abort|bad gateway|service unavailable|gateway timeout|502|503|504|unexpected end of json/i.test(
    msg
  );
}

/**
 * Shared read-only server verification helper used both right after `revise_problem_with_snapshot`
 * and during user-triggered/background "저장 결과 다시 확인" recovery.
 * NEVER fabricates missing snapshot fields from `submittedProblem` and NEVER mutates the database.
 */
export async function verifyProblemVersionSnapshotOnServer(
  supabase: SupabaseClient,
  problemId: string,
  confirmedVersion: number,
  submittedProblem: Problem,
  options?: {
    atomicSnapshot?: ProblemVersionSnapshot | null;
    atomicProblem?: Problem | null;
  }
): Promise<ReviseProblemVerifiedResult | ReviseProblemVerificationFailedResult> {
  const [snapRes, latestRes] = await Promise.all([
    options?.atomicSnapshot
      ? Promise.resolve(repoOk<ProblemVersionSnapshot | null>(options.atomicSnapshot))
      : getProblemVersionSnapshot(supabase, problemId, confirmedVersion),
    options?.atomicProblem
      ? Promise.resolve(repoOk<Problem | null>(options.atomicProblem))
      : getProblemById(supabase, problemId),
  ]);

  const immutableSnap = snapRes.ok && snapRes.data ? snapRes.data : null;
  const latestServerProblem = latestRes.ok && latestRes.data ? latestRes.data : null;
  const latestServerVer = latestServerProblem?.version ?? confirmedVersion;
  const serverAdvancedBeyondConfirmed = Boolean(
    latestServerProblem && latestServerVer > confirmedVersion
  );

  const fail = (
    reason: ReviseProblemFailureReason,
    errMsg: string
  ): ReviseProblemVerificationFailedResult => ({
    outcome: 'verification_failed',
    ok: false,
    savedToServer: true,
    contentVerified: false,
    verificationStatus: 'verification_failed',
    verificationFailureReason: reason,
    verificationError: errMsg,
    confirmedVersion,
    serverSnapshot: immutableSnap,
    latestServerProblem,
    serverAdvancedBeyondConfirmed,
    error: errMsg,
  });

  if (!snapRes.ok) {
    return fail('read_error', snapRes.error || '확정 버전 스냅샷 조회에 실패했습니다.');
  }

  if (immutableSnap !== null) {
    if (!isCompleteProblemSnapshot(immutableSnap)) {
      return fail(
        'snapshot_incomplete',
        '확정 버전 스냅샷의 필수 평가 필드가 누락되어 검증에 실패했습니다.'
      );
    }
    if (!snapshotEvaluationMatchesProblem(submittedProblem, immutableSnap)) {
      return fail(
        'content_mismatch',
        '서버 확정 버전 스냅샷 내용이 요청한 수정본과 일치하지 않습니다.'
      );
    }
  }

  if (!latestRes.ok) {
    return fail('read_error', latestRes.error || '수정된 문제를 다시 조회하지 못했습니다.');
  }
  if (!latestServerProblem) {
    return fail(
      immutableSnap === null ? 'snapshot_missing' : 'read_error',
      '서버에서 수정된 문제 행을 조회하지 못했습니다.'
    );
  }

  if (immutableSnap === null) {
    return fail(
      'snapshot_missing',
      serverAdvancedBeyondConfirmed
        ? '서버가 후속 버전으로 진행되었으나 확정 버전 스냅샷이 누락되어 검증에 실패했습니다.'
        : '확정 버전 스냅샷이 누락되어 저장 결과를 검증할 수 없습니다.'
    );
  }

  if (!serverAdvancedBeyondConfirmed) {
    if (!isCompleteProblemSnapshot(latestServerProblem)) {
      return fail(
        'snapshot_incomplete',
        '서버 문제 본문의 필수 평가 필드가 누락되어 검증에 실패했습니다.'
      );
    }
    if (!snapshotEvaluationMatchesProblem(submittedProblem, latestServerProblem)) {
      return fail(
        'content_mismatch',
        '서버의 현재 버전 내용이 요청한 수정본과 일치하지 않습니다.'
      );
    }
    const verifiedSnapshot: ProblemVersionSnapshot = {
      ...buildSnapshotFromProblem(latestServerProblem, confirmedVersion),
      ...immutableSnap,
      version: confirmedVersion,
    };
    const verifiedProblem: Problem = {
      ...latestServerProblem,
      ...immutableSnap,
      id: problemId,
      version: confirmedVersion,
      serverConfirmedVersion: confirmedVersion,
      reports: latestServerProblem.reports ?? [],
    };
    return {
      outcome: 'verified_current',
      ok: true,
      savedToServer: true,
      contentVerified: true,
      verificationStatus: 'verified_current',
      data: verifiedProblem,
      confirmedVersion,
      confirmedSnapshot: verifiedSnapshot,
      latestServerProblem,
      serverAdvancedBeyondConfirmed: false,
    };
  }

  // Server already advanced beyond `confirmedVersion`: build verifiedProblem strictly from
  // verified `immutableSnap` + authoritative server metadata on `latestServerProblem` (never from request).
  const verifiedSnapshot: ProblemVersionSnapshot = {
    ...immutableSnap,
    version: confirmedVersion,
  };
  const verifiedProblem: Problem = {
    ...latestServerProblem,
    ...immutableSnap,
    id: problemId,
    subjectId: latestServerProblem.subjectId,
    version: confirmedVersion,
    serverConfirmedVersion: confirmedVersion,
    reports: latestServerProblem.reports ?? [],
  };

  return {
    outcome: 'verified_snapshot_only',
    ok: true,
    savedToServer: true,
    contentVerified: true,
    verificationStatus: 'verified_snapshot_only',
    data: verifiedProblem,
    confirmedVersion,
    confirmedSnapshot: verifiedSnapshot,
    latestServerProblem,
    serverAdvancedBeyondConfirmed: true,
  };
}

/**
 * Revises a problem via `public.revise_problem_with_snapshot`:
 * writes a new immutable version in one transaction and verifies BOTH the confirmed
 * version snapshot and authoritative server content before returning `ok: true`.
 */
export async function reviseProblem(
  supabase: SupabaseClient,
  problemId: string,
  expectedVersion: number,
  problem: Problem
): Promise<ReviseProblemRepoResult> {
  try {
    if (typeof supabase.rpc !== 'function') {
      return {
        outcome: 'save_failed',
        ok: false,
        savedToServer: false,
        contentVerified: false,
        verificationStatus: 'save_failed',
        error:
          'not_configured:RPC_NOT_CONFIGURED: 문제 수정 RPC(revise_problem_with_snapshot)가 설정되지 않았습니다.',
      };
    }

    const { data: rpcData, error } = await supabase.rpc('revise_problem_with_snapshot', {
      p_problem_id: problemId,
      p_expected_version: expectedVersion,
      p_problem: problem as unknown as Record<string, unknown>,
    });
    if (error) {
      if (isUncertainTransportError(error)) {
        return {
          outcome: 'save_uncertain',
          ok: false,
          savedToServer: 'unknown',
          contentVerified: false,
          verificationStatus: 'save_uncertain',
          error: `save_uncertain:${error.message || '네트워크 오류로 서버 반영 여부를 확인할 수 없습니다.'}`,
        };
      }
      return {
        outcome: 'save_failed',
        ok: false,
        savedToServer: false,
        contentVerified: false,
        verificationStatus: 'save_failed',
        error: `${approvalErrorCode(error)}:${error.message}`,
      };
    }

    let confirmedVersion: number | null = null;
    let atomicSnapshot: ProblemVersionSnapshot | null = null;
    let atomicProblem: Problem | null = null;

    if (typeof rpcData === 'number' && Number.isInteger(rpcData) && rpcData > 0) {
      confirmedVersion = rpcData;
    } else if (typeof rpcData === 'string' && /^\d+$/.test(rpcData.trim())) {
      const parsed = Number(rpcData.trim());
      if (Number.isInteger(parsed) && parsed > 0) {
        confirmedVersion = parsed;
      }
    } else if (rpcData && typeof rpcData === 'object' && !Array.isArray(rpcData)) {
      const obj = rpcData as {
        confirmedVersion?: unknown;
        confirmedSnapshot?: unknown;
        problemRow?: unknown;
      };
      if (
        typeof obj.confirmedVersion === 'number' &&
        Number.isInteger(obj.confirmedVersion) &&
        obj.confirmedVersion > 0
      ) {
        confirmedVersion = obj.confirmedVersion;
      } else if (
        typeof obj.confirmedVersion === 'string' &&
        /^\d+$/.test(obj.confirmedVersion.trim())
      ) {
        const parsed = Number(obj.confirmedVersion.trim());
        if (Number.isInteger(parsed) && parsed > 0) {
          confirmedVersion = parsed;
        }
      }

      if (
        confirmedVersion !== null &&
        obj.confirmedSnapshot &&
        typeof obj.confirmedSnapshot === 'object' &&
        !Array.isArray(obj.confirmedSnapshot)
      ) {
        const snapObj = obj.confirmedSnapshot as Record<string, unknown>;
        atomicSnapshot = {
          ...(snapObj as unknown as ProblemVersionSnapshot),
          version: typeof snapObj.version === 'number' ? snapObj.version : confirmedVersion,
        };
      }

      if (
        confirmedVersion !== null &&
        obj.problemRow &&
        typeof obj.problemRow === 'object' &&
        !Array.isArray(obj.problemRow)
      ) {
        const rowObj = obj.problemRow as ProblemRow;
        if (typeof rowObj.id === 'string' && rowObj.payload && typeof rowObj.payload === 'object') {
          atomicProblem = rowToProblem(rowObj);
        }
      }
    }

    // Never guess expectedVersion + 1 when the RPC return value is missing or malformed.
    if (confirmedVersion === null) {
      return {
        outcome: 'save_failed',
        ok: false,
        savedToServer: false,
        contentVerified: false,
        verificationStatus: 'save_failed',
        error:
          'invalid_rpc_response:INVALID_RPC_RESPONSE: 문제 수정 RPC 응답에 유효한 확정 버전(confirmedVersion)이 없습니다.',
      };
    }

    return verifyProblemVersionSnapshotOnServer(supabase, problemId, confirmedVersion, problem, {
      atomicSnapshot,
      atomicProblem,
    });
  } catch (error) {
    if (isUncertainTransportError(error)) {
      return {
        outcome: 'save_uncertain',
        ok: false,
        savedToServer: 'unknown',
        contentVerified: false,
        verificationStatus: 'save_uncertain',
        error: `save_uncertain:${message(error, '네트워크 오류로 서버 반영 여부를 확인할 수 없습니다.')}`,
      };
    }
    return {
      outcome: 'save_failed',
      ok: false,
      savedToServer: false,
      contentVerified: false,
      verificationStatus: 'save_failed',
      error: message(error, '문제 수정에 실패했습니다.'),
    };
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
    const ids = problems.map((p) => p.id);
    const { data: existingRows, error: fetchErr } = await supabase
      .from('problems')
      .select('*')
      .in('id', ids);
    if (fetchErr) return repoError(fetchErr.message);

    const existingMap = new Map<string, ProblemRow>(
      ((existingRows as ProblemRow[]) ?? []).map((r) => [r.id, r])
    );

    const rowsToInsert = problems
      .filter((p) => !existingMap.has(p.id))
      .map(problemToUpsert);

    if (rowsToInsert.length > 0) {
      const { error } = await supabase
        .from('problems')
        .upsert(rowsToInsert, { onConflict: 'id,user_id', ignoreDuplicates: true });
      if (error) return repoError(error.message);
    }

    const { data: finalRows, error: finalErr } = await supabase
      .from('problems')
      .select('*')
      .in('id', ids);
    if (finalErr) return repoError(finalErr.message);

    const finalMap = new Map<string, ProblemRow>(
      ((finalRows as ProblemRow[]) ?? []).map((r) => [r.id, r])
    );
    const ordered = problems
      .map((p) => {
        const row = finalMap.get(p.id);
        return row ? rowToProblem(row) : undefined;
      })
      .filter((p): p is Problem => Boolean(p));

    return repoOk(ordered);
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
