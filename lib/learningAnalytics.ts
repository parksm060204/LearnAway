/**
 * Learn my way Academic Suite - Learning Analytics Engine (Stage 10)
 *
 * Pure, deterministic analytics over a user's real saved learning records.
 * The engine computes observed performance only. It NEVER mutates attempts,
 * evaluations, concepts or model scores, and it NEVER turns a rubric score
 * into a probability of memory retention.
 *
 * Analyzed sources:
 *  - Approved real practice Attempt records
 *  - Item-level evaluations of mock exams whose results were fully recorded
 *  - Actual initial-study / review events
 *
 * Explicitly excluded:
 *  - Demo records
 *  - AI evaluation drafts and unrecorded results
 *  - Scheduled / postponed events
 *  - Unanswered items
 *  - Duplicate Attempt IDs
 *  - Evaluations flagged for review or belonging to unresolved-quality problems
 *
 * Historical records are interpreted using the snapshot taken at solve time
 * (problem version, rubric snapshot). Current problem content is never used to
 * recompute past evaluations.
 */

import {
  Attempt,
  Concept,
  ErrorType,
  ERROR_TYPE_LABELS,
  MethodReasonCriterionKey,
  METHOD_REASON_CRITERION_LABELS,
  MethodSelectionDiagnosis,
  MockExamSession,
  Problem,
  ProblemDifficulty,
  ProblemType,
  RubricResult,
  Subject,
} from './types';
import { getSeoulCalendarDiff } from './dateUtils';

// =========================================================================
// Product configuration constants (initial product rules, NOT academic constants)
// =========================================================================

export const ANALYTICS_MIN_GROUP_SAMPLE = 2;
export const VULNERABLE_SCORE_RATIO = 0.6;

/**
 * 자신감-평가 일치 판정 기준 (제품 초기 규칙).
 * 심리 진단이나 검증된 능력 측정이 아니며, 관측된 점수 경향만 표시한다.
 */
export const CONFIDENCE_ALIGNMENT_RULES = {
  lowScoreThreshold: 60,
  highScoreThreshold: 80,
  highConfidenceMin: 4,
  lowConfidenceMax: 2,
  minRepeatedOccurrences: 2,
  description:
    '제품 초기 규칙: 자신감 4~5 & 평가 60점 미만이 2회 이상 반복되면 "과신 경향", 자신감 1~2 & 평가 80점 이상이 2회 이상 반복되면 "과소평가 경향"으로 표시합니다. (심리 진단 아님)',
};

export type AnalyticsPeriod = 'last7' | 'last30' | 'all';

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  last7: '최근 7일',
  last30: '최근 30일',
  all: '전체',
};

export type AnalyticsExclusionReason =
  | 'demo_record'
  | 'draft_or_unsaved'
  | 'scheduled_or_postponed'
  | 'unanswered'
  | 'duplicate_attempt_id'
  | 'needs_review'
  | 'quality_unresolved'
  | 'version_mismatch'
  | 'unknown_problem'
  | 'invalid_score';

export const ANALYTICS_EXCLUSION_LABELS: Record<AnalyticsExclusionReason, string> = {
  demo_record: '데모 기록',
  draft_or_unsaved: 'AI 평가 초안 / 미저장 결과',
  scheduled_or_postponed: '예정·미루기 이벤트',
  unanswered: '미응답 문항',
  duplicate_attempt_id: '중복된 Attempt ID',
  needs_review: '검토가 필요한 평가',
  quality_unresolved: '품질 문제 미해결 문제의 평가',
  version_mismatch: '재승인 이전 버전 평가 (자동 유효화 안 함)',
  unknown_problem: '연결된 문제를 찾을 수 없음',
  invalid_score: '점수 값이 유효하지 않음',
};

export type AnalyticsRecordSource = 'attempt' | 'mock_exam';

