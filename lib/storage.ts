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
  ProblemReport,
  ProblemReportType,
  ProblemQualityStatus,
  ProblemVersionSnapshot,
  StudyPlanSettings,
  StudyPlanItem,
  DEFAULT_STUDY_PLAN_SETTINGS,
  PersonalizationSettings,
  PersonalizationCorrectionState,
  DEFAULT_PERSONALIZATION_SETTINGS,
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
import { addDaysToDate } from './dateUtils';
import { computeMarkdownHash } from './markdownUtils';
import { completeRechallengeReservation } from './logicSession';

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
  STUDY_PLAN_SETTINGS: 'redcall_study_plan_settings_v1',
  STUDY_PLAN_ITEMS: 'redcall_study_plan_items_v1',
  PERSONALIZATION_SETTINGS: 'redcall_personalization_settings_v1',
  PERSONALIZATION_STATE: 'redcall_personalization_state_v1',
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
    const rest: Material = { ...m };
    delete rest.pages;
    delete rest.rawText;
    return rest;
  });
  safeSetItem(STORAGE_KEYS.MATERIALS, lightMaterials);
}

export function loadStoredConcepts(referenceDate: Date = new Date()): Concept[] {
  const loaded = safeGetItem<Concept[]>(STORAGE_KEYS.CONCEPTS, INITIAL_CONCEPTS);
  const settings = safeGetItem<RetentionModelSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_RETENTION_SETTINGS);

  return loaded.map((c) => {
    const isDemo = c.isDemo ?? (c.id.startsWith('c-econ') || c.id.startsWith('c-cs'));
    const isLearned = c.isLearned ?? isDemo;
    const isUnstudied = c.status === 'unstudied' || (!isLearned && (!c.events || c.events.length === 0));

    if (isUnstudied) {
      return {
        ...c,
        status: 'unstudied' as ConceptStatus,
        baseScore: 0,
        currentScore: 0,
        events: c.events || [],
        isDemo,
        isLearned: false,
        postponeDays: c.postponeDays ?? 0,
      };
    }

    // Dynamic model score recalculation using actual timestamps and elapsed time
    const dynamicScore = calculateCurrentConceptScore(c.events, settings, referenceDate);
    const dynamicStatus = getConceptStatusFromScore(dynamicScore);

    return {
      ...c,
      status: dynamicStatus,
      currentScore: dynamicScore,
      isDemo,
      isLearned: true,
      postponeDays: c.postponeDays ?? 0,
    };
  });
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
  const concepts = loadStoredConcepts();
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
  // Legacy migration: recover transfer linkage ONLY when the original draft can
  // still be resolved by draftId. Never infer a source/session.
  const drafts = loadStoredProblemDrafts();
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  return raw.map((p) => {
    const base: Problem = {
      ...p,
      isDemo: p.isDemo ?? true,
      isApproved: p.isApproved ?? true,
      qualityStatus: p.qualityStatus ?? 'normal',
      version: p.version ?? 1,
      reports: p.reports ?? [],
      versionHistory: p.versionHistory ?? [],
    };
    if (base.isTransfer === undefined && base.draftId) {
      const draft = draftById.get(base.draftId);
      if (draft?.isTransfer === true) {
        base.isTransfer = true;
        base.sourceProblemId = draft.sourceProblemId;
        base.logicSessionId = draft.logicSessionId;
        base.transferChanges = draft.transferChanges;
        base.understandingFocus = draft.understandingFocus;
        base.transferKind = draft.transferKind;
        base.originalCondition = draft.originalCondition;
        base.newCondition = draft.newCondition;
      }
    }
    return base;
  });
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

/**
 * Single conversion path from an approved draft to a stored Problem. Guarantees
 * that every approval route preserves the SAME fields, including transfer linkage
 * (isTransfer / sourceProblemId / logicSessionId / structured condition change).
 */
export function buildProblemFromDraft(
  draft: ProblemDraft,
  existing: Problem | undefined,
  now: string
): Problem {
  const derived: Omit<Problem, 'id' | 'createdAt' | 'version' | 'qualityStatus' | 'reports' | 'versionHistory'> = {
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
    sourceMaterials: draft.sourceMaterials,
    // Transfer linkage (explicitly assigned so stale values never linger).
    isTransfer: draft.isTransfer,
    sourceProblemId: draft.sourceProblemId,
    logicSessionId: draft.logicSessionId,
    transferChanges: draft.transferChanges,
    understandingFocus: draft.understandingFocus,
    transferKind: draft.transferKind,
    originalCondition: draft.originalCondition,
    newCondition: draft.newCondition,
  };

  if (existing) {
    // A re-approval that changes evaluation-affecting content is a NEW version
    // with an archived snapshot; an identical re-approval keeps the version.
    const signature = (p: {
      title: string;
      promptText: string;
      mathFormula?: string;
      codeSnippet?: string;
      hints: string[];
      modelAnswer: string;
      rubric: Problem['rubric'];
      timeStandardMinutes: number;
      appliedConditionNote?: string;
      designIntent?: string;
    }) =>
      JSON.stringify([
        p.title,
        p.promptText,
        p.mathFormula || '',
        p.codeSnippet || '',
        p.hints || [],
        p.modelAnswer,
        p.rubric || [],
        p.timeStandardMinutes,
        p.appliedConditionNote || '',
        p.designIntent || '',
      ]);

    const contentChanged = signature(existing) !== signature(derived);

    if (contentChanged) {
      const currentVersion = existing.version || 1;
      const snapshot: ProblemVersionSnapshot = {
        version: currentVersion,
        title: existing.title,
        promptText: existing.promptText,
        mathFormula: existing.mathFormula,
        codeSnippet: existing.codeSnippet,
        timeStandardMinutes: existing.timeStandardMinutes,
        hints: [...(existing.hints || [])],
        modelAnswer: existing.modelAnswer,
        rubric: [...(existing.rubric || [])],
        editedAt: now,
        editReason: '재승인 시 내용 변경',
      };
      return {
        ...existing,
        ...derived,
        qualityStatus: 'reapproved',
        version: currentVersion + 1,
        reports: existing.reports || [],
        versionHistory: [snapshot, ...(existing.versionHistory || [])],
        lastReviewedAt: now,
      };
    }

    return {
      ...existing,
      ...derived,
      qualityStatus: existing.qualityStatus || 'normal',
      version: existing.version || 1,
      reports: existing.reports || [],
      versionHistory: existing.versionHistory || [],
    };
  }

  return {
    ...derived,
    // Stable id derived from the draft id: a retry after a partial save never
    // creates a duplicate problem.
    id: `prob-ai-${draft.id}`,
    createdAt: now,
    version: 1,
    qualityStatus: 'normal',
    reports: [],
    versionHistory: [],
  };
}

