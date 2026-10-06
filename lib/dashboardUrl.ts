/**
 * URL parsing, building, and resolution logic for LearnAway dashboard.
 *
 * Requirements:
 * - URL records tab, subject, and optionally material, problem, attempt, exam.
 * - Restores the exact selected item on reload, back, and forward navigation.
 * - Does NOT include answers, bodies, or secrets in the URL.
 * - Does NOT trigger mutations (submissions, deletions, generation) from URL parsing.
 * - Does NOT judge an ID "missing" while initial data is still loading.
 * - Does NOT silently replace a non-existent item with the default subject.
 * - Differentiates invalid tab values (safe normalization) from invalid data IDs (error notice).
 * - Safe error messages that never disclose whether another user's data exists.
 */

export type DashboardTab =
  | 'today'
  | 'materials'
  | 'problems'
  | 'history'
  | 'settings'
  | 'session'
  | 'exam';

export const VALID_DASHBOARD_TABS: readonly DashboardTab[] = [
  'today',
  'materials',
  'problems',
  'history',
  'settings',
  'session',
  'exam',
] as const;

export interface DashboardUrlParams {
  tab?: DashboardTab;
  rawTab?: string;
  subjectId?: string;
  materialId?: string;
  problemId?: string;
  attemptId?: string;
  examId?: string;
}

export interface UrlResolutionContext {
  isLoaded: boolean;
  isCloudLoading?: boolean;
  subjects: Array<{ id: string; name?: string }>;
  materials: Array<{ id: string; subjectId: string; title?: string }>;
  problems: Array<{ id: string; subjectId: string; title?: string }>;
  attempts: Array<{ id: string; subjectId?: string }>;
  mockExams?: Array<{ id: string; subjectId: string }>;
}

export type UrlResolutionStatus =
  | 'loading'
  | 'valid'
  | 'invalid_tab'
  | 'not_found';

export type NotFoundEntityKind = 'subject' | 'material' | 'problem' | 'attempt' | 'exam';

export interface UrlResolutionResult {
  status: UrlResolutionStatus;
  tab: DashboardTab;
  subjectId?: string;
  materialId?: string;
  problemId?: string;
  attemptId?: string;
  examId?: string;
  notFoundEntity?: {
    kind: NotFoundEntityKind;
    id: string;
  };
  noticeMessage?: string;
}

/**
 * Parses query parameters from search string (e.g. `?tab=problems&subject=s1`).
 * Does NOT accept or parse sensitive fields (markdown, answers, secrets).
 */
export function parseDashboardUrl(search: string): DashboardUrlParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawTab = params.get('tab') || undefined;

  let tab: DashboardTab | undefined;
  if (rawTab && (VALID_DASHBOARD_TABS as readonly string[]).includes(rawTab)) {
    tab = rawTab as DashboardTab;
  }

  const subjectId = params.get('subject') || undefined;
  const materialId = params.get('material') || undefined;
  const problemId = params.get('problem') || undefined;
  const attemptId = params.get('attempt') || undefined;
  const examId = params.get('exam') || undefined;

  return {
    tab,
    rawTab,
    subjectId,
    materialId,
    problemId,
    attemptId,
    examId,
  };
}

/**
 * Builds a clean search query string from dashboard state.
 * Never serializes secrets or content.
 */