export interface AnalyticsRecord {
  recordId: string;
  source: AnalyticsRecordSource;
  attemptId: string;
  sessionId?: string;
  subjectId: string;
  primaryConceptId: string;
  conceptIds: string[];
  isComposite: boolean;          // 복합 문제 여부 (문항 전체 점수, 개념별 실측 아님)
  problemId: string;
  problemTitle: string;
  problemType: ProblemType | 'unknown';
  difficulty: ProblemDifficulty | 'unknown';
  at: string;
  score: number;
  confidence: number;
  errorType: ErrorType;
  hintCount: number;
  rubricResults: RubricResult[];
  methodSelectionDiagnosis?: MethodSelectionDiagnosis;
  // Stage 13: 보완(도움 받은) 풀이와 독립 풀이 구분
  origin: 'independent' | 'assisted_revision' | 'rechallenge';
  // Stage 14: 조건 변형·전이 문제 여부
  isTransfer: boolean;
}

export interface ExcludedRecord {
  recordId: string;
  source: AnalyticsRecordSource;
  reason: AnalyticsExclusionReason;
  at?: string;
}

export interface EventStats {
  initialStudyCount: number;
  reviewCount: number;
  scheduledExcludedCount: number;
  demoEventExcludedCount: number;
}

export interface RecordCollection {
  records: AnalyticsRecord[];
  excluded: ExcludedRecord[];
  excludedByReason: Record<AnalyticsExclusionReason, number>;
  eventStats: EventStats;
  // 보완(assisted) 풀이는 독립 성과와 섞지 않고 별도로 집계한다.
  assistedRevisionCount: number;
  rechallengeCount: number;
  transferCount: number;
}

function emptyExclusionMap(): Record<AnalyticsExclusionReason, number> {
  return {
    demo_record: 0,
    draft_or_unsaved: 0,
    scheduled_or_postponed: 0,
    unanswered: 0,
    duplicate_attempt_id: 0,
    needs_review: 0,
    quality_unresolved: 0,
    version_mismatch: 0,
    unknown_problem: 0,
    invalid_score: 0,
  };
}

function isUnresolvedQuality(problem: Problem): boolean {
  const status = problem.qualityStatus || 'normal';
  return (
    status === 'reported' ||
    status === 'under_review' ||
    status === 'review_after_edit' ||
    status === 'suspended'
  );
}

function isValidScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

export interface CollectValidRecordsParams {
  attempts: Attempt[];
  mockExams: MockExamSession[];
  problems: Problem[];
  subjects: Subject[];
  concepts: Concept[];
}

/**
 * Collects and validates every analysis record, returning the accepted records,
 * the excluded records with reasons, and event statistics. Deterministic for the
 * same input.
 */
