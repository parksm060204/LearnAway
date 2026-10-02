import type { Concept, ConceptDraft, Problem, ProblemDraft } from '../types';
import type {
  ConceptDraftRow,
  ConceptDraftUpsert,
  ConceptRow,
  ConceptUpsert,
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
  return { ...doc<Concept>(row.payload), id: row.id, subjectId: row.subject_id } as Concept;
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

export function rowToConceptDraft(row: ConceptDraftRow): ConceptDraft {
  return { ...doc<ConceptDraft>(row.payload), id: row.id, subjectId: row.subject_id } as ConceptDraft;
}

export function conceptDraftToUpsert(draft: ConceptDraft): ConceptDraftUpsert {
  return {
    id: draft.id,
    subject_id: draft.subjectId,
    material_id: draft.materialId ?? null,
    title: draft.title,
    status: draft.status ?? 'draft',
    is_approved: draft.isApproved ?? false,
    content_version: 1,
    generation_job_id: null,
    approved_concept_id: null,
    approval_state: draft.isApproved ? 'approved' : 'pending',
    approval_error: null,
    payload: draft as unknown as Record<string, unknown>,
  };
}

// --- problems --------------------------------------------------------------

export function rowToProblem(row: ProblemRow): Problem {
  return {
    ...doc<Problem>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    version: row.version,
    isApproved: row.is_approved,
    isOutdated: row.is_outdated,
    needsSourceReview: row.needs_source_review,
    qualityStatus: (row.quality_status as Problem['qualityStatus']) ?? 'normal',
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
  return { ...doc<ProblemDraft>(row.payload), id: row.id, subjectId: row.subject_id } as ProblemDraft;
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
    content_version: 1,
    generation_job_id: null,
    approved_problem_id: null,
    approval_state: draft.isApproved ? 'approved' : 'pending',
    approval_error: null,
    payload: draft as unknown as Record<string, unknown>,
  };
}
