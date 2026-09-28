import {
  Subject,
  Material,
  Concept,
  Problem,
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
  PROBLEMS: 'redcall_problems_v1',
  ATTEMPTS: 'redcall_attempts_v1',
  SETTINGS: 'redcall_retention_settings_v1',
};

function safeGetItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to parse localStorage key ${key}`, e);
    return fallback;
  }
}

function safeSetItem<T>(key: string, val: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
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
  return safeGetItem<Material[]>(STORAGE_KEYS.MATERIALS, INITIAL_MATERIALS);
}

export function saveStoredMaterials(materials: Material[]): void {
  safeSetItem(STORAGE_KEYS.MATERIALS, materials);
}

export function loadStoredConcepts(): Concept[] {
  return safeGetItem<Concept[]>(STORAGE_KEYS.CONCEPTS, INITIAL_CONCEPTS);
}

export function saveStoredConcepts(concepts: Concept[]): void {
  safeSetItem(STORAGE_KEYS.CONCEPTS, concepts);
}

export function loadStoredProblems(): Problem[] {
  return safeGetItem<Problem[]>(STORAGE_KEYS.PROBLEMS, INITIAL_PROBLEMS);
}

export function saveStoredProblems(problems: Problem[]): void {
  safeSetItem(STORAGE_KEYS.PROBLEMS, problems);
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
  localStorage.removeItem(STORAGE_KEYS.PROBLEMS);
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