/**
 * Approves a draft, but only marks the draft approved AFTER verifying the Problem
 * actually persisted. A failed problem save returns success=false and leaves the
 * draft unapproved so it can be retried (idempotently, via the stable problem id).
 */
export function approveProblemDraft(draftId: string): {
  success: boolean;
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedProblem: Problem | null;
  error?: string;
} {
  const drafts = loadStoredProblemDrafts();
  const problems = loadStoredProblems();

  const targetDraft = drafts.find((d) => d.id === draftId);
  if (!targetDraft) {
    return { success: false, updatedDrafts: drafts, updatedProblems: problems, approvedProblem: null, error: '초안을 찾을 수 없습니다.' };
  }

  const now = new Date().toISOString();
  const existingIndex = problems.findIndex((p) => p.draftId === draftId);
  const existing = existingIndex >= 0 ? problems[existingIndex] : undefined;
  const approvedProblem = buildProblemFromDraft(targetDraft, existing, now);
  const nextProblems = existingIndex >= 0
    ? problems.map((p, i) => (i === existingIndex ? approvedProblem : p))
    : [...problems, approvedProblem];

  saveStoredProblems(nextProblems);

  // Verify the problem is really persisted before declaring success.
  const persisted = loadStoredProblems().find(
    (p) => p.id === approvedProblem.id && p.draftId === draftId
  );
  if (!persisted) {
    return {
      success: false,
      updatedDrafts: drafts,
      updatedProblems: problems,
      approvedProblem: null,
      error: '문제 저장에 실패했습니다. 초안은 승인되지 않았으며 다시 시도할 수 있습니다.',
    };
  }

  const updatedDrafts = drafts.map((d) =>
    d.id === draftId
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: now }
      : d
  );
  saveStoredProblemDrafts(updatedDrafts);
  return { success: true, updatedDrafts, updatedProblems: nextProblems, approvedProblem: persisted };
}

export interface BatchApproveItemResult {
  draftId: string;
  status: 'approved' | 'failed' | 'skipped';
  error?: string;
}

export function batchApproveProblemDrafts(draftIds: string[]): {
  updatedDrafts: ProblemDraft[];
  updatedProblems: Problem[];
  approvedCount: number;
  results: BatchApproveItemResult[];
} {
  const drafts = loadStoredProblemDrafts();
  let problems = loadStoredProblems();
  const now = new Date().toISOString();
  const results: BatchApproveItemResult[] = [];
  const approvedIds = new Set<string>();

  for (const draftId of draftIds) {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) {
      results.push({ draftId, status: 'skipped', error: '초안을 찾을 수 없습니다.' });
      continue;
    }
    const existingIndex = problems.findIndex((p) => p.draftId === draftId);
    const existing = existingIndex >= 0 ? problems[existingIndex] : undefined;
    const approvedProblem = buildProblemFromDraft(draft, existing, now);
    problems = existingIndex >= 0
      ? problems.map((p, i) => (i === existingIndex ? approvedProblem : p))
      : [...problems, approvedProblem];

    saveStoredProblems(problems);

    const persisted = loadStoredProblems().some(
      (p) => p.id === approvedProblem.id && p.draftId === draftId
    );
    if (!persisted) {
      results.push({ draftId, status: 'failed', error: '문제 저장에 실패했습니다.' });
      continue;
    }
    approvedIds.add(draftId);
    results.push({ draftId, status: 'approved' });
  }

  const updatedDrafts = drafts.map((d) =>
    approvedIds.has(d.id)
      ? { ...d, isApproved: true, status: 'approved' as const, updatedAt: now }
      : d
  );
  saveStoredProblemDrafts(updatedDrafts);

  return { updatedDrafts, updatedProblems: problems, approvedCount: approvedIds.size, results };
}

// Stage 6: Problem Quality, Reporting, Versioning & Review Operations

/**
 * Submits an error report for a problem.
 * Quarantines problem by transitioning qualityStatus to 'reported',
 * excluding it from future practice/mock exams until re-approved.
 * Guards against rapid duplicate submissions by the same user.
 */