export function collectValidRecords({
  attempts,
  mockExams,
  problems,
  subjects,
  concepts,
}: CollectValidRecordsParams): RecordCollection {
  const problemById = new Map(problems.map((p) => [p.id, p]));
  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const records: AnalyticsRecord[] = [];
  const excluded: ExcludedRecord[] = [];
  const excludedByReason = emptyExclusionMap();
  let assistedRevisionCount = 0;
  let rechallengeCount = 0;
  let transferCount = 0;

  const exclude = (recordId: string, source: AnalyticsRecordSource, reason: AnalyticsExclusionReason, at?: string) => {
    excluded.push({ recordId, source, reason, at });
    excludedByReason[reason] += 1;
  };

  // Stable deterministic ordering: earliest first, then id
  const sortedAttempts = [...attempts].sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const knownAttemptIds = new Set(attempts.map((a) => a.id));
  const seenAttemptIds = new Set<string>();

  for (const attempt of sortedAttempts) {
    const source: AnalyticsRecordSource = 'attempt';
    if (seenAttemptIds.has(attempt.id)) {
      exclude(attempt.id, source, 'duplicate_attempt_id', attempt.at);
      continue;
    }
    seenAttemptIds.add(attempt.id);

    if (!attempt.answer || !attempt.answer.trim()) {
      exclude(attempt.id, source, 'unanswered', attempt.at);
      continue;
    }
    if (!isValidScore(attempt.calculatedScore)) {
      exclude(attempt.id, source, 'invalid_score', attempt.at);
      continue;
    }

    const problem = problemById.get(attempt.problemId);
    if (!problem) {
      exclude(attempt.id, source, 'unknown_problem', attempt.at);
      continue;
    }
    const subject = subjectById.get(attempt.subjectId);
    if (problem.isDemo === true || subject?.isDemo === true) {
      exclude(attempt.id, source, 'demo_record', attempt.at);
      continue;
    }
    if (isUnresolvedQuality(problem)) {
      exclude(attempt.id, source, 'quality_unresolved', attempt.at);
      continue;
    }

    const attemptVersion = attempt.problemVersion ?? 1;
    const problemVersion = problem.version ?? 1;
    if (problemVersion > attemptVersion) {
      // Re-approval of a later version never retroactively validates old evaluations.
      exclude(attempt.id, source, 'version_mismatch', attempt.at);
      continue;
    }
    if (attempt.needsReview === true) {
      exclude(attempt.id, source, 'needs_review', attempt.at);
      continue;
    }

    const origin = attempt.attemptOrigin ?? 'independent';
    // Assisted (logic-strengthened) revisions are NOT independent performance:
    // count them separately and keep them out of score/interval analytics.
    if (origin === 'assisted_revision') {
      assistedRevisionCount += 1;
      continue;
    }
    if (origin === 'rechallenge') rechallengeCount += 1;
    if (attempt.isTransfer === true) transferCount += 1;

    const conceptIds = attempt.conceptIds && attempt.conceptIds.length > 0
      ? attempt.conceptIds
      : [attempt.conceptId];

    records.push({
      recordId: attempt.id,
      source,
      attemptId: attempt.id,
      sessionId: attempt.mockExamSessionId,
      subjectId: attempt.subjectId,
      primaryConceptId: attempt.conceptId,
      conceptIds,
      isComposite: conceptIds.length > 1,
      problemId: attempt.problemId,
      problemTitle: attempt.problemTitleSnapshot || problem.title,
      problemType: problem.type,
      difficulty: problem.difficulty || 'unknown',
      at: attempt.at,
      score: attempt.calculatedScore,
      confidence: attempt.confidence,
      errorType: attempt.errorType,
      hintCount: attempt.hintCount ?? 0,
      rubricResults: attempt.rubricResults || [],
      methodSelectionDiagnosis: attempt.methodSelectionDiagnosis,
      origin,
      isTransfer: attempt.isTransfer === true,
    });
  }

  // Recorded mock-exam item evaluations not already represented by an Attempt.
  for (const session of mockExams) {
    if (session.status !== 'recorded') {
      continue;
    }
    for (const problem of session.problems) {
      const attemptId = `att-exam-${session.id}-${problem.id}`;
      if (knownAttemptIds.has(attemptId)) {
        // Already represented by the recorded Attempt -> avoid double counting.
        continue;
      }
      const answer = session.answers[problem.id];
      if (!answer || !answer.trim()) {
        exclude(attemptId, 'mock_exam', 'unanswered', session.submittedAt || session.createdAt);
        continue;
      }
      const evaluation = session.evaluations[problem.id];
      if (!evaluation) {
        exclude(attemptId, 'mock_exam', 'draft_or_unsaved', session.submittedAt || session.createdAt);
        continue;
      }
      if (!isValidScore(evaluation.calculatedScore)) {
        exclude(attemptId, 'mock_exam', 'invalid_score', session.submittedAt || session.createdAt);
        continue;
      }
      const canonical = problemById.get(problem.id) || problem;
      const subject = subjectById.get(session.subjectId);
      if (canonical.isDemo === true || subject?.isDemo === true) {
        exclude(attemptId, 'mock_exam', 'demo_record', session.submittedAt || session.createdAt);
        continue;
      }
      if (isUnresolvedQuality(canonical)) {
        exclude(attemptId, 'mock_exam', 'quality_unresolved', session.submittedAt || session.createdAt);
        continue;
      }
      if (evaluation.needsReview === true) {
        exclude(attemptId, 'mock_exam', 'needs_review', session.submittedAt || session.createdAt);
        continue;
      }

      const conceptIds = problem.conceptIds && problem.conceptIds.length > 0 ? problem.conceptIds : [];
      records.push({
        recordId: attemptId,
        source: 'mock_exam',
        attemptId,
        sessionId: session.id,
        subjectId: session.subjectId,
        primaryConceptId: conceptIds[0] || '',
        conceptIds,
        isComposite: conceptIds.length > 1,
        problemId: problem.id,
        problemTitle: problem.title,
        problemType: problem.type,
        difficulty: problem.difficulty || 'unknown',
        at: session.submittedAt || session.createdAt,
        score: evaluation.calculatedScore,
        confidence: 3,
        errorType: evaluation.recommendedErrorType || 'none',
        hintCount: 0,
        rubricResults: evaluation.rubricResults || [],
        methodSelectionDiagnosis: evaluation.methodSelectionDiagnosis,
        origin: 'independent',
        isTransfer: false,
      });
    }
  }

  // Event statistics over real (non-demo) concepts
  const eventStats: EventStats = {
    initialStudyCount: 0,
    reviewCount: 0,
    scheduledExcludedCount: 0,
    demoEventExcludedCount: 0,
  };
  for (const concept of concepts) {
    const isDemo = concept.isDemo === true;
    for (const event of concept.events || []) {
      if (isDemo) {
        eventStats.demoEventExcludedCount += 1;
        continue;
      }
      if (event.kind === 'scheduled') {
        eventStats.scheduledExcludedCount += 1;
      } else if (event.kind === 'initial_study') {
        eventStats.initialStudyCount += 1;
      } else if (event.kind === 'review') {
        eventStats.reviewCount += 1;
      }
    }
  }

  return { records, excluded, excludedByReason, eventStats, assistedRevisionCount, rechallengeCount, transferCount };
}

