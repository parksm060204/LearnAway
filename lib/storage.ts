import {
  Subject,
  Material,
  Concept,
  ConceptDraft,
  ConceptStatus,
  Problem,
  ProblemDraft,
  Attempt,
  RetentionModelSettings,
  ReviewEvent,
} from './types';
import {
  INITIAL_SUBJECTS,
  INITIAL_MATERIALS,
  INITIAL_CONCEPTS,
  INITIAL_PROBLEMS,
} from './initialData';
import {
  DEFAULT_RETENTION_SETTINGS,
  calculateCurrentConceptScore,
  getConceptStatusFromScore,
} from './retentionModel';

const STORAGE_KEYS = {
  CURRENT_SUBJECT_ID: 'redcall_active_subject_id',
  SUBJECTS: 'redcall_subjects_v1',
  MATERIALS: 'redcall_materials_v1',
  CONCEPTS: 'redcall_concepts_v1',
  CONCEPT_DRAFTS: 'redcall_concept_drafts_v1',
  PROBLEMS: 'redcall_problems_v1',
  PROBLEM_DRAFTS: 'redcall_problem_drafts_v1',
  ATTEMPTS: 'redcall_attempts_v1',
  SETTINGS: 'redcall_retention_settings_v1',
};

const inMemoryStore: Record<string, string> = {};

function safeGetItem<T>(key: string, fallback: T): T {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } else {
      const raw = inMemoryStore[key];
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.warn(`Failed to parse localStorage key ${key}`, e);
    return fallback;
  }
}

function safeSetItem<T>(key: string, val: T): void {
  try {
    const serialized = JSON.stringify(val);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, serialized);
    } else {
      inMemoryStore[key] = serialized;
    }
  } catch (e) {
    console.error(`Failed to write localStorage key ${key}`, e);
  }
}

export function loadStoredSubjects(): Subject[] {
  return safeGetItem<Subject[]>(STORAGE_KEYS.SUBJECTS, INITIAL_SUBJECTS);
}

export function saveStoredSubjects(subjects: Subject[]): void {
  safeSetItem(STORAGE_KEYS.SUBJECTS, subjects);
}

export function loadActiveSubjectId(): string {
  return safeGetItem<string>(STORAGE_KEYS.CURRENT_SUBJECT_ID, INITIAL_SUBJECTS[0].id);
}

export function saveActiveSubjectId(id: string): void {
  safeSetItem(STORAGE_KEYS.CURRENT_SUBJECT_ID, id);
}

export function loadStoredMaterials(): Material[] {
  const loaded = safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, INITIAL_MATERIALS);
  return loaded.map((m) => ({
    ...m,
    status: m.status || (m.isConverted ? 'ready' : 'converting'),
    isDemo: m.isDemo ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
    hasAiConcepts: m.hasAiConcepts ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
    hasAiProblems: m.hasAiProblems ?? (m.id.startsWith('mat-econ') || m.id.startsWith('mat-cs')),
  }));
}

export function saveStoredMaterials(materials: Material[]): void {
  // Decouple storage: strip heavy rawText and pages from localStorage
  const lightMaterials = materials.map((m) => {
    const { pages, rawText, ...rest } = m;
    return rest;
  });
  safeSetItem(STORAGE_KEYS.MATERIALS, lightMaterials);
}

export function loadStoredConcepts(): Concept[] {
  const loaded = safeGetItem<Concept[]>(STORAGE_KEYS.CONCEPTS, INITIAL_CONCEPTS);
  return loaded.map((c) => ({
    ...c,
    status: c.status || 'stable',
    isDemo: c.isDemo ?? (c.id.startsWith('c-econ') || c.id.startsWith('c-cs')),
    isLearned: c.isLearned ?? (c.id.startsWith('c-econ') || c.id.startsWith('c-cs')),
  }));
}

export function saveStoredConcepts(concepts: Concept[]): void {
  safeSetItem(STORAGE_KEYS.CONCEPTS, concepts);
}

export function loadStoredConceptDrafts(): ConceptDraft[] {
  return safeGetItem<ConceptDraft[]>(STORAGE_KEYS.CONCEPT_DRAFTS, []);
}

export function saveStoredConceptDrafts(drafts: ConceptDraft[]): void {
  safeSetItem(STORAGE_KEYS.CONCEPT_DRAFTS, drafts);
}