export function reportProblemError(
  problemId: string,
  reportData: {
    attemptId?: string;
    type: ProblemReportType;
    details: string;
  }
): {
  success: boolean;
  reportId?: string;
  updatedProblems: Problem[];
  newReport: ProblemReport | null;
  error?: string;
} {
  const problems = loadStoredProblems();
  const targetProblem = problems.find((p) => p.id === problemId);

  if (!targetProblem) {
    return { success: false, updatedProblems: problems, newReport: null, error: '신고 대상 문제를 찾을 수 없습니다.' };
  }

  const trimmedDetails = reportData.details.trim();
  if (!trimmedDetails) {
    return { success: false, updatedProblems: problems, newReport: null, error: '신고 사유 및 상세 내용을 입력해 주세요.' };
  }

  const now = new Date();
  const existingReports = targetProblem.reports || [];

  // Debounce & duplicate prevention: identical report within 15 seconds
  const recentDuplicate = existingReports.find((r) => {
    if (r.type !== reportData.type) return false;
    if (r.status === 'dismissed' || r.status === 'resolved') return false;
    const timeDiffMs = Math.abs(now.getTime() - new Date(r.createdAt).getTime());
    return timeDiffMs < 15000 && r.details.trim() === trimmedDetails;
  });

  if (recentDuplicate) {
    return {
      success: false,
      updatedProblems: problems,
      newReport: null,
      error: '동일한 내용의 신고가 방금 접수되었습니다. 잠시 후 다시 확인해 주세요.',
    };
  }

  const newReport: ProblemReport = {
    id: `rep-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    problemId,
    attemptId: reportData.attemptId,
    type: reportData.type,
    details: trimmedDetails,
    createdAt: now.toISOString(),
    status: 'open',
  };

  const updatedReports = [newReport, ...existingReports];

  // Exclude from new practice: transition to 'reported' unless already 'under_review'
  const nextStatus: ProblemQualityStatus =
    targetProblem.qualityStatus === 'under_review' ? 'under_review' : 'reported';

  const updatedProblem: Problem = {
    ...targetProblem,
    reports: updatedReports,
    qualityStatus: nextStatus,
    lastReviewedAt: now.toISOString(),
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);

  return { success: true, reportId: newReport.id, updatedProblems, newReport };
}

/**
 * Updates the problem's quality review status ('normal' | 'reported' | 'under_review' | 'review_after_edit' | 'reapproved' | 'suspended')
 */
export function updateProblemQualityStatus(
  problemId: string,
  newStatus: ProblemQualityStatus,
  note?: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };

  const now = new Date().toISOString();
  const updatedReports = (target.reports || []).map((r) => {
    if (newStatus === 'under_review' && r.status === 'open') {
      return { ...r, status: 'under_review' as const };
    }
    return r;
  });

  const updatedProblem: Problem = {
    ...target,
    qualityStatus: newStatus,
    reports: updatedReports,
    lastReviewedAt: now,
    reviewNotes: note !== undefined ? note : target.reviewNotes,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Dismisses a report with a documented reason.
 * If all reports are resolved/dismissed, problem is restored to practice circulation ('normal' or 'reapproved').
 */
export function dismissProblemReport(
  problemId: string,
  reportId: string,
  dismissReason: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  const trimmedReason = dismissReason.trim();
  if (!trimmedReason) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '신고 기각 사유를 반드시 작성해야 합니다.' };
  }

  const now = new Date().toISOString();
  let foundReport = false;
  const updatedReports = (target.reports || []).map((r) => {
    if (r.id === reportId) {
      foundReport = true;
      return {
        ...r,
        status: 'dismissed' as const,
        resolutionNote: trimmedReason,
        resolvedAt: now,
      };
    }
    return r;
  });

  if (!foundReport) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '해당 신고 내역을 찾을 수 없습니다.' };
  }

  // Check if any open or under_review reports remain
  const hasRemainingOpenReports = updatedReports.some(
    (r) => r.status === 'open' || r.status === 'under_review'
  );

  const restoredStatus: ProblemQualityStatus = hasRemainingOpenReports
    ? target.qualityStatus || 'reported'
    : (target.version && target.version > 1 ? 'reapproved' : 'normal');

  const updatedProblem: Problem = {
    ...target,
    reports: updatedReports,
    qualityStatus: restoredStatus,
    lastReviewedAt: now,
    reviewNotes: `신고 #${reportId} 기각 처리: ${trimmedReason}`,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Edits problem content, archiving current version into versionHistory and incrementing version number.
 * Sets qualityStatus to 'review_after_edit' pending re-approval.
 */
export function editAndReviseProblem(
  problemId: string,
  updates: Partial<Problem>,
  editReason: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  const trimmedReason = editReason.trim();
  if (!trimmedReason) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '수정 사유 및 변경 내용을 입력해 주세요.' };
  }

  const currentVersion = target.version || 1;
  const snapshot: ProblemVersionSnapshot = {
    version: currentVersion,
    title: target.title,
    promptText: target.promptText,
    mathFormula: target.mathFormula,
    codeSnippet: target.codeSnippet,
    timeStandardMinutes: target.timeStandardMinutes,
    hints: [...target.hints],
    modelAnswer: target.modelAnswer,
    rubric: [...target.rubric],
    editedAt: new Date().toISOString(),
    editReason: trimmedReason,
  };

  const nextVersion = currentVersion + 1;
  const now = new Date().toISOString();

  const updatedProblem: Problem = {
    ...target,
    ...updates,
    version: nextVersion,
    versionHistory: [snapshot, ...(target.versionHistory || [])],
    qualityStatus: 'review_after_edit',
    lastReviewedAt: now,
    reviewNotes: `v${nextVersion} 수정 완료: ${trimmedReason}`,
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Re-approves a problem after quality review and/or edits, verifying mandatory 100-point rubric and required fields.
 * Restores problem to practice availability with status 'reapproved'.
 */
export function reapproveProblem(
  problemId: string,
  reapprovalNote?: string,
  currentMaterials?: Material[]
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };
  }

  // Strict verification rules before re-approval
  if (!target.promptText || !target.promptText.trim()) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제 지문이 비어 있어 재승인할 수 없습니다.' };
  }
  if (!target.modelAnswer || !target.modelAnswer.trim()) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '모범 답안이 누락되어 재승인할 수 없습니다.' };
  }
  if (!target.rubric || target.rubric.length === 0) {
    return { success: false, updatedProblems: problems, updatedProblem: null, error: '채점 기준(루브릭)이 비어 있어 재승인할 수 없습니다.' };
  }
  const rubricSum = target.rubric.reduce((sum, r) => sum + (Number(r.maxScore) || 0), 0);
  if (Math.abs(rubricSum - 100) > 0.001) {
    return {
      success: false,
      updatedProblems: problems,
      updatedProblem: null,
      error: `루브릭 배점 합계가 100점이 아닙니다. (현재 합계: ${rubricSum}점)`,
    };
  }

  const now = new Date().toISOString();
  // Mark all unresolved reports as resolved
  const updatedReports = (target.reports || []).map((r) => {
    if (r.status === 'open' || r.status === 'under_review') {
      return {
        ...r,
        status: 'resolved' as const,
        resolutionNote: reapprovalNote || '문제 검토 및 수정/보완 완료 후 사용자 재승인',
        resolvedAt: now,
      };
    }
    return r;
  });

  // Record the source versions the user confirmed, so re-saving the SAME source
  // content does not immediately re-flag the problem as outdated.
  const refreshedSourceMaterials = currentMaterials
    ? target.sourceMaterials?.map((ref) => {
        const material = currentMaterials.find((m) => m.id === ref.materialId);
        if (!material) return ref;
        return {
          ...ref,
          title: material.title,
          markdownHash: computeMarkdownHash(material.parsedMarkdown || ''),
        };
      })
    : target.sourceMaterials;

  const updatedProblem: Problem = {
    ...target,
    reports: updatedReports,
    qualityStatus: 'reapproved',
    sourceMaterials: refreshedSourceMaterials,
    // Explicit user re-approval clears the outdated/review flags so the problem
    // is not permanently excluded from circulation.
    isOutdated: false,
    needsSourceReview: false,
    lastReviewedAt: now,
    reviewNotes: reapprovalNote || '품질 검증 통과 및 재승인 완료 (출제 가능 복귀)',
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

/**
 * Suspends problem from circulation if it cannot be salvaged or has fatal academic flaws.
 */
export function suspendProblem(
  problemId: string,
  suspensionReason?: string
): { success: boolean; updatedProblems: Problem[]; updatedProblem: Problem | null; error?: string } {
  const problems = loadStoredProblems();
  const target = problems.find((p) => p.id === problemId);
  if (!target) return { success: false, updatedProblems: problems, updatedProblem: null, error: '문제를 찾을 수 없습니다.' };

  const now = new Date().toISOString();
  const updatedProblem: Problem = {
    ...target,
    qualityStatus: 'suspended',
    lastReviewedAt: now,
    reviewNotes: suspensionReason || '품질 기준 미달로 사용 중지',
  };

  const updatedProblems = problems.map((p) => (p.id === problemId ? updatedProblem : p));
  saveStoredProblems(updatedProblems);
  return { success: true, updatedProblems, updatedProblem };
}

export function loadStoredAttempts(): Attempt[] {
  const raw = safeGetItem<Attempt[]>(STORAGE_KEYS.ATTEMPTS, []);
  return raw.map((a) => ({
    ...a,
    problemVersion: a.problemVersion ?? 1,
  }));
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
  localStorage.removeItem('redcall_mock_exam_sessions_v1');
  localStorage.removeItem(STORAGE_KEYS.SETTINGS);
  localStorage.removeItem(STORAGE_KEYS.STUDY_PLAN_SETTINGS);
  localStorage.removeItem(STORAGE_KEYS.STUDY_PLAN_ITEMS);
  localStorage.removeItem(STORAGE_KEYS.PERSONALIZATION_SETTINGS);
  localStorage.removeItem(STORAGE_KEYS.PERSONALIZATION_STATE);
  localStorage.removeItem('redcall_logic_sessions_v1');
  localStorage.removeItem('redcall_rechallenge_reservations_v1');
}

// Stage 10: Personal review recommendation settings & correction state
export function loadStoredPersonalizationSettings(): PersonalizationSettings {
  const loaded = safeGetItem<Partial<PersonalizationSettings>>(
    STORAGE_KEYS.PERSONALIZATION_SETTINGS,
    DEFAULT_PERSONALIZATION_SETTINGS
  );
  return {
    enabled: loaded.enabled ?? DEFAULT_PERSONALIZATION_SETTINGS.enabled,
    tendency: loaded.tendency ?? DEFAULT_PERSONALIZATION_SETTINGS.tendency,
    autoAdjust: loaded.autoAdjust ?? DEFAULT_PERSONALIZATION_SETTINGS.autoAdjust,
    updatedAt: loaded.updatedAt ?? DEFAULT_PERSONALIZATION_SETTINGS.updatedAt,
  };
}

export function saveStoredPersonalizationSettings(settings: PersonalizationSettings): void {
  safeSetItem(STORAGE_KEYS.PERSONALIZATION_SETTINGS, settings);
}

export function loadStoredPersonalizationState(): PersonalizationCorrectionState | null {
  return safeGetItem<PersonalizationCorrectionState | null>(STORAGE_KEYS.PERSONALIZATION_STATE, null);
}

export function saveStoredPersonalizationState(state: PersonalizationCorrectionState): void {
  safeSetItem(STORAGE_KEYS.PERSONALIZATION_STATE, state);
}

// Stage 9: Study Plan Storage Operations
export function loadStoredStudyPlanSettings(): StudyPlanSettings {
  return safeGetItem<StudyPlanSettings>(STORAGE_KEYS.STUDY_PLAN_SETTINGS, DEFAULT_STUDY_PLAN_SETTINGS);
}

export function saveStoredStudyPlanSettings(settings: StudyPlanSettings): void {
  safeSetItem(STORAGE_KEYS.STUDY_PLAN_SETTINGS, settings);
}

export function loadStoredStudyPlanItems(): StudyPlanItem[] {
  return safeGetItem<StudyPlanItem[]>(STORAGE_KEYS.STUDY_PLAN_ITEMS, []);
}

export function saveStoredStudyPlanItems(items: StudyPlanItem[]): void {
  safeSetItem(STORAGE_KEYS.STUDY_PLAN_ITEMS, items);
}

export function markStudyPlanItemCompleted(
  itemId: string,
  linkage: { attemptId?: string; eventId?: string; mockSessionId?: string }
): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const now = new Date().toISOString();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          status: 'completed' as const,
          completedAt: now,
          completedAttemptId: linkage.attemptId || i.completedAttemptId,
          completedEventId: linkage.eventId || i.completedEventId,
          completedMockSessionId: linkage.mockSessionId || i.completedMockSessionId,
        }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

