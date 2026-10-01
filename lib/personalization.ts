/**
 * REDCALL Academic Suite - Personal Review Interval Adjustment Layer (Stage 10)
 *
 * Adds a personalization layer ON TOP of the existing power-law retention model.
 * The base formula and its coefficients (tau, alpha, threshold) are unchanged.
 *
 * Absolute boundaries:
 *  - Never auto-estimate tau or alpha from real records.
 *  - Never treat an essay rubric score as a probability of memory retention.
 *  - Personalization only changes the RECOMMENDED interval. It never modifies
 *    actual scores, past events or stored evaluations.
 *
 * All numeric thresholds below are INITIAL PRODUCT SETTINGS, not verified
 * academic constants, and are isolated as named constants.
 */

import {
  PersonalizationCorrectionState,
  PersonalizationSettings,
  PersonalizationSubjectSignal,
  ReviewTendency,
  PERSONALIZATION_RULE_VERSION,
} from './types';
import { collectValidRecords, isRecordInPeriod } from './learningAnalytics';
import {
  Attempt,
  Concept,
  MockExamSession,
  Problem,
  Subject,
} from './types';
import { toSeoulDateString } from './dateUtils';

export const PERSONALIZATION_CONSTANTS = {
  WINDOW_DAYS: 30,                     // 자동 보정 분석 기간(일)
  MIN_ATTEMPTS_PER_SUBJECT: 5,         // 과목별 최소 유효 풀이 기록 수
  MIN_DISTINCT_DAYS_PER_SUBJECT: 3,    // 과목별 최소 서로 다른 학습 날짜 수
  MIN_DISTINCT_PROBLEMS_PER_SUBJECT: 3,// 과목별 최소 서로 다른 문제 수
  LOW_SCORE_THRESHOLD: 60,             // 낮은 최근 평가 기준
  HIGH_SCORE_THRESHOLD: 80,            // 안정적 성과 기준
  HINT_DEPENDENCY_RATIO: 0.5,          // 힌트 의존 판단 비율(이상)
  LOW_HINT_RATIO: 0.2,                 // 힌트 의존이 낮다고 보는 비율(이하)
  REPEAT_ERROR_MIN: 2,                 // 반복 오류 최소 횟수
  MULTIPLIER_MIN: 0.75,                // 최종 배율 하한
  MULTIPLIER_MAX: 1.25,                // 최종 배율 상한
  SHORTEN_STEP: 0.15,                  // 단축 1단계
  LENGTHEN_STEP: 0.15,                 // 연장 1단계
  EVIDENCE_STRENGTH_DAYS: 6,           // 근거 강도(날짜) 포화 기준
  EVIDENCE_STRENGTH_PROBLEMS: 8,       // 근거 강도(문제 수) 포화 기준
} as const;

export const TENDENCY_MULTIPLIERS: Record<ReviewTendency, number> = {
  dense: 0.85,
  standard: 1.0,
  relaxed: 1.15,
};

export function clampMultiplier(value: number): number {
  const { MULTIPLIER_MIN, MULTIPLIER_MAX } = PERSONALIZATION_CONSTANTS;
  const clamped = Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value));
  return Number(clamped.toFixed(2));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ComputeCorrectionStateParams {
  attempts: Attempt[];
  mockExams: MockExamSession[];
  problems: Problem[];
  subjects: Subject[];
  concepts: Concept[];
  settings: PersonalizationSettings;
  referenceDate?: Date;
}

/**
 * Deterministic personal correction state derived purely from real records.
 * Same input always yields the same output. Stored for auditability.
 */