// =========================================================================
// Period filtering
// =========================================================================

export function isRecordInPeriod(recordAt: string, period: AnalyticsPeriod, referenceDate: Date): boolean {
  const calendarDiff = getSeoulCalendarDiff(recordAt, referenceDate);
  if (calendarDiff < 0) return false; // future records are not observed outcomes
  if (period === 'all') return true;
  if (period === 'last7') return calendarDiff < 7;
  return calendarDiff < 30;
}

export function filterRecordsBySubject(
  records: AnalyticsRecord[],
  subjectId: 'all' | string
): AnalyticsRecord[] {
  if (subjectId === 'all') return records;
  return records.filter((r) => r.subjectId === subjectId);
}

// =========================================================================
// Actual performance
// =========================================================================

export interface TypePerformance {
  problemType: ProblemType | 'unknown';
  difficulty: ProblemDifficulty | 'unknown';
  count: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  hintFreeCount: number;
}

export interface SubjectPerformance {
  subjectId: string;
  subjectName: string;
  count: number;
  averageScore: number | null;
  hintFreeRatio: number;
}

export interface ErrorTypeCount {
  errorType: ErrorType;
  label: string;
  count: number;
  ratio: number;
}

export interface PerformanceChange {
  status: 'improved' | 'declined' | 'stable' | 'insufficient';
  sampleSizeRecent: number;
  sampleSizePrevious: number;
  averageRecent: number | null;
  averagePrevious: number | null;
  delta: number | null;
  comparableGroups: number;
  note: string;
}

export interface ActualPerformance {
  totalCount: number;
  hintFreeCount: number;
  hintFreeRatio: number;
  averageScore: number | null;
  bySubject: SubjectPerformance[];
  byType: TypePerformance[];
  errorCounts: ErrorTypeCount[];
  change: PerformanceChange;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Number((sum / values.length).toFixed(1));
}