export function postponeStudyPlanItem(itemId: string, nextDate: string): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          status: 'postponed' as const,
          assignedDate: nextDate,
        }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

export function skipStudyPlanItem(itemId: string): StudyPlanItem[] {
  const items = loadStoredStudyPlanItems();
  const updated = items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          status: 'skipped' as const,
        }
      : i
  );
  saveStoredStudyPlanItems(updated);
  return updated;
}

/** 계획 연결 결과 (호출자가 부분 실패를 인지할 수 있도록 노출) */
export interface PlanLinkageResult {
  /** 계획 연결을 시도했는지 여부 */
  attempted: boolean;
  /** 연결 대상으로 선택된 계획 항목 ID */
  linkedItemId: string | null;
  /** 계획 항목 완료가 저장·검증되었는지 여부 */
  persisted: boolean;
  /** 연결을 건너뛴 사유 (없으면 undefined) */
  skippedReason?:
    | 'PLAN_ITEM_NOT_FOUND'
    | 'PLAN_ITEM_MISMATCH'
    | 'PLAN_ITEM_SKIPPED'
    | 'PLAN_ITEM_COMPLETED_BY_OTHER'
    | 'NO_MATCHING_ITEM';
  /** 완료 충돌 시 기존 완료 기록의 Attempt ID */
  conflictWithAttemptId?: string;
}