export function buildDashboardUrl(params: DashboardUrlParams): string {
  const searchParams = new URLSearchParams();

  if (params.tab && params.tab !== 'today') {
    searchParams.set('tab', params.tab);
  }
  if (params.subjectId) {
    searchParams.set('subject', params.subjectId);
  }
  if (params.materialId && (params.tab === 'materials' || !params.tab)) {
    searchParams.set('material', params.materialId);
  }
  if (params.problemId && (params.tab === 'problems' || params.tab === 'session')) {
    searchParams.set('problem', params.problemId);
  }
  if (params.attemptId && params.tab === 'history') {
    searchParams.set('attempt', params.attemptId);
  }
  if (params.examId && params.tab === 'exam') {
    searchParams.set('exam', params.examId);
  }

  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

/**
 * Resolves parsed URL parameters against the user's currently loaded dataset.
 *
 * Security & Data Privacy rules:
 * - While data is loading, returns 'loading' so valid IDs are not prematurely judged as missing.
 * - If an item is not found in the user's data, returns a generic 'not_found' status without
 *   disclosing whether the record exists in another user's account.
 * - Does not silently overwrite a missing item with a default subject.
 */
export function resolveDashboardUrl(
  parsed: DashboardUrlParams,
  ctx: UrlResolutionContext
): UrlResolutionResult {
  const tab: DashboardTab = parsed.tab ?? 'today';

  // 1. If dataset is still loading, postpone judgment.
  if (!ctx.isLoaded || ctx.isCloudLoading) {
    return {
      status: 'loading',
      tab,
      subjectId: parsed.subjectId,
      materialId: parsed.materialId,
      problemId: parsed.problemId,
      attemptId: parsed.attemptId,
      examId: parsed.examId,
    };
  }

  // 2. Tab validation: if user typed an unknown tab, record that it was normalized
  const hasInvalidTab = Boolean(parsed.rawTab && !parsed.tab);

  // 3. Subject verification
  let resolvedSubjectId: string | undefined;
  if (parsed.subjectId) {
    const exists = ctx.subjects.some((s) => s.id === parsed.subjectId);
    if (!exists) {
      return {
        status: 'not_found',
        tab,
        notFoundEntity: { kind: 'subject', id: parsed.subjectId },
        noticeMessage: '요청하신 과목을 찾을 수 없거나 접근 권한이 없습니다. (삭제되었거나 올바르지 않은 주소일 수 있습니다)',
      };
    }
    resolvedSubjectId = parsed.subjectId;
  } else if (ctx.subjects.length > 0) {
    resolvedSubjectId = ctx.subjects[0].id;
  }

  // 4. Material verification
  if (parsed.materialId) {
    const material = ctx.materials.find((m) => m.id === parsed.materialId);
    if (!material) {
      return {
        status: 'not_found',
        tab: 'materials',
        subjectId: resolvedSubjectId,
        notFoundEntity: { kind: 'material', id: parsed.materialId },
        noticeMessage: '요청하신 학습 자료를 찾을 수 없거나 접근 권한이 없습니다.',
      };
    }
    // If material belongs to a subject other than resolvedSubjectId, prioritize material's subject
    if (resolvedSubjectId && material.subjectId !== resolvedSubjectId) {
      // Check if user owns that material's subject
      const ownsSubject = ctx.subjects.some((s) => s.id === material.subjectId);
      if (ownsSubject) {
        resolvedSubjectId = material.subjectId;
      }
    }
  }

  // 5. Problem verification
  if (parsed.problemId) {
    const problem = ctx.problems.find((p) => p.id === parsed.problemId);
    if (!problem) {
      return {
        status: 'not_found',
        tab: tab === 'session' ? 'session' : 'problems',
        subjectId: resolvedSubjectId,
        notFoundEntity: { kind: 'problem', id: parsed.problemId },
        noticeMessage: '요청하신 문제를 찾을 수 없거나 접근 권한이 없습니다.',
      };
    }
    if (resolvedSubjectId && problem.subjectId !== resolvedSubjectId) {
      const ownsSubject = ctx.subjects.some((s) => s.id === problem.subjectId);
      if (ownsSubject) {
        resolvedSubjectId = problem.subjectId;
      }
    }
  }

  // 6. Attempt verification
  if (parsed.attemptId) {
    const attempt = ctx.attempts.find((a) => a.id === parsed.attemptId);
    if (!attempt) {
      return {
        status: 'not_found',
        tab: 'history',
        subjectId: resolvedSubjectId,
        notFoundEntity: { kind: 'attempt', id: parsed.attemptId },
        noticeMessage: '요청하신 풀이 기록을 찾을 수 없거나 접근 권한이 없습니다.',
      };
    }
  }

  // 7. Exam verification
  if (parsed.examId && ctx.mockExams) {
    const exam = ctx.mockExams.find((e) => e.id === parsed.examId);
    if (!exam) {
      return {
        status: 'not_found',
        tab: 'exam',
        subjectId: resolvedSubjectId,
        notFoundEntity: { kind: 'exam', id: parsed.examId },
        noticeMessage: '요청하신 모의시험 세션을 찾을 수 없거나 접근 권한이 없습니다.',
      };
    }
    // The exam's own subject wins, so a direct exam URL opens under the right
    // subject instead of whichever subject happened to be in the URL.
    if (resolvedSubjectId && exam.subjectId !== resolvedSubjectId) {
      const ownsSubject = ctx.subjects.some((s) => s.id === exam.subjectId);
      if (ownsSubject) {
        resolvedSubjectId = exam.subjectId;
      }
    }
  }

  return {
    status: hasInvalidTab ? 'invalid_tab' : 'valid',
    tab,
    subjectId: resolvedSubjectId,
    materialId: parsed.materialId,
    problemId: parsed.problemId,
    attemptId: parsed.attemptId,
    examId: parsed.examId,
  };
}