export function computeActualPerformance(
  records: AnalyticsRecord[],
  subjects: Subject[],
  period: AnalyticsPeriod,
  referenceDate: Date
): ActualPerformance {
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

  const bySubjectMap = new Map<string, AnalyticsRecord[]>();
  for (const r of records) {
    const list = bySubjectMap.get(r.subjectId) || [];
    list.push(r);
    bySubjectMap.set(r.subjectId, list);
  }
  const bySubject: SubjectPerformance[] = Array.from(bySubjectMap.entries())
    .map(([subjectId, list]) => ({
      subjectId,
      subjectName: subjectNameById.get(subjectId) || '알 수 없는 과목',
      count: list.length,
      averageScore: average(list.map((r) => r.score)),
      hintFreeRatio: Number((list.filter((r) => r.hintCount === 0).length / list.length).toFixed(3)),
    }))
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId));

  const byTypeMap = new Map<string, AnalyticsRecord[]>();
  for (const r of records) {
    const key = `${r.problemType}::${r.difficulty}`;
    const list = byTypeMap.get(key) || [];
    list.push(r);
    byTypeMap.set(key, list);
  }
  const byType: TypePerformance[] = Array.from(byTypeMap.entries())
    .map(([key, list]) => {
      const [problemType, difficulty] = key.split('::') as [ProblemType | 'unknown', ProblemDifficulty | 'unknown'];
      const scores = list.map((r) => r.score);
      return {
        problemType,
        difficulty,
        count: list.length,
        averageScore: average(scores),
        minScore: scores.length ? Math.min(...scores) : null,
        maxScore: scores.length ? Math.max(...scores) : null,
        hintFreeCount: list.filter((r) => r.hintCount === 0).length,
      };
    })
    .sort((a, b) => {
      if (a.problemType !== b.problemType) return a.problemType.localeCompare(b.problemType);
      return a.difficulty.localeCompare(b.difficulty);
    });

  const errorTypeOrder: ErrorType[] = [
    'concept_confusion',
    'condition_misinterpretation',
    'calc_or_impl_mistake',
    'method_selection_error',
  ];
  const errorCounts: ErrorTypeCount[] = errorTypeOrder.map((errorType) => {
    const count = records.filter((r) => r.errorType === errorType).length;
    return {
      errorType,
      label: ERROR_TYPE_LABELS[errorType],
      count,
      ratio: records.length ? Number((count / records.length).toFixed(3)) : 0,
    };
  });

  const hintFreeCount = records.filter((r) => r.hintCount === 0).length;

  return {
    totalCount: records.length,
    hintFreeCount,
    hintFreeRatio: records.length ? Number((hintFreeCount / records.length).toFixed(3)) : 0,
    averageScore: average(records.map((r) => r.score)),
    bySubject,
    byType,
    errorCounts,
    change: computePerformanceChange(records, period, referenceDate),
  };
}

/**
 * Compares recent vs previous segment WITHIN the same problem type + difficulty.
 * Never concludes improvement by comparing scores of different difficulty/types.
 * When comparable samples are insufficient, the judgment is withheld.
 */
export function computePerformanceChange(
  records: AnalyticsRecord[],
  period: AnalyticsPeriod,
  referenceDate: Date
): PerformanceChange {
  const insufficient: PerformanceChange = {
    status: 'insufficient',
    sampleSizeRecent: 0,
    sampleSizePrevious: 0,
    averageRecent: null,
    averagePrevious: null,
    delta: null,
    comparableGroups: 0,
    note: '같은 유형·난도에서 비교 가능한 표본이 부족하여 변화 판단을 보류합니다.',
  };

  // Each period is split into two equal halves ending at the reference date.
  const windowDays = period === 'last7' ? 7 : period === 'last30' ? 30 : 60;
  const half = windowDays / 2;

  const recent: AnalyticsRecord[] = [];
  const previous: AnalyticsRecord[] = [];
  for (const r of records) {
    const diff = getSeoulCalendarDiff(r.at, referenceDate);
    if (diff < 0 || diff >= windowDays) continue;
    if (diff < half) recent.push(r);
    else previous.push(r);
  }

  if (recent.length < ANALYTICS_MIN_GROUP_SAMPLE || previous.length < ANALYTICS_MIN_GROUP_SAMPLE) {
    return { ...insufficient, sampleSizeRecent: recent.length, sampleSizePrevious: previous.length };
  }

  const groupKey = (r: AnalyticsRecord) => `${r.problemType}::${r.difficulty}`;
  const groupRecent = new Map<string, number[]>();
  const groupPrevious = new Map<string, number[]>();
  for (const r of recent) {
    groupRecent.set(groupKey(r), [...(groupRecent.get(groupKey(r)) || []), r.score]);
  }
  for (const r of previous) {
    groupPrevious.set(groupKey(r), [...(groupPrevious.get(groupKey(r)) || []), r.score]);
  }

  const deltas: number[] = [];
  let comparableGroups = 0;
  for (const [key, recentScores] of groupRecent.entries()) {
    const previousScores = groupPrevious.get(key);
    if (!previousScores) continue;
    if (recentScores.length < ANALYTICS_MIN_GROUP_SAMPLE || previousScores.length < ANALYTICS_MIN_GROUP_SAMPLE) {
      continue;
    }
    comparableGroups += 1;
    deltas.push(average(recentScores)! - average(previousScores)!);
  }

  if (comparableGroups === 0) {
    return { ...insufficient, sampleSizeRecent: recent.length, sampleSizePrevious: previous.length };
  }

  const delta = Number((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1));
  let status: PerformanceChange['status'] = 'stable';
  if (delta >= 5) status = 'improved';
  else if (delta <= -5) status = 'declined';

  const note =
    status === 'improved'
      ? '같은 유형·난도 안에서 최근 구간 평균이 이전 구간보다 상승했습니다.'
      : status === 'declined'
      ? '같은 유형·난도 안에서 최근 구간 평균이 이전 구간보다 하락했습니다.'
      : '같은 유형·난도 안에서 최근 구간과 이전 구간의 차이가 뚜렷하지 않습니다.';

  return {
    status,
    sampleSizeRecent: recent.length,
    sampleSizePrevious: previous.length,
    averageRecent: average(recent.map((r) => r.score)),
    averagePrevious: average(previous.map((r) => r.score)),
    delta,
    comparableGroups,
    note,
  };
}