export type AttemptSaveStatus =
  | 'complete'           // 전체 완료
  | 'retryable_failure'  // 저장 실패: 같은 Attempt로 재시도 가능
  | 'link_conflict'      // 계획·예약 연결 충돌 (대상이 다른 기록으로 완료됨/불일치)
  | 'target_missing'     // 대상 삭제·취소·없음
  | 'already_completed'; // 동일 Attempt의 재시도 (이미 완료)

export interface AttemptSaveResult {
  updatedConcepts: Concept[];
  updatedAttempts: Attempt[];
  /** 재시도가 필요한(또는 충돌/대상 없음) 경우 true. complete/already_completed는 false. */
  partial: boolean;
  status: AttemptSaveStatus;
  /** Attempt가 실제 저장·검증되었는지 */
  attemptPersisted: boolean;
  /** ReviewEvent가 실제 저장·검증되었는지 */
  eventPersisted: boolean;
  /** 호출부에 표시할 안내 문구 */
  message?: string;
  planLinkage: PlanLinkageResult;
}

/**
 * Adds an attempt and automatically creates a new ReviewEvent on the concept,
 * recalculating its retention score and status dynamically without artificial duplicates.
 * Also links the attempt to the matching StudyPlanItem of the SAME subject, concept,
 * problem, and review round — never completing a different concept's plan merely
 * because a shared (composite) problem was solved.
 *
 * Callers can pass an explicit `planItemId` to link the exact executed plan item;
 * the id is still validated against the attempt.
 */
