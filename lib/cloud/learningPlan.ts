import type { Concept, ConceptDraft, Problem, ProblemDraft } from '../types';

export interface LearningConflict {
  kind: 'concept' | 'conceptDraft' | 'problem' | 'problemDraft';
  id: string;
  reason: string;
}

export interface LearningPlan {
  concepts: Concept[];
  conceptDrafts: ConceptDraft[];
  problems: Problem[];
  problemDrafts: ProblemDraft[];
  conflicts: LearningConflict[];
  skipped: number;
}

/**
 * Identity used for migration conflict detection.
 * Review history and locally-derived scores/timestamps are NOT part of a
 * concept's identity (they stay local in this stage).
 */
export function conceptIdentity(concept: Concept): string {
  const {
    events,
    currentScore,
    baseScore,
    lastAttemptAt,
    lastAttemptDayOffset,
    firstLearnedAt,
    firstLearnedDayOffset,
    recommendedReviewAt,
    lastCalculatedAt,
    postponedUntil,
    ...definition
  } = concept;
  void events; void currentScore; void baseScore; void lastAttemptAt; void lastAttemptDayOffset;
  void firstLearnedAt; void firstLearnedDayOffset; void recommendedReviewAt; void lastCalculatedAt;
  void postponedUntil;
  return JSON.stringify(definition);
}

/** Evaluation-relevant identity of a problem (version history / quality meta excluded). */
export function problemIdentity(problem: Problem): string {
  const {
    versionHistory,
    reports,
    isOutdated,
    needsSourceReview,
    qualityStatus,
    version,
    lastReviewedAt,
    reviewNotes,
    ...evaluation
  } = problem;
  void versionHistory; void reports; void isOutdated; void needsSourceReview;
  void qualityStatus; void version; void lastReviewedAt; void reviewNotes;
  return JSON.stringify(evaluation);
}

function draftIdentity<T extends { updatedAt?: string }>(draft: T): string {
  const { updatedAt, ...rest } = draft;
  void updatedAt;
  return JSON.stringify(rest);
}

function planEntity<T extends { id: string }>(
  kind: LearningConflict['kind'],
  local: T[],
  cloud: T[],
  identity: (item: T) => string,
  reason: string
): { upload: T[]; conflicts: LearningConflict[]; skipped: number } {
  const cloudById = new Map(cloud.map((item) => [item.id, item]));
  const upload: T[] = [];
  const conflicts: LearningConflict[] = [];
  let skipped = 0;
  for (const item of local) {
    const existing = cloudById.get(item.id);
    if (!existing) {
      upload.push(item);
    } else if (identity(existing) === identity(item)) {
      skipped += 1;
    } else {
      conflicts.push({ kind, id: item.id, reason });
    }
  }
  return { upload, conflicts, skipped };
}

/**
 * Decides what an explicit local->cloud migration must upload. Same-id/identical
 * content is skipped; same-id/different content is a conflict (never overwritten).
 */
export function planLearningMigration(input: {
  localConcepts: Concept[];
  localConceptDrafts: ConceptDraft[];
  localProblems: Problem[];
  localProblemDrafts: ProblemDraft[];
  cloudConcepts: Concept[];
  cloudConceptDrafts: ConceptDraft[];
  cloudProblems: Problem[];
  cloudProblemDrafts: ProblemDraft[];
}): LearningPlan {
  const concepts = planEntity('concept', input.localConcepts, input.cloudConcepts, conceptIdentity, '같은 ID의 개념이 서버에 다른 내용으로 존재합니다.');
  const conceptDrafts = planEntity('conceptDraft', input.localConceptDrafts, input.cloudConceptDrafts, draftIdentity, '같은 ID의 개념 초안이 서버에 다른 내용으로 존재합니다.');
  const problems = planEntity('problem', input.localProblems, input.cloudProblems, problemIdentity, '같은 ID의 문제가 서버에 다른 내용으로 존재합니다.');
  const problemDrafts = planEntity('problemDraft', input.localProblemDrafts, input.cloudProblemDrafts, draftIdentity, '같은 ID의 문제 초안이 서버에 다른 내용으로 존재합니다.');

  return {
    concepts: concepts.upload,
    conceptDrafts: conceptDrafts.upload,
    problems: problems.upload,
    problemDrafts: problemDrafts.upload,
    conflicts: [
      ...concepts.conflicts,
      ...conceptDrafts.conflicts,
      ...problems.conflicts,
      ...problemDrafts.conflicts,
    ],
    skipped: concepts.skipped + conceptDrafts.skipped + problems.skipped + problemDrafts.skipped,
  };
}