// =========================================================================
// Repeated vulnerabilities
// =========================================================================

export interface RepeatedErrorInsight {
  conceptId: string;
  conceptName: string;
  errorType: ErrorType;
  label: string;
  count: number;
  lastAt: string;
  problemIds: string[];
}

export interface ProblemVulnerableRubric {
  problemId: string;
  problemTitle: string;
  occurrences: number;
  criteria: { label: string; vulnerableCount: number; averageScore: number; maxScore: number }[];
}

export interface MethodDifficultyInsight {
  criterionKey: MethodReasonCriterionKey;
  label: string;
  needsImprovementCount: number;
  partialCount: number;
  applicableCount: number;
}

export interface VulnerabilityAnalysis {
  repeatedErrors: RepeatedErrorInsight[];
  vulnerableRubricsByProblem: ProblemVulnerableRubric[];
  methodDifficulties: MethodDifficultyInsight[];
  recordsWithDiagnosisCount: number;
  recordsWithoutDiagnosisCount: number;
}

export function computeVulnerabilities(
  records: AnalyticsRecord[],
  concepts: Concept[]
): VulnerabilityAnalysis {
  const conceptNameById = new Map(concepts.map((c) => [c.id, c.title]));

  // 1. Repeated errors on the same primary concept
  const errorKeyMap = new Map<string, { errorType: ErrorType; conceptId: string; count: number; lastAt: string; problemIds: Set<string> }>();
  for (const r of records) {
    if (r.errorType === 'none') continue;
    const key = `${r.primaryConceptId}::${r.errorType}`;
    const existing = errorKeyMap.get(key);
    if (existing) {
      existing.count += 1;
      if (new Date(r.at).getTime() > new Date(existing.lastAt).getTime()) existing.lastAt = r.at;
      existing.problemIds.add(r.problemId);
    } else {
      errorKeyMap.set(key, {
        errorType: r.errorType,
        conceptId: r.primaryConceptId,
        count: 1,
        lastAt: r.at,
        problemIds: new Set([r.problemId]),
      });
    }
  }
  const repeatedErrors: RepeatedErrorInsight[] = Array.from(errorKeyMap.values())
    .filter((e) => e.count >= 2)
    .map((e) => ({
      conceptId: e.conceptId,
      conceptName: conceptNameById.get(e.conceptId) || '연결 개념 없음',
      errorType: e.errorType,
      label: ERROR_TYPE_LABELS[e.errorType],
      count: e.count,
      lastAt: e.lastAt,
      problemIds: Array.from(e.problemIds),
    }))
    .sort((a, b) => b.count - a.count || a.conceptId.localeCompare(b.conceptId));

  // 2. Vulnerable rubric criteria per problem.
  //    Rubric IDs/labels are NEVER merged across different problems.
  interface CriterionAgg { label: string; vulnerableCount: number; sumScore: number; maxScore: number; count: number }
  const problemMap = new Map<string, { title: string; occurrences: number; criteria: Map<string, CriterionAgg> }>();
  for (const r of records) {
    const entry = problemMap.get(r.problemId) || { title: r.problemTitle, occurrences: 0, criteria: new Map() };
    entry.occurrences += 1;
    for (const result of r.rubricResults) {
      const isVulnerable = result.isVulnerable === true || (result.maxScore > 0 && result.score < result.maxScore * VULNERABLE_SCORE_RATIO);
      if (!isVulnerable) continue;
      const key = result.criterionId || result.label;
      const agg = entry.criteria.get(key) || { label: result.label, vulnerableCount: 0, sumScore: 0, maxScore: result.maxScore, count: 0 };
      agg.vulnerableCount += 1;
      agg.sumScore += result.score;
      agg.maxScore = result.maxScore;
      agg.count += 1;
      entry.criteria.set(key, agg);
    }
    problemMap.set(r.problemId, entry);
  }
  const vulnerableRubricsByProblem: ProblemVulnerableRubric[] = Array.from(problemMap.entries())
    .filter(([, v]) => v.criteria.size > 0)
    .map(([problemId, v]) => ({
      problemId,
      problemTitle: v.title,
      occurrences: v.occurrences,
      criteria: Array.from(v.criteria.values())
        .map((c) => ({
          label: c.label,
          vulnerableCount: c.vulnerableCount,
          averageScore: c.count ? Number((c.sumScore / c.count).toFixed(1)) : 0,
          maxScore: c.maxScore,
        }))
        .sort((a, b) => b.vulnerableCount - a.vulnerableCount),
    }))
    .sort((a, b) => a.problemId.localeCompare(b.problemId));

  // 3. Method / explanation difficulties (Stage 8 diagnosis).
  //    Records without a diagnosis are counted separately as "진단 없음"
  //    and are NEVER treated as low performance.
  const methodKeys: MethodReasonCriterionKey[] = [
    'appropriate_method',
    'precondition_understanding',
    'constraint_alignment',
    'alternatives_limitations',
  ];
  const methodMap = new Map<MethodReasonCriterionKey, { needsImprovementCount: number; partialCount: number; applicableCount: number }>();
  for (const key of methodKeys) {
    methodMap.set(key, { needsImprovementCount: 0, partialCount: 0, applicableCount: 0 });
  }
  let recordsWithDiagnosisCount = 0;
  let recordsWithoutDiagnosisCount = 0;
  for (const r of records) {
    const diagnosis = r.methodSelectionDiagnosis;
    if (!diagnosis || !diagnosis.isApplicable) {
      recordsWithoutDiagnosisCount += 1;
      continue;
    }
    recordsWithDiagnosisCount += 1;
    for (const criterion of diagnosis.criteria) {
      const agg = methodMap.get(criterion.key);
      if (!agg) continue;
      agg.applicableCount += 1;
      if (criterion.rating === 'needs_improvement') agg.needsImprovementCount += 1;
      else if (criterion.rating === 'partially_met') agg.partialCount += 1;
    }
  }
  const methodDifficulties: MethodDifficultyInsight[] = methodKeys.map((key) => {
    const agg = methodMap.get(key)!;
    return {
      criterionKey: key,
      label: METHOD_REASON_CRITERION_LABELS[key],
      needsImprovementCount: agg.needsImprovementCount,
      partialCount: agg.partialCount,
      applicableCount: agg.applicableCount,
    };
  });

  return {
    repeatedErrors,
    vulnerableRubricsByProblem,
    methodDifficulties,
    recordsWithDiagnosisCount,
    recordsWithoutDiagnosisCount,
  };
}