export function recordAttemptAndUpdateConcept(
  attempt: Attempt,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  linkage?: { planItemId?: string }
): AttemptSaveResult {
  const currentConcepts = loadStoredConcepts();
  const currentAttempts = loadStoredAttempts();

  const alreadyAttemptStored = currentAttempts.some((a) => a.id === attempt.id);
  // Recovery must use the STORED record, not a possibly different retry payload,
  // so a recovered event can never disagree with the saved Attempt's score.
  const effectiveAttempt = alreadyAttemptStored
    ? currentAttempts.find((a) => a.id === attempt.id) ?? attempt
    : attempt;

  const targetConcept = currentConcepts.find(
    (c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId
  );
  if (!targetConcept) {
    throw new Error('풀이 기록의 개념과 과목이 일치하지 않습니다.');
  }

  const alreadyEventStored = targetConcept.events.some((e) => e.attemptId === effectiveAttempt.id);

  // Persist the Attempt if it is missing (idempotent).
  const newAttempts = alreadyAttemptStored ? currentAttempts : [effectiveAttempt, ...currentAttempts];
  if (!alreadyAttemptStored) {
    saveStoredAttempts(newAttempts);
  }

  // Stage 9: link the StudyPlanItem for THIS review round only.
  // The attempt round is derived from the concept's own review history so that a
  // retry (event already stored) still resolves the correct round instead of
  // skipping ahead to a future round.
  const conceptRounds = targetConcept.events
    .filter((e) => e.kind === 'attempt' || e.kind === 'review')
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const existingEventIndex = conceptRounds.findIndex((e) => e.attemptId === effectiveAttempt.id);
  const attemptRound = existingEventIndex >= 0 ? existingEventIndex + 1 : conceptRounds.length + 1;

  const currentPlanItems = loadStoredStudyPlanItems();
  const planLinkage: PlanLinkageResult = {
    attempted: true,
    linkedItemId: null,
    persisted: false,
  };

  let matchingPlanItem: StudyPlanItem | undefined;

  if (linkage?.planItemId) {
    // Explicit link: still validate every dimension of the target item.
    const byId = currentPlanItems.find((i) => i.id === linkage.planItemId);
    if (!byId) {
      planLinkage.skippedReason = 'PLAN_ITEM_NOT_FOUND';
    } else if (byId.status === 'skipped') {
      planLinkage.skippedReason = 'PLAN_ITEM_SKIPPED';
    } else if (
      byId.subjectId !== effectiveAttempt.subjectId ||
      (byId.conceptId !== undefined && byId.conceptId !== effectiveAttempt.conceptId) ||
      (byId.problemId !== undefined && byId.problemId !== effectiveAttempt.problemId)
    ) {
      planLinkage.skippedReason = 'PLAN_ITEM_MISMATCH';
    } else if (byId.status === 'completed') {
      // Same attempt retry is idempotent success; a different attempt must never
      // overwrite the existing completion history. (Round is ignored here because
      // the stored completion already represents this round.)
      if (byId.completedAttemptId === effectiveAttempt.id) {
        matchingPlanItem = byId;
      } else {
        planLinkage.skippedReason = 'PLAN_ITEM_COMPLETED_BY_OTHER';
        planLinkage.conflictWithAttemptId = byId.completedAttemptId;
      }
    } else if (byId.round !== undefined && byId.round !== attemptRound) {
      planLinkage.skippedReason = 'PLAN_ITEM_MISMATCH';
    } else {
      matchingPlanItem = byId;
    }
  } else {
    // Implicit link: require subject + concept + problem + round to agree.
    // Legacy items that omit conceptId/round are handled by the validated fallback below.
    matchingPlanItem = currentPlanItems.find((i) => {
      if (i.status === 'completed' || i.status === 'skipped') return false;
      if (i.subjectId !== effectiveAttempt.subjectId) return false;
      if (i.problemId !== effectiveAttempt.problemId) return false;
      // A plan item that names a concept must match the attempt's concept.
      if (i.conceptId !== undefined && i.conceptId !== effectiveAttempt.conceptId) return false;
      // A plan item that names a round must match this attempt's round.
      if (i.round !== undefined && i.round !== attemptRound) return false;
      // Legacy fallback (no concept, no round): only accept when the item's concept
      // scope is absent or explicitly includes the attempt's concept.
      if (
        i.conceptId === undefined &&
        i.round === undefined &&
        Array.isArray(i.conceptIds) &&
        i.conceptIds.length > 0 &&
        !i.conceptIds.includes(effectiveAttempt.conceptId)
      ) {
        return false;
      }
      return true;
    });
    if (!matchingPlanItem) {
      planLinkage.skippedReason = 'NO_MATCHING_ITEM';
    }
  }

  if (matchingPlanItem) {
    const targetId = matchingPlanItem.id;
    const updatedPlanItems = currentPlanItems.map((i) =>
      i.id === targetId
        ? {
            ...i,
            status: 'completed' as const,
            completedAt: effectiveAttempt.at,
            completedAttemptId: effectiveAttempt.id,
          }
        : i
    );
    saveStoredStudyPlanItems(updatedPlanItems);
    const persistedItem = loadStoredStudyPlanItems().find((i) => i.id === targetId);
    planLinkage.linkedItemId = targetId;
    planLinkage.persisted =
      persistedItem?.status === 'completed' &&
      persistedItem?.completedAttemptId === effectiveAttempt.id;
  }

  const updatedConcepts = currentConcepts.map((c) => {
    // Only update the primary concept connected to this attempt
    if (c.id !== effectiveAttempt.conceptId || c.subjectId !== effectiveAttempt.subjectId) return c;
    // Never append a duplicate event for the same Attempt.
    if (alreadyEventStored) return c;

    const newEvent: ReviewEvent = {
      id: `ev-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptId: c.id,
      at: effectiveAttempt.at,
      dayOffset: 0, // Recorded today
      kind: 'attempt',
      title: `풀이 제출 (${effectiveAttempt.calculatedScore}점)`,
      resultScore: effectiveAttempt.calculatedScore,
      confidence: effectiveAttempt.confidence,
      errorType: effectiveAttempt.errorType,
      hintCount: effectiveAttempt.hintCount,
      notes: effectiveAttempt.reasoningNotes,
      sourceRef: c.chapterRef,
      evaluationSummary: effectiveAttempt.evaluatorFeedback,
      rubricScores: effectiveAttempt.rubricResults,
      attemptId: effectiveAttempt.id,
      strengths: effectiveAttempt.strengths,
      criticalImprovements: effectiveAttempt.criticalImprovements,
      needsReview: effectiveAttempt.needsReview,
    };

    const updatedEvents = [...c.events, newEvent];
    const newCurrentScore = calculateCurrentConceptScore(updatedEvents, settings, new Date(effectiveAttempt.at));
    const newStatus = getConceptStatusFromScore(newCurrentScore);

    return {
      ...c,
      events: updatedEvents,
      lastAttemptAt: effectiveAttempt.at,
      lastAttemptDayOffset: 0,
      firstLearnedAt: c.firstLearnedAt || effectiveAttempt.at,
      firstLearnedDayOffset: c.firstLearnedDayOffset ?? 0,
      isLearned: true,
      baseScore: c.baseScore > 0 ? c.baseScore : effectiveAttempt.calculatedScore,
      currentScore: newCurrentScore,
      status: newStatus,
      exerciseCount: c.exerciseCount + 1,
      postponeDays: 0, // Reset postponement upon active confirmed review
      postponedUntil: undefined,
    };
  });

  saveStoredConcepts(updatedConcepts);

  // Read-back verification: report partial persistence instead of a false success.
  const attemptPersisted = loadStoredAttempts().some((a) => a.id === effectiveAttempt.id);
  const eventPersisted =
    loadStoredConcepts()
      .find((c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId)
      ?.events.some((e) => e.attemptId === effectiveAttempt.id) === true;

  // Classify the outcome so callers can react precisely (retry vs resolve vs keep).
  let status: AttemptSaveStatus;
  let message: string | undefined;

  if (!attemptPersisted || !eventPersisted) {
    status = 'retryable_failure';
    message = '풀이 기록 저장이 일부만 완료되었습니다. 같은 기록으로 다시 시도하면 누락분이 복구됩니다.';
  } else if (planLinkage.skippedReason === 'PLAN_ITEM_COMPLETED_BY_OTHER') {
    status = 'link_conflict';
    message = '이 계획은 이미 다른 풀이 기록으로 완료되었습니다. 기존 완료 기록을 유지하고 이 풀이는 계획 연결 없이 보존할 수 있습니다.';
  } else if (planLinkage.skippedReason === 'PLAN_ITEM_MISMATCH') {
    status = 'link_conflict';
    message = '계획 항목이 현재 풀이와 일치하지 않습니다. 올바른 계획을 선택하거나 계획 연결 없이 기록을 보존하세요.';
  } else if (
    planLinkage.skippedReason === 'PLAN_ITEM_NOT_FOUND' ||
    planLinkage.skippedReason === 'PLAN_ITEM_SKIPPED'
  ) {
    status = 'target_missing';
    message = '연결하려던 계획 항목을 사용할 수 없습니다(삭제·건너뜀). 계획 연결 없이 기록을 보존할 수 있습니다.';
  } else if (matchingPlanItem !== undefined && !planLinkage.persisted) {
    status = 'retryable_failure';
    message = '계획 완료 반영 저장에 실패했습니다. 같은 기록으로 다시 시도해 주세요.';
  } else if (
    alreadyAttemptStored &&
    alreadyEventStored &&
    (!linkage?.planItemId || planLinkage.persisted)
  ) {
    status = 'already_completed';
    message = '이미 기록된 풀이입니다.';
  } else {
    status = 'complete';
  }

  const partial = status !== 'complete' && status !== 'already_completed';

  return {
    updatedConcepts,
    updatedAttempts: newAttempts,
    partial,
    status,
    attemptPersisted,
    eventPersisted,
    message,
    planLinkage,
  };
}

/**
 * Stage 13: Records an ASSISTED revision answer as a separate Attempt + an
 * `assisted_revision` event. The event is excluded from confirmed retention
 * events, so it never extends the recommended interval or counts as an
 * independent review. The original Attempt is never modified.
 */
export function recordAssistedRevisionAttempt(
  attempt: Attempt
): { updatedConcepts: Concept[]; updatedAttempts: Attempt[] } {
  const currentConcepts = loadStoredConcepts();
  const currentAttempts = loadStoredAttempts();

  const alreadyAttemptStored = currentAttempts.some((a) => a.id === attempt.id);
  const effectiveAttempt = alreadyAttemptStored
    ? currentAttempts.find((a) => a.id === attempt.id) ?? attempt
    : attempt;

  const targetConcept = currentConcepts.find(
    (c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId
  );
  if (!targetConcept) {
    throw new Error('보완 답안의 개념과 과목이 일치하지 않습니다.');
  }

  const alreadyEventStored = targetConcept.events.some((e) => e.attemptId === effectiveAttempt.id);
  if (alreadyAttemptStored && alreadyEventStored) {
    return { updatedConcepts: currentConcepts, updatedAttempts: currentAttempts };
  }

  const newAttempts = alreadyAttemptStored ? currentAttempts : [effectiveAttempt, ...currentAttempts];
  if (!alreadyAttemptStored) saveStoredAttempts(newAttempts);

  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== effectiveAttempt.conceptId || c.subjectId !== effectiveAttempt.subjectId) return c;
    if (alreadyEventStored) return c;

    const newEvent: ReviewEvent = {
      id: `ev-assisted-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      conceptId: c.id,
      at: effectiveAttempt.at,
      dayOffset: 0,
      kind: 'assisted_revision',
      title: `보완 답안 (${effectiveAttempt.calculatedScore}점)`,
      resultScore: effectiveAttempt.calculatedScore,
      confidence: effectiveAttempt.confidence,
      errorType: effectiveAttempt.errorType,
      hintCount: effectiveAttempt.hintCount,
      notes: effectiveAttempt.reasoningNotes,
      sourceRef: c.chapterRef,
      evaluationSummary: effectiveAttempt.evaluatorFeedback,
      rubricScores: effectiveAttempt.rubricResults,
      attemptId: effectiveAttempt.id,
      strengths: effectiveAttempt.strengths,
      criticalImprovements: effectiveAttempt.criticalImprovements,
      needsReview: effectiveAttempt.needsReview,
    };

    // Deliberately do NOT recalculate currentScore/exerciseCount/status: an
    // assisted revision is not an independent review performance.
    return { ...c, events: [...c.events, newEvent] };
  });

  saveStoredConcepts(updatedConcepts);

  const attemptPersisted = loadStoredAttempts().some((a) => a.id === effectiveAttempt.id);
  const eventPersisted = loadStoredConcepts()
    .find((c) => c.id === effectiveAttempt.conceptId && c.subjectId === effectiveAttempt.subjectId)
    ?.events.some((e) => e.attemptId === effectiveAttempt.id);
  if (!attemptPersisted || !eventPersisted) {
    throw new Error('보완 답안 저장이 완료되지 않았습니다. 다시 시도해 주세요.');
  }

  return { updatedConcepts, updatedAttempts: newAttempts };
}

/**
 * Scans stored Attempts and rebuilds any missing review events on their concepts.
 * Used to recover after a partial save (Attempt persisted, event missing).
 */
export interface RecoveryOutcome {
  recoveredCount: number;
  updatedConcepts: Concept[];
  /** Attempts whose event/plan/reservation could not be repaired this pass. */
  unresolved: { attemptId: string; reason: string }[];
}

export function recoverMissingAttemptEvents(
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS
): RecoveryOutcome {
  const concepts = loadStoredConcepts();
  const attempts = loadStoredAttempts();
  const conceptById = new Map(concepts.map((c) => [c.id, c]));

  let recoveredCount = 0;
  const unresolved: { attemptId: string; reason: string }[] = [];

  for (const attempt of attempts) {
    const concept = conceptById.get(attempt.conceptId);
    if (!concept || concept.subjectId !== attempt.subjectId) continue;
    const hadEvent = concept.events.some((e) => e.attemptId === attempt.id);

    try {
      // Assisted revisions must NEVER be recovered as independent attempts:
      // that would create an `attempt` event and inflate the review count.
      if (attempt.attemptOrigin === 'assisted_revision') {
        recordAssistedRevisionAttempt(attempt);
        const eventNow =
          loadStoredConcepts()
            .find((c) => c.id === attempt.conceptId)
            ?.events.some((e) => e.attemptId === attempt.id) === true;
        if (!hadEvent && eventNow) recoveredCount += 1;
        continue;
      }

      // Independent / rechallenge attempts: append the review event AND repair
      // the plan linkage, then complete the rechallenge reservation if linked.
      const result = recordAttemptAndUpdateConcept(attempt, settings, {
        planItemId: attempt.planItemId,
      });
      if (attempt.rechallengeReservationId) {
        const completion = completeRechallengeReservation(attempt.rechallengeReservationId, {
          subjectId: attempt.subjectId,
          conceptId: attempt.conceptId,
          problemId: attempt.problemId,
          problemVersion: attempt.problemVersion,
        });
        // Retryable and terminal-blocked states are both reported as unresolved
        // so a failure is never silently reported as a normal completion.
        if (completion.status !== 'completed' && completion.status !== 'already_completed') {
          unresolved.push({ attemptId: attempt.id, reason: `RESERVATION_${completion.status}` });
        }
      }
      const eventNow =
        loadStoredConcepts()
          .find((c) => c.id === attempt.conceptId)
          ?.events.some((e) => e.attemptId === attempt.id) === true;
      const repairedEvent = !hadEvent && eventNow;
      const repairedPlan =
        result.planLinkage.linkedItemId !== null && result.planLinkage.persisted;
      if (repairedEvent || repairedPlan) recoveredCount += 1;
      if (result.partial && !repairedPlan) {
        unresolved.push({ attemptId: attempt.id, reason: 'PLAN_LINKAGE_FAILED' });
      }
    } catch (cause) {
      unresolved.push({ attemptId: attempt.id, reason: cause instanceof Error ? cause.message : 'UNKNOWN' });
    }
  }

  return { recoveredCount, updatedConcepts: loadStoredConcepts(), unresolved };
}

/**
 * Read-only audit: reports attempts whose review event kind does not match their
 * provenance (e.g. an assisted revision that was wrongly recorded as an attempt).
 * The original Attempt is never modified; callers can decide on a correction.
 */
export function verifyAttemptEventOrigins(): {
  mismatches: { attemptId: string; expectedKind: string; actualKinds: string[] }[];
} {
  const concepts = loadStoredConcepts();
  const attempts = loadStoredAttempts();
  const mismatches: { attemptId: string; expectedKind: string; actualKinds: string[] }[] = [];

  for (const attempt of attempts) {
    const concept = concepts.find((c) => c.id === attempt.conceptId);
    if (!concept) continue;
    const events = concept.events.filter((e) => e.attemptId === attempt.id);
    if (events.length === 0) continue;

    const expectedKind = attempt.attemptOrigin === 'assisted_revision' ? 'assisted_revision' : 'attempt';
    const actualKinds = Array.from(new Set(events.map((e) => e.kind)));
    if (!actualKinds.includes(expectedKind) || actualKinds.some((k) => k !== expectedKind && k !== 'assisted_revision')) {
      mismatches.push({ attemptId: attempt.id, expectedKind, actualKinds });
    }
  }

  return { mismatches };
}

/**
 * Postpones a concept's review schedule by specified calendar days (default +1 day).
 * CRITICAL INVARIANT: This modifies ONLY the schedule offset (postponeDays & postponedUntil).
 * It NEVER inflates retention score, NEVER modifies baseScore, and NEVER appends fake ReviewEvents.
 */
export function postponeConceptReview(
  conceptId: string,
  daysToAdd: number = 1,
  referenceDate: Date = new Date()
): { updatedConcepts: Concept[]; postponedConcept: Concept | null } {
  const currentConcepts = loadStoredConcepts(referenceDate);
  let postponedConcept: Concept | null = null;

  const updatedConcepts = currentConcepts.map((c) => {
    if (c.id !== conceptId) return c;

    const currentPostpone = c.postponeDays || 0;
    const nextPostpone = currentPostpone + daysToAdd;
    const postponedUntil = addDaysToDate(referenceDate, nextPostpone);

    const updated: Concept = {
      ...c,
      postponeDays: nextPostpone,
      postponedUntil,
      // ABSOLUTE INTEGRITY: Retention score and review events remain unchanged
      events: [...c.events],
      baseScore: c.baseScore,
      currentScore: c.currentScore,
      status: c.status,
    };
    postponedConcept = updated;
    return updated;
  });

  saveStoredConcepts(updatedConcepts);
  return { updatedConcepts, postponedConcept };
}

export function getAttemptById(attemptId: string): Attempt | null {
  const attempts = loadStoredAttempts();
  return attempts.find((a) => a.id === attemptId) || null;
}