export function computeCorrectionState({
  attempts,
  mockExams,
  problems,
  subjects,
  concepts,
  settings,
  referenceDate = new Date(),
}: ComputeCorrectionStateParams): PersonalizationCorrectionState {
  const constants = PERSONALIZATION_CONSTANTS;
  const collection = collectValidRecords({ attempts, mockExams, problems, subjects, concepts });
  const windowRecords = collection.records.filter((r) => isRecordInPeriod(r.at, 'last30', referenceDate));

  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const baseline: PersonalizationCorrectionState = {
    ruleVersion: PERSONALIZATION_RULE_VERSION,
    computedAt: referenceDate.toISOString(),
    dataSufficient: false,
    basisRefs: [],
    tendencyMultiplier: TENDENCY_MULTIPLIERS[settings.tendency],
    autoMultiplier: 1,
    appliedMultiplier: settings.enabled ? TENDENCY_MULTIPLIERS[settings.tendency] : 1,
    reasons: [],
    usedAttemptCount: 0,
    usedDistinctDays: 0,
    usedDistinctProblems: 0,
    perSubject: [],
  };

  // Group window records by subject
  const bySubject = new Map<string, typeof windowRecords>();
  for (const record of windowRecords) {
    const list = bySubject.get(record.subjectId) || [];
    list.push(record);
    bySubject.set(record.subjectId, list);
  }

  const signals: PersonalizationSubjectSignal[] = Array.from(bySubject.entries())
    .map(([subjectId, list]) => {
      const subjectName = subjectById.get(subjectId)?.name || '알 수 없는 과목';
      const scores = list.map((r) => r.score);
      const reccentAverage = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : null;
      const distinctDays = new Set(list.map((r) => toSeoulDateString(r.at))).size;
      const distinctProblems = new Set(list.map((r) => r.problemId)).size;
      const hintDependencyRatio = list.length
        ? Number((list.filter((r) => r.hintCount > 0).length / list.length).toFixed(3))
        : 0;

      // Repeated errors per (concept, errorType)
      const errorCounts = new Map<string, number>();
      for (const r of list) {
        if (r.errorType === 'none') continue;
        const key = `${r.primaryConceptId}::${r.errorType}`;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }
      const repeatErrorCount = Array.from(errorCounts.values()).filter((c) => c >= constants.REPEAT_ERROR_MIN).length;

      const eligible =
        list.length >= constants.MIN_ATTEMPTS_PER_SUBJECT &&
        distinctDays >= constants.MIN_DISTINCT_DAYS_PER_SUBJECT &&
        distinctProblems >= constants.MIN_DISTINCT_PROBLEMS_PER_SUBJECT;

      let shortSignals = 0;
      let longSignals = 0;
      const reasonParts: string[] = [];

      if (reccentAverage !== null && reccentAverage < constants.LOW_SCORE_THRESHOLD) {
        shortSignals += 1;
        reasonParts.push(`최근 평균 ${reccentAverage}점 (< ${constants.LOW_SCORE_THRESHOLD})`);
      }
      if (repeatErrorCount > 0) {
        shortSignals += 1;
        reasonParts.push(`반복 오류 ${repeatErrorCount}건`);
      }
      if (hintDependencyRatio >= constants.HINT_DEPENDENCY_RATIO) {
        shortSignals += 1;
        reasonParts.push(`힌트 의존 ${Math.round(hintDependencyRatio * 100)}%`);
      }
      if (reccentAverage !== null && reccentAverage >= constants.HIGH_SCORE_THRESHOLD) {
        longSignals += 1;
        reasonParts.push(`서로 다른 문제에서 안정적 성과 (평균 ${reccentAverage}점)`);
      }
      if (hintDependencyRatio <= constants.LOW_HINT_RATIO) {
        longSignals += 1;
        reasonParts.push(`힌트 의존 낮음 (${Math.round(hintDependencyRatio * 100)}%)`);
      }
      if (repeatErrorCount === 0 && distinctProblems >= constants.MIN_DISTINCT_PROBLEMS_PER_SUBJECT) {
        longSignals += 1;
        reasonParts.push('반복 오류 없음');
      }

      let direction: PersonalizationSubjectSignal['direction'] = 'neutral';
      if (shortSignals > longSignals) direction = 'shorten';
      else if (longSignals > shortSignals) direction = 'lengthen';

      const targetMultiplier =
        direction === 'shorten'
          ? Number((1 - constants.SHORTEN_STEP * Math.min(shortSignals, 2)).toFixed(2))
          : direction === 'lengthen'
          ? Number((1 + constants.LENGTHEN_STEP * Math.min(longSignals, 2)).toFixed(2))
          : 1;

      const evidenceStrength = clamp01(
        0.5 * Math.min(1, distinctDays / constants.EVIDENCE_STRENGTH_DAYS) +
          0.5 * Math.min(1, distinctProblems / constants.EVIDENCE_STRENGTH_PROBLEMS)
      );

      const reason = eligible
        ? direction === 'shorten'
          ? `간격 단축 방향: ${reasonParts.join(' · ')}`
          : direction === 'lengthen'
          ? `간격 연장 방향: ${reasonParts.join(' · ')}`
          : `상충하는 신호로 기본 간격 유지: ${reasonParts.join(' · ') || '특이 신호 없음'}`
        : `기록 부족 (풀이 ${list.length}건 / 날짜 ${distinctDays}일 / 문제 ${distinctProblems}개)`;

      return {
        subjectId,
        subjectName,
        eligible,
        attemptCount: list.length,
        distinctDays,
        distinctProblems,
        recentAverageScore: reccentAverage,
        hintDependencyRatio,
        repeatErrorCount,
        direction,
        targetMultiplier,
        evidenceStrength: Number(evidenceStrength.toFixed(3)),
        reason,
      } satisfies PersonalizationSubjectSignal;
    })
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId));

  const eligibleSignals = signals.filter((s) => s.eligible);

  if (eligibleSignals.length === 0) {
    return {
      ...baseline,
      perSubject: signals,
      reasons: [
        '자동 보정에 필요한 유효 기록(과목당 풀이 5건, 학습 날짜 3일, 서로 다른 문제 3개)이 부족하여 기본 권장 간격을 유지합니다.',
      ],
    };
  }

  const weightSum = eligibleSignals.reduce((acc, s) => acc + s.evidenceStrength, 0);
  const weightedTarget = weightSum > 0
    ? eligibleSignals.reduce((acc, s) => acc + s.targetMultiplier * s.evidenceStrength, 0) / weightSum
    : 1;
  const avgStrength = weightSum > 0 ? weightSum / eligibleSignals.length : 0;

  // Gentle update: only part of the target is applied, proportional to evidence strength.
  const rawAuto = 1 + (weightedTarget - 1) * avgStrength;
  const autoMultiplier = clampMultiplier(rawAuto);

  const eligibleRecordIds = eligibleSignals.flatMap((signal) =>
    windowRecords.filter((r) => r.subjectId === signal.subjectId).map((r) => r.attemptId)
  );
  const distinctDays = new Set(
    windowRecords
      .filter((r) => eligibleSignals.some((s) => s.subjectId === r.subjectId))
      .map((r) => toSeoulDateString(r.at))
  ).size;
  const distinctProblems = new Set(
    windowRecords
      .filter((r) => eligibleSignals.some((s) => s.subjectId === r.subjectId))
      .map((r) => r.problemId)
  ).size;

  const reasons: string[] = eligibleSignals.map((s) => `[${s.subjectName}] ${s.reason}`);
  if (autoMultiplier > 1) {
    reasons.push(`과목별 신호를 종합하여 복습 간격을 완만하게 연장합니다 (배율 ${autoMultiplier}).`);
  } else if (autoMultiplier < 1) {
    reasons.push(`과목별 신호를 종합하여 복습 간격을 완만하게 단축합니다 (배율 ${autoMultiplier}).`);
  } else {
    reasons.push('상충하는 신호가 있어 자동 보정은 기본 간격을 유지합니다 (배율 1).');
  }

  const tendencyMultiplier = TENDENCY_MULTIPLIERS[settings.tendency];
  const autoApplied = settings.autoAdjust ? autoMultiplier : 1;
  const combined = clampMultiplier(tendencyMultiplier * autoApplied);
  const appliedMultiplier = settings.enabled ? combined : 1;

  if (!settings.autoAdjust) {
    reasons.push('자동 보정이 비활성화되어 성향 배율만 반영합니다.');
  }
  if (!settings.enabled) {
    reasons.push('개인별 추천이 비활성화되어 기본 권장 간격을 사용합니다.');
  }

  return {
    ruleVersion: PERSONALIZATION_RULE_VERSION,
    computedAt: referenceDate.toISOString(),
    dataSufficient: true,
    basisRefs: eligibleRecordIds,
    tendencyMultiplier,
    autoMultiplier,
    appliedMultiplier,
    reasons,
    usedAttemptCount: eligibleSignals.reduce((acc, s) => acc + s.attemptCount, 0),
    usedDistinctDays: distinctDays,
    usedDistinctProblems: distinctProblems,
    perSubject: signals,
  };
}

/**
 * Single source of truth for the multiplier applied to the recommended interval.
 */
export function getEffectiveIntervalMultiplier(
  settings: PersonalizationSettings,
  state: PersonalizationCorrectionState
): number {
  if (!settings.enabled) return 1;
  return clampMultiplier(state.appliedMultiplier);
}
