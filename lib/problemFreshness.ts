/**
 * Stage 11: Determines which problems become stale when a material is edited.
 *
 * Rules:
 *  - A problem with per-material source refs becomes outdated ONLY when one of
 *    the materials it actually referenced changed its body hash.
 *  - Editing an unrelated material never marks a problem outdated.
 *  - Legacy problems without per-material refs are flagged "needs source review"
 *    (not auto-outdated), because their single hash cannot be attributed to a
 *    specific material.
 */

import { Concept, Material, Problem } from './types';
import { computeMarkdownHash } from './markdownUtils';

export interface MaterialEditApplication {
  updatedProblems: Problem[];
  outdatedIds: string[];
  reviewIds: string[];
  unchangedIds: string[];
}

export function applyMaterialEditToProblems(
  problems: Problem[],
  editedMaterial: Material,
  allConcepts: Concept[]
): MaterialEditApplication {
  const newHash = computeMarkdownHash(editedMaterial.parsedMarkdown || '');
  const outdatedIds: string[] = [];
  const reviewIds: string[] = [];
  const unchangedIds: string[] = [];

  const updatedProblems = problems.map((problem) => {
    if (problem.subjectId !== editedMaterial.subjectId) {
      unchangedIds.push(problem.id);
      return problem;
    }

    if (problem.sourceMaterials && problem.sourceMaterials.length > 0) {
      const mismatched = problem.sourceMaterials.some(
        (ref) => ref.materialId === editedMaterial.id && ref.markdownHash !== newHash
      );
      if (mismatched) {
        outdatedIds.push(problem.id);
        return { ...problem, isOutdated: true, needsSourceReview: false };
      }
      unchangedIds.push(problem.id);
      return problem;
    }

    const usesMaterial = problem.conceptIds.some((id) =>
      allConcepts.some((c) => c.id === id && c.materialIds.includes(editedMaterial.id))
    );
    if (usesMaterial && problem.sourceMarkdownHash && problem.sourceMarkdownHash !== newHash) {
      reviewIds.push(problem.id);
      return { ...problem, needsSourceReview: true };
    }

    unchangedIds.push(problem.id);
    return problem;
  });

  return { updatedProblems, outdatedIds, reviewIds, unchangedIds };
}