export function approveConceptDraft(draftId: string): {
  updatedDrafts: ConceptDraft[];
  updatedConcepts: Concept[];
  newConcept: Concept | null;
  approvedConcept: Concept | null;
} {
  const drafts = loadStoredConceptDrafts();
  const concepts = loadStoredConcepts();

  const targetDraft = drafts.find((d) => d.id === draftId);
  if (!targetDraft) {
    return { updatedDrafts: drafts, updatedConcepts: concepts, newConcept: null, approvedConcept: null };
  }

  const updatedDrafts = drafts.map((d) =>
    d.id === draftId
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: new Date().toISOString() }
      : d
  );
  saveStoredConceptDrafts(updatedDrafts);

  // Check if concept already created from this draft
  const existingIndex = concepts.findIndex((c) => c.draftId === draftId);
  let newConcept: Concept;

  const chapterRef =
    targetDraft.sourceEvidence.type === 'page'
      ? `제${targetDraft.sourceEvidence.pageNumber || 1}페이지`
      : targetDraft.sourceEvidence.timestamp
      ? `전사본 ${targetDraft.sourceEvidence.timestamp}`
      : `전사본 발화 #${targetDraft.sourceEvidence.blockIndex || 1}`;

  if (existingIndex >= 0) {
    newConcept = {
      ...concepts[existingIndex],
      title: targetDraft.title,
      description: targetDraft.description,
      coreDefinitionFormulaOrAlgorithm: targetDraft.coreDefinitionFormulaOrAlgorithm,
      prerequisites: targetDraft.prerequisites,
      relatedConcepts: targetDraft.relatedConcepts,
      commonMisconceptions: targetDraft.commonMisconceptions,
      examples: targetDraft.examples,
      sourceEvidence: targetDraft.sourceEvidence,
    };
    concepts[existingIndex] = newConcept;
  } else {
    newConcept = {
      id: `c-ext-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      subjectId: targetDraft.subjectId,
      materialIds: [targetDraft.materialId],
      title: targetDraft.title,
      chapterRef,
      baseScore: 0,
      currentScore: 0,
      status: 'unstudied', // DO NOT invent fake score or events!
      order: concepts.length + 1,
      events: [],
      exerciseCount: 0,
      isDemo: false,
      isLearned: false,
      description: targetDraft.description,
      coreDefinitionFormulaOrAlgorithm: targetDraft.coreDefinitionFormulaOrAlgorithm,
      prerequisites: targetDraft.prerequisites,
      relatedConcepts: targetDraft.relatedConcepts,
      commonMisconceptions: targetDraft.commonMisconceptions,
      examples: targetDraft.examples,
      sourceEvidence: targetDraft.sourceEvidence,
      draftId: targetDraft.id,
    };
    concepts.push(newConcept);
  }

  saveStoredConcepts(concepts);

  // Update material hasAiConcepts flag
  const materials = loadStoredMaterials();
  const matUpdated = materials.map((m) =>
    m.id === targetDraft.materialId ? { ...m, hasAiConcepts: true } : m
  );
  saveStoredMaterials(matUpdated);

  return { updatedDrafts, updatedConcepts: concepts, newConcept, approvedConcept: newConcept };
}

export function batchApproveConceptDrafts(draftIds: string[]): {
  updatedDrafts: ConceptDraft[];
  updatedConcepts: Concept[];
} {
  const drafts = loadStoredConceptDrafts();
  let concepts = loadStoredConcepts();
  const targetIdsSet = new Set(draftIds);

  const updatedDrafts = drafts.map((d) =>
    targetIdsSet.has(d.id)
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: new Date().toISOString() }
      : d
  );
  saveStoredConceptDrafts(updatedDrafts);

  for (const draftId of draftIds) {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) continue;

    const existingIndex = concepts.findIndex((c) => c.draftId === draftId);
    const chapterRef =
      draft.sourceEvidence.type === 'page'
        ? `제${draft.sourceEvidence.pageNumber || 1}페이지`
        : draft.sourceEvidence.timestamp
        ? `전사본 ${draft.sourceEvidence.timestamp}`
        : `전사본 발화 #${draft.sourceEvidence.blockIndex || 1}`;

    if (existingIndex >= 0) {
      concepts[existingIndex] = {
        ...concepts[existingIndex],
        title: draft.title,
        description: draft.description,
        coreDefinitionFormulaOrAlgorithm: draft.coreDefinitionFormulaOrAlgorithm,
        prerequisites: draft.prerequisites,
        relatedConcepts: draft.relatedConcepts,
        commonMisconceptions: draft.commonMisconceptions,
        examples: draft.examples,
        sourceEvidence: draft.sourceEvidence,
      };
    } else {
      concepts.push({
        id: `c-ext-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subjectId: draft.subjectId,
        materialIds: [draft.materialId],
        title: draft.title,
        chapterRef,
        baseScore: 0,
        currentScore: 0,
        status: 'unstudied',
        order: concepts.length + 1,
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
      });
    }
  }

  saveStoredConcepts(concepts);
  return { updatedDrafts, updatedConcepts: concepts };
}

export function deleteConceptDraft(draftId: string): ConceptDraft[] {
  const drafts = loadStoredConceptDrafts();
  const updated = drafts.filter((d) => d.id !== draftId);
  saveStoredConceptDrafts(updated);
  return updated;
}

export function mergeConceptDrafts(
  targetDraftId: string,
  sourceDraftId: string,
  mergedData?: Partial<ConceptDraft>
): ConceptDraft[] {
  const drafts = loadStoredConceptDrafts();
  const target = drafts.find((d) => d.id === targetDraftId);
  const source = drafts.find((d) => d.id === sourceDraftId);

  if (!target || !source) return drafts;

  const mergedPrerequisites = Array.from(
    new Set([...target.prerequisites, ...source.prerequisites])
  );
  const mergedRelated = Array.from(
    new Set([...target.relatedConcepts, ...source.relatedConcepts])
  );
  const mergedMisconceptions = Array.from(
    new Set([...target.commonMisconceptions, ...source.commonMisconceptions])
  );
  const mergedExamples = Array.from(new Set([...target.examples, ...source.examples]));

  const updatedDraft: ConceptDraft = {
    ...target,
    ...mergedData,
    prerequisites: mergedPrerequisites,
    relatedConcepts: mergedRelated,
    commonMisconceptions: mergedMisconceptions,
    examples: mergedExamples,
    updatedAt: new Date().toISOString(),
    editedByUser: true,
  };

  const updated = drafts
    .filter((d) => d.id !== sourceDraftId)
    .map((d) => (d.id === targetDraftId ? updatedDraft : d));

  saveStoredConceptDrafts(updated);
  return updated;
}

export function markConceptAsLearned(
  conceptId: string,
  baseScore: number = 85
): { updatedConcepts: Concept[]; learnedConcept?: Concept } {
  const concepts = loadStoredConcepts();
  const now = new Date().toISOString();

  let targetLearned: Concept | undefined;

  const updated = concepts.map((c) => {
    if (c.id !== conceptId) return c;
    const initialEvent: ReviewEvent = {
      id: `ev-${Date.now()}`,
      conceptId: c.id,
      at: now,
      dayOffset: 0,
      kind: 'initial_study',
      title: '학습 완료 등록',
      resultScore: baseScore,
      confidence: 4,
      sourceRef: c.chapterRef,
      evaluationSummary: '사용자 학습 완료 확인',
    };
    const learned: Concept = {
      ...c,
      isLearned: true,
      status: 'newly_learned' as ConceptStatus,
      firstLearnedAt: now,
      firstLearnedDayOffset: 0,
      baseScore,
      currentScore: baseScore,
      events: [initialEvent],
    };
    targetLearned = learned;
    return learned;
  });

  saveStoredConcepts(updated);
  return { updatedConcepts: updated, learnedConcept: targetLearned };
}

export function loadStoredProblems(): Problem[] {
  const raw = safeGetItem<Problem[]>(STORAGE_KEYS.PROBLEMS, INITIAL_PROBLEMS);
  return raw.map((p) => ({
    ...p,
    isDemo: p.isDemo ?? true,
    isApproved: p.isApproved ?? true,
  }));
}

export function saveStoredProblems(problems: Problem[]): void {
  safeSetItem(STORAGE_KEYS.PROBLEMS, problems);
}

export function loadStoredProblemDrafts(): ProblemDraft[] {
  return safeGetItem<ProblemDraft[]>(STORAGE_KEYS.PROBLEM_DRAFTS, []);
}

export function saveStoredProblemDrafts(drafts: ProblemDraft[]): void {
  safeSetItem(STORAGE_KEYS.PROBLEM_DRAFTS, drafts);
}

export function updateProblemDraft(draft: ProblemDraft): ProblemDraft[] {
  const drafts = loadStoredProblemDrafts();
  const updated = drafts.map((d) =>
    d.id === draft.id ? { ...draft, editedByUser: true, updatedAt: new Date().toISOString() } : d
  );
  saveStoredProblemDrafts(updated);
  return updated;
}

export function deleteProblemDraft(draftId: string): ProblemDraft[] {
  const drafts = loadStoredProblemDrafts();
  const updated = drafts.filter((d) => d.id !== draftId);
  saveStoredProblemDrafts(updated);
  return updated;
}

export function approveProblemDraft(draftId: string): {
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedProblem: Problem | null;
} {
  const drafts = loadStoredProblemDrafts();
  const problems = loadStoredProblems();

  const targetDraft = drafts.find((d) => d.id === draftId);
  if (!targetDraft) {
    return { updatedDrafts: drafts, updatedProblems: problems, approvedProblem: null };
  }

  const now = new Date().toISOString();
  const updatedDrafts = drafts.map((d) =>
    d.id === draftId
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: now }
      : d
  );
  saveStoredProblemDrafts(updatedDrafts);

  const existingIndex = problems.findIndex((p) => p.draftId === draftId);
  let approvedProblem: Problem;

  if (existingIndex >= 0) {
    approvedProblem = {
      ...problems[existingIndex],
      title: targetDraft.title,
      type: targetDraft.type,
      difficulty: targetDraft.difficulty,
      promptText: targetDraft.promptText,
      mathFormula: targetDraft.mathFormula,
      codeSnippet: targetDraft.codeSnippet,
      designIntent: targetDraft.designIntent,
      appliedConditionNote: targetDraft.appliedConditionNote,
      timeStandardMinutes: targetDraft.timeStandardMinutes,
      timeBreakdownDesc: targetDraft.timeBreakdownDesc,
      coreEvaluationHighlight: targetDraft.coreEvaluationHighlight,
      itemCountDesc: targetDraft.itemCountDesc,
      hints: targetDraft.hints,
      modelAnswer: targetDraft.modelAnswer,
      rubric: targetDraft.rubric,
      sourceRefs: targetDraft.sourceRefs,
      sourceMarkdownHash: targetDraft.sourceMarkdownHash,
      isApproved: true,
      isDemo: false,
    };
    problems[existingIndex] = approvedProblem;
  } else {
    approvedProblem = {
      id: `prob-ai-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptIds: targetDraft.conceptIds,
      subjectId: targetDraft.subjectId,
      title: targetDraft.title,
      type: targetDraft.type,
      categoryLabel: targetDraft.categoryLabel,
      categoryNumber: targetDraft.categoryNumber,
      promptText: targetDraft.promptText,
      mathFormula: targetDraft.mathFormula,
      codeSnippet: targetDraft.codeSnippet,
      timeStandardMinutes: targetDraft.timeStandardMinutes,
      timeBreakdownDesc: targetDraft.timeBreakdownDesc,
      coreEvaluationHighlight: targetDraft.coreEvaluationHighlight,
      itemCountDesc: targetDraft.itemCountDesc,
      sourceRefs: targetDraft.sourceRefs,
      hints: targetDraft.hints,
      modelAnswer: targetDraft.modelAnswer,
      rubric: targetDraft.rubric,
      isDemo: false,
      isApproved: true,
      draftId: targetDraft.id,
      difficulty: targetDraft.difficulty,
      designIntent: targetDraft.designIntent,
      appliedConditionNote: targetDraft.appliedConditionNote,
      sourceMarkdownHash: targetDraft.sourceMarkdownHash,
      createdAt: now,
    };
    problems.push(approvedProblem);
  }

  saveStoredProblems(problems);
  return { updatedDrafts, updatedProblems: problems, approvedProblem };
}

export function batchApproveProblemDrafts(draftIds: string[]): {
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedCount: number;
} {
  const drafts = loadStoredProblemDrafts();
  let problems = loadStoredProblems();
  const targetIdsSet = new Set(draftIds);
  const now = new Date().toISOString();

  const updatedDrafts = drafts.map((d) =>
    targetIdsSet.has(d.id)
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: now }
      : d
  );
  saveStoredProblemDrafts(updatedDrafts);

  let approvedCount = 0;
  for (const draftId of draftIds) {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) continue;

    const existingIndex = problems.findIndex((p) => p.draftId === draftId);
    if (existingIndex >= 0) {
      problems[existingIndex] = {
        ...problems[existingIndex],
        title: draft.title,
        type: draft.type,
        difficulty: draft.difficulty,
        promptText: draft.promptText,
        mathFormula: draft.mathFormula,
        codeSnippet: draft.codeSnippet,
        designIntent: draft.designIntent,
        appliedConditionNote: draft.appliedConditionNote,
        timeStandardMinutes: draft.timeStandardMinutes,
        timeBreakdownDesc: draft.timeBreakdownDesc,
        coreEvaluationHighlight: draft.coreEvaluationHighlight,
        itemCountDesc: draft.itemCountDesc,
        hints: draft.hints,
        modelAnswer: draft.modelAnswer,
        rubric: draft.rubric,
        sourceRefs: draft.sourceRefs,
        sourceMarkdownHash: draft.sourceMarkdownHash,
        isApproved: true,
        isDemo: false,
      };
    } else {
      problems.push({
        id: `prob-ai-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        conceptIds: draft.conceptIds,
        subjectId: draft.subjectId,
        title: draft.title,
        type: draft.type,
        categoryLabel: draft.categoryLabel,
        categoryNumber: draft.categoryNumber,
        promptText: draft.promptText,
        mathFormula: draft.mathFormula,
        codeSnippet: draft.codeSnippet,
        timeStandardMinutes: draft.timeStandardMinutes,
        timeBreakdownDesc: draft.timeBreakdownDesc,
        coreEvaluationHighlight: draft.coreEvaluationHighlight,
        itemCountDesc: draft.itemCountDesc,
        sourceRefs: draft.sourceRefs,
        hints: draft.hints,
        modelAnswer: draft.modelAnswer,
        rubric: draft.rubric,
        isDemo: false,
        isApproved: true,
        draftId: draft.id,
        difficulty: draft.difficulty,
        designIntent: draft.designIntent,
        appliedConditionNote: draft.appliedConditionNote,
        sourceMarkdownHash: draft.sourceMarkdownHash,
        createdAt: now,
      });
    }
    approvedCount++;
  }

  saveStoredProblems(problems);
  return { updatedDrafts, updatedProblems: problems, approvedCount };
}

export function loadStoredAttempts(): Attempt[] {
  return safeGetItem<Attempt[]>(STORAGE_KEYS.ATTEMPTS, []);
}

export function saveStoredAttempts(attempts: Attempt[]): void {
  safeSetItem(STORAGE_KEYS.ATTEMPTS, attempts);
}

export function loadStoredSettings(): RetentionModelSettings {
  return safeGetItem<RetentionModelSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_RETENTION_SETTINGS);
}

export function saveStoredSettings(settings: RetentionModelSettings): void {
  safeSetItem(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Resets all user changes back to original academic demo dataset
 */
export function resetToInitialDemoData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.CURRENT_SUBJECT_ID);
  localStorage.removeItem(STORAGE_KEYS.SUBJECTS);
  localStorage.removeItem(STORAGE_KEYS.MATERIALS);
  localStorage.removeItem(STORAGE_KEYS.CONCEPTS);
  localStorage.removeItem(STORAGE_KEYS.CONCEPT_DRAFTS);
  localStorage.removeItem(STORAGE_KEYS.PROBLEMS);
  localStorage.removeItem(STORAGE_KEYS.PROBLEM_DRAFTS);
  localStorage.removeItem(STORAGE_KEYS.ATTEMPTS);
  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
}

/**
 * Adds an attempt and automatically creates a new ReviewEvent on the concept,
 * recalculating its retention score and status dynamically.
 */
export function recordAttemptAndUpdateConcept(
  attempt: Attempt,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS
): { updatedConcepts: Concept[]; updatedAttempts: Attempt[] } {
  const currentConcepts = loadStoredConcepts();
  const currentAttempts = loadStoredAttempts();

  const newAttempts = [attempt, ...currentAttempts];
  saveStoredAttempts(newAttempts);

  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== attempt.conceptId) return c;

    const newEvent: ReviewEvent = {
      id: `ev-${Date.now()}`,
      conceptId: c.id,
      at: attempt.at,
      dayOffset: 0, // Recorded today
      kind: 'attempt',
      title: `복습 제출 (${attempt.calculatedScore}점)`,
      resultScore: attempt.calculatedScore,
      confidence: attempt.confidence,
      errorType: attempt.errorType,
      hintCount: attempt.hintCount,
      notes: attempt.reasoningNotes,
      sourceRef: c.chapterRef,
      evaluationSummary: attempt.evaluatorFeedback,
      rubricScores: attempt.rubricResults,
    };

    const updatedEvents = [...c.events, newEvent];
    const newCurrentScore = calculateCurrentConceptScore(updatedEvents, settings, 0);
    const newStatus = getConceptStatusFromScore(newCurrentScore);

    return {
      ...c,
      events: updatedEvents,
      lastAttemptAt: attempt.at,
      lastAttemptDayOffset: 0,
      currentScore: newCurrentScore,
      status: newStatus,
      exerciseCount: c.exerciseCount + 1,
    };
  });

  saveStoredConcepts(updatedConcepts);
  return { updatedConcepts, updatedAttempts: newAttempts };
}