// =========================================================================
// Confidence vs evaluation results
// =========================================================================

export interface ConfidenceBucket {
  confidence: number;
  count: number;
  averageScore: number | null;
}

export interface ConfidencePattern {
  conceptId: string;
  conceptName: string;
  occurrences: number;
  averageScore: number;
  averageConfidence: number;
}

export interface ConfidenceAlignment {
  buckets: ConfidenceBucket[];
  overconfident: ConfidencePattern[];
  underconfident: ConfidencePattern[];
  ruleDescription: string;
}

export function computeConfidenceAlignment(
  records: AnalyticsRecord[],
  concepts: Concept[]
): ConfidenceAlignment {
  const conceptNameById = new Map(concepts.map((c) => [c.id, c.title]));

  const buckets: ConfidenceBucket[] = [1, 2, 3, 4, 5].map((confidence) => {
    const list = records.filter((r) => r.confidence === confidence);
    return { confidence, count: list.length, averageScore: average(list.map((r) => r.score)) };
  });

  const rules = CONFIDENCE_ALIGNMENT_RULES;

  const overMap = new Map<string, AnalyticsRecord[]>();
  const underMap = new Map<string, AnalyticsRecord[]>();
  for (const r of records) {
    if (r.confidence >= rules.highConfidenceMin && r.score < rules.lowScoreThreshold) {
      overMap.set(r.primaryConceptId, [...(overMap.get(r.primaryConceptId) || []), r]);
    }
    if (r.confidence <= rules.lowConfidenceMax && r.score >= rules.highScoreThreshold) {
      underMap.set(r.primaryConceptId, [...(underMap.get(r.primaryConceptId) || []), r]);
    }
  }

  const toPatterns = (map: Map<string, AnalyticsRecord[]>): ConfidencePattern[] =>
    Array.from(map.entries())
      .filter(([, list]) => list.length >= rules.minRepeatedOccurrences)
      .map(([conceptId, list]) => ({
        conceptId,
        conceptName: conceptNameById.get(conceptId) || '연결 개념 없음',
        occurrences: list.length,
        averageScore: average(list.map((r) => r.score))!,
        averageConfidence: average(list.map((r) => r.confidence))!,
      }))
      .sort((a, b) => b.occurrences - a.occurrences || a.conceptId.localeCompare(b.conceptId));

  return {
    buckets,
    overconfident: toPatterns(overMap),
    underconfident: toPatterns(underMap),
    ruleDescription: rules.description,
  };
}

