import type { Concept, ConceptDraft, Problem, ProblemDraft } from '../types';
import type {
  ConceptDraftContentUpsert,
  ConceptDraftRow,
  ConceptDraftUpsert,
  ConceptRow,
  ConceptUpsert,
  ProblemDraftContentUpsert,
  ProblemDraftRow,
  ProblemDraftUpsert,
  ProblemRow,
  ProblemUpsert,
} from './learningTypes';

function doc<T>(payload: Record<string, unknown> | null): Partial<T> {
  return (payload ?? {}) as Partial<T>;
}

// --- concepts --------------------------------------------------------------

export function rowToConcept(row: ConceptRow): Concept {
  return {
    ...doc<Concept>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    order: row.order_index,
    status: row.status as Concept['status'],
    currentScore: Number(row.current_score),
    isLearned: row.is_learned,
    isDemo: row.is_demo,
    draftId: row.draft_id ?? undefined,
  } as Concept;
}

export function conceptToUpsert(concept: Concept): ConceptUpsert {
  return {
    id: concept.id,
    subject_id: concept.subjectId,
    title: concept.title,
    order_index: concept.order ?? 0,
    status: concept.status ?? 'unstudied',
    current_score: concept.currentScore ?? 0,
    is_learned: concept.isLearned ?? false,
    is_demo: concept.isDemo ?? false,
    version: 1,
    draft_id: concept.draftId ?? null,
    payload: concept as unknown as Record<string, unknown>,
  };
}

// --- concept drafts --------------------------------------------------------

/**
 * Authoritative fields come from DB columns (status / is_approved /
 * updated_at / content_version / approval_state / approved_concept_id), so a
 * stale payload can never make an approved draft look unapproved.
 */
export function rowToConceptDraft(row: ConceptDraftRow): ConceptDraft {
  return {
    ...doc<ConceptDraft>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    materialId: row.material_id ?? undefined,
    title: row.title,
    status: row.status as ConceptDraft['status'],
    isApproved: row.is_approved,
    updatedAt: row.updated_at,
    contentVersion: row.content_version,
    approvalState: row.approval_state as ConceptDraft['approvalState'],
    approvedConceptId: row.approved_concept_id ?? undefined,
  } as ConceptDraft;
}

/** Full write used by migration (explicitly sets approval columns). */
export function conceptDraftToUpsert(draft: ConceptDraft): ConceptDraftUpsert {
  return {
    id: draft.id,
    subject_id: draft.subjectId,
    material_id: draft.materialId ?? null,
    title: draft.title,
    status: draft.status ?? 'draft',
    is_approved: draft.isApproved ?? false,
    content_version: draft.contentVersion ?? 1,
    generation_job_id: null,
    approved_concept_id: draft.approvedConceptId ?? null,
    approval_state: draft.approvalState ?? (draft.isApproved ? 'approved' : 'pending'),
    approval_error: null,
    payload: draft as unknown as Record<string, unknown>,
  };
}

/** Content-only write for AI generation / persistence retries. */
export function conceptDraftContentUpsert(
  draft: ConceptDraft,
  jobId?: string | null
): ConceptDraftContentUpsert {
  return {
    id: draft.id,
    subject_id: draft.subjectId,
    material_id: draft.materialId ?? null,
    title: draft.title,
    generation_job_id: jobId ?? null,
    payload: draft as unknown as Record<string, unknown>,
  };
}

// --- problems --------------------------------------------------------------

export function rowToProblem(row: ProblemRow): Problem {
  return {
    ...doc<Problem>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    version: row.version,
    draftId: row.draft_id ?? undefined,
    isApproved: row.is_approved,
    isOutdated: row.is_outdated,
    needsSourceReview: row.needs_source_review,
    qualityStatus: (row.quality_status as Problem['qualityStatus']) ?? 'normal',
    isDemo: row.is_demo,
  } as Problem;
}

export function problemToUpsert(problem: Problem): ProblemUpsert {
  return {
    id: problem.id,
    subject_id: problem.subjectId,
    title: problem.title,
    type: problem.type,
    is_approved: problem.isApproved !== false,
    is_outdated: problem.isOutdated ?? false,
    needs_source_review: problem.needsSourceReview ?? false,
    quality_status: problem.qualityStatus ?? 'normal',
    version: problem.version ?? 1,
    draft_id: problem.draftId ?? null,
    is_transfer: problem.isTransfer ?? false,
    source_problem_id: problem.sourceProblemId ?? null,
    logic_session_id: problem.logicSessionId ?? null,
    is_demo: problem.isDemo ?? false,
    payload: problem as unknown as Record<string, unknown>,
  };
}

// --- problem drafts --------------------------------------------------------

export function rowToProblemDraft(row: ProblemDraftRow): ProblemDraft {
  return {
    ...doc<ProblemDraft>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    type: row.type as ProblemDraft['type'],
    status: row.status as ProblemDraft['status'],
    isApproved: row.is_approved,
    isDemo: row.is_demo,
    updatedAt: row.updated_at,
    contentVersion: row.content_version,
    approvalState: row.approval_state as ProblemDraft['approvalState'],
    approvedProblemId: row.approved_problem_id ?? undefined,
  } as ProblemDraft;
}

export function problemDraftToUpsert(draft: ProblemDraft): ProblemDraftUpsert {
  return {
    id: draft.id,
    subject_id: draft.subjectId,
    title: draft.title,
    type: draft.type,
    status: draft.status ?? 'draft',
    is_approved: draft.isApproved ?? false,
    is_demo: draft.isDemo ?? false,
    content_version: draft.contentVersion ?? 1,
    generation_job_id: null,
    approved_problem_id: draft.approvedProblemId ?? null,
    approval_state: draft.approvalState ?? (draft.isApproved ? 'approved' : 'pending'),
    approval_error: null,
    payload: draft as unknown as Record<string, unknown>,
  };
}

export function problemDraftContentUpsert(
  draft: ProblemDraft,
  jobId?: string | null
): ProblemDraftContentUpsert {
  return {
    id: draft.id,
    subject_id: draft.subjectId,
    title: draft.title,
    type: draft.type,
    is_demo: draft.isDemo ?? false,
    generation_job_id: jobId ?? null,
    payload: draft as unknown as Record<string, unknown>,
  };
}
