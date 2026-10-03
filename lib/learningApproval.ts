import type { Concept, ConceptDraft } from './types';

/**
 * Builds the Concept document for server-side approval. Pure (no persistence)
 * so it can be validated and committed by the transactional approval RPC, and
 * mirrored into the local cache only after the server confirms.
 */
export function buildConceptFromDraft(
  draft: ConceptDraft,
  existing: Concept | undefined,
  order: number
): Concept {
  const evidence = draft.sourceEvidence;
  const chapterRef =
    evidence.type === 'page'
      ? `제${evidence.pageNumber || 1}페이지`
      : evidence.timestamp
        ? `전사본 ${evidence.timestamp}`
        : `전사본 발화 #${evidence.blockIndex || 1}`;

  if (existing) {
    return {
      ...existing,
      title: draft.title,
      description: draft.description,
      coreDefinitionFormulaOrAlgorithm: draft.coreDefinitionFormulaOrAlgorithm,
      prerequisites: draft.prerequisites,
      relatedConcepts: draft.relatedConcepts,
      commonMisconceptions: draft.commonMisconceptions,
      examples: draft.examples,
      sourceEvidence: draft.sourceEvidence,
    };
  }

  return {
    // Stable id derived from the draft id: a retry never creates a duplicate.
    id: `c-ai-${draft.id}`,
    subjectId: draft.subjectId,
    materialIds: [draft.materialId],
    title: draft.title,
    chapterRef,
    baseScore: 0,
    currentScore: 0,
    status: 'unstudied',
    order,
    events: [],
    exerciseCount: 0,
    isDemo: false,
    isLearned: false,
    description: draft.description,
    coreDefinitionFormulaOrAlgorithm: draft.coreDefinitionFormulaOrAlgorithm,
    prerequisites: draft.prerequisites,
    relatedConcepts: draft.relatedConcepts,
    commonMisconceptions: draft.commonMisconceptions,
    examples: draft.examples,
    sourceEvidence: draft.sourceEvidence,
    draftId: draft.id,
  };
}