// =========================================================================
// Top-level report
// =========================================================================

export interface BuildLearningAnalyticsReportParams {
  attempts: Attempt[];
  mockExams: MockExamSession[];
  problems: Problem[];
  subjects: Subject[];
  concepts: Concept[];
  subjectId?: 'all' | string;
  period?: AnalyticsPeriod;
  referenceDate?: Date;
}

export interface LearningAnalyticsReport {
  period: AnalyticsPeriod;
  subjectId: 'all' | string;
  collection: RecordCollection;
  records: AnalyticsRecord[];
  excludedInPeriod: ExcludedRecord[];
  performance: ActualPerformance;
  vulnerabilities: VulnerabilityAnalysis;
  confidence: ConfidenceAlignment;
}

export function buildLearningAnalyticsReport({
  attempts,
  mockExams,
  problems,
  subjects,
  concepts,
  subjectId = 'all',
  period = 'last30',
  referenceDate = new Date(),
}: BuildLearningAnalyticsReportParams): LearningAnalyticsReport {
  const collection = collectValidRecords({ attempts, mockExams, problems, subjects, concepts });
  const inPeriod = collection.records.filter((r) => isRecordInPeriod(r.at, period, referenceDate));
  const records = filterRecordsBySubject(inPeriod, subjectId);

  const excludedInPeriod = collection.excluded.filter((e) =>
    e.at ? isRecordInPeriod(e.at, period, referenceDate) : true
  );

  return {
    period,
    subjectId,
    collection,
    records,
    excludedInPeriod,
    performance: computeActualPerformance(records, subjects, period, referenceDate),
    vulnerabilities: computeVulnerabilities(records, concepts),
    confidence: computeConfidenceAlignment(records, concepts),
  };
}
