import { Concept, ConceptStatus, RetentionModelSettings, ReviewEvent, ReviewRecommendation } from './types';
import {
  toSeoulDateString,
  getSeoulCalendarDiff,
  formatSeoulDate,
  addDaysToDate,
  calculateDDay,
} from './dateUtils';

/**
 * DEFAULT ACADEMIC DEMO PARAMETERS
 * NOTE: These baseline parameters are strictly derived from academic memory decay literature
 * (Power-Law / Ebbinghaus baseline) for relative review scheduling and prioritization.
 * They represent a model score (0-100), NOT verified clinical memory retention or absolute test predictions.
 */
export const DEFAULT_RETENTION_SETTINGS: RetentionModelSettings = {
  tau: 2.5,       // Base memory stability scale in days (academic baseline)
  alpha: 0.55,    // Decay power exponent (academic power-law decay)
  threshold: 50.0 // Critical review threshold score
};

/**
 * Pure Power-Law retention score calculation:
 * R(t) = S0 * (1 + t / tau)^(-alpha)
 *
 * @param t Days elapsed since event (t >= 0)
 * @param s0 Starting score at event (0 to 100)
 * @param tau Stability constant in days
 * @param alpha Decay power exponent
 */
export function calculatePowerLawRetention(
  t: number,
  s0: number,
  tau: number = DEFAULT_RETENTION_SETTINGS.tau,
  alpha: number = DEFAULT_RETENTION_SETTINGS.alpha
): number {
  if (t <= 0) return Math.min(100, Math.max(0, s0));
  const effectiveTau = Math.max(0.1, tau);
  const decayFactor = Math.pow(1 + t / effectiveTau, -alpha);
  const score = s0 * decayFactor;
  return Math.min(100, Math.max(0, Number(score.toFixed(1))));
}

/**
 * Calculates effective tau incorporating spaced repetition spacing effect:
 * each subsequent review increases memory stability.
 * Kept for backward compatibility with core tests.
 */
export function getEffectiveTau(baseTau: number, reviewCount: number): number {
  return baseTau * (1 + 0.15 * Math.max(0, reviewCount));
}

/**
 * Comprehensive tau incorporating:
 * 1. Spacing effect (review count N)
 * 2. Learner confidence (1~5 scale)
 * 3. Hint usage penalty (more hints -> lower stability)
 * 4. Vulnerable rubric criteria penalty (unmastered proof steps -> faster decay)
 */
export function calculateComprehensiveTau(
  baseTau: number,
  reviewCount: number,
  confidence: number = 3,
  hintCount: number = 0,
  vulnerableCriterionCount: number = 0
): number {
  const spacingMultiplier = 1 + 0.20 * Math.max(0, reviewCount);
  // Confidence 1: 0.85, 2: 0.925, 3: 1.0, 4: 1.075, 5: 1.15
  const confidenceMultiplier = 0.85 + 0.075 * Math.max(0, Math.min(4, confidence - 1));
  // Hint penalty: -10% per hint, capped at -30%
  const hintPenalty = Math.max(0.70, 1.0 - 0.10 * Math.max(0, hintCount));
  // Vulnerable criteria: -10% per vulnerable rubric item, capped at -25%
  const vulnerablePenalty = Math.max(0.75, 1.0 - 0.10 * Math.max(0, vulnerableCriterionCount));

  const effective = baseTau * spacingMultiplier * confidenceMultiplier * hintPenalty * vulnerablePenalty;
  return Math.max(0.2, Number(effective.toFixed(3)));
}

/**
 * Filters only verified confirmed learning and evaluation events.
 * Crucial rule: 'scheduled', unconfirmed AI drafts, or postponed reminders
 * MUST NOT count as study accomplishments.
 */
export function getConfirmedEvents(events?: ReviewEvent[]): ReviewEvent[] {
  if (!events || events.length === 0) return [];
  return events.filter(
    (e) => e.kind === 'initial_study' || e.kind === 'attempt' || e.kind === 'review'
  );
}

/**
 * Calculates a concept's current model score based on its actual event history.
 * Supports both real timestamp calculation (Date / ISO string) and dayOffset number (for test compatibility).
 */
export function calculateCurrentConceptScore(
  events: ReviewEvent[],
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  reference: Date | string | number = new Date()
): number {
  const confirmed = getConfirmedEvents(events);
  if (confirmed.length === 0) return 0;

  if (typeof reference === 'number') {
    // Legacy / test dayOffset reference mode (relative to Day 0)
    const pastEvents = confirmed
      .filter((e) => e.dayOffset <= reference)
      .sort((a, b) => a.dayOffset - b.dayOffset);

    if (pastEvents.length === 0) return 0;

    const lastEvent = pastEvents[pastEvents.length - 1];
    const daysSinceLastEvent = reference - lastEvent.dayOffset;
    const reviewCount = pastEvents.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
    const effectiveTau = getEffectiveTau(settings.tau, reviewCount);

    return calculatePowerLawRetention(daysSinceLastEvent, lastEvent.resultScore, effectiveTau, settings.alpha);
  }

  // Real timestamp mode (using ReviewEvent.at)
  const refDate = typeof reference === 'string' ? new Date(reference) : reference;
  const refTime = refDate.getTime();

  const pastEvents = confirmed
    .filter((e) => new Date(e.at).getTime() <= refTime)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (pastEvents.length === 0) return 0;

  const lastEvent = pastEvents[pastEvents.length - 1];
  const elapsedDays = Math.max(0, (refTime - new Date(lastEvent.at).getTime()) / (1000 * 60 * 60 * 24));
  const reviewCount = pastEvents.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;

  const vulnerableCount = lastEvent.rubricScores
    ? lastEvent.rubricScores.filter((r) => r.isVulnerable || (r.maxScore > 0 && r.score < r.maxScore * 0.6)).length
    : 0;

  const effectiveTau = calculateComprehensiveTau(
    settings.tau,
    reviewCount,
    lastEvent.confidence ?? 3,
    lastEvent.hintCount ?? 0,
    vulnerableCount
  );

  return calculatePowerLawRetention(elapsedDays, lastEvent.resultScore, effectiveTau, settings.alpha);
}

/**
 * Assigns ConceptStatus according to score and urgency
 */
export function getConceptStatusFromScore(score: number): ConceptStatus {
  if (score < 50.0) return 'review_target';
  if (score < 65.0) return 'recommend_d1';
  if (score < 80.0) return 'stable';
  if (score < 90.0) return 'maintained';
  return 'newly_learned';
}

export const CONCEPT_STATUS_METADATA: Record<
  ConceptStatus,
  { label: string; badgeClass: string; textClass: string; isUrgent: boolean }
> = {
  review_target: {
    label: '복습 대상',
    badgeClass: 'bg-red-50 text-red-700 border-red-300 font-semibold',
    textClass: 'text-red-600',
    isUrgent: true,
  },
  recommend_d1: {
    label: 'D+1 권장',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
    textClass: 'text-amber-700',
    isUrgent: false,
  },
  stable: {
    label: '안정 구간',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-300',
    textClass: 'text-stone-700',
    isUrgent: false,
  },
  maintained: {
    label: '유지 상태',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    textClass: 'text-emerald-700',
    isUrgent: false,
  },
  newly_learned: {
    label: '신규 습득',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-300',
    textClass: 'text-blue-700',
    isUrgent: false,
  },
  unstudied: {
    label: '미학습 (대기)',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 font-medium',
    textClass: 'text-slate-600',
    isUrgent: false,
  },
};

/**
 * Inverts power-law retention equation to compute recommended review interval:
 * R(t*) = S0 * (1 + t* / tau)^(-alpha) = threshold
 * => t* = tau * ((S0 / threshold)^(1 / alpha) - 1)
 */
export function calculatePowerLawOptimalInterval(
  s0: number,
  tau: number,
  alpha: number = DEFAULT_RETENTION_SETTINGS.alpha,
  threshold: number = DEFAULT_RETENTION_SETTINGS.threshold
): number {
  if (s0 <= threshold) return 0; // Already at or below threshold -> review immediately (today)
  const ratio = s0 / threshold;
  const t = tau * (Math.pow(ratio, 1 / alpha) - 1);
  return Math.max(0, t);
}

/**
 * Calculates deterministic review recommendation for a concept based on actual event timestamps.
 * Reflects last event score, review count, confidence, hint count, vulnerable criteria,
 * postponed days, and exam D-day.
 */
export function calculateNextReviewRecommendation(
  concept: Concept,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  examAtIso?: string,
  referenceDate: Date = new Date(),
  intervalMultiplier: number = 1
): ReviewRecommendation | null {
  if (concept.status === 'unstudied' || !concept.events || concept.events.length === 0) {
    return null;
  }

  const confirmedEvents = getConfirmedEvents(concept.events);
  if (confirmedEvents.length === 0) {
    return null;
  }

  // Sort ascending by real timestamp
  const sorted = [...confirmedEvents].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  const lastEvent = sorted[sorted.length - 1];

  const reviewCount = sorted.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
  const confidence = lastEvent.confidence ?? 3;
  const hintCount = lastEvent.hintCount ?? 0;
  const vulnerableCount = lastEvent.rubricScores
    ? lastEvent.rubricScores.filter((r) => r.isVulnerable || (r.maxScore > 0 && r.score < r.maxScore * 0.6)).length
    : 0;

  const effectiveTau = calculateComprehensiveTau(
    settings.tau,
    reviewCount,
    confidence,
    hintCount,
    vulnerableCount
  );

  // Exact fractional elapsed days from last event
  const elapsedDays = Math.max(
    0,
    (referenceDate.getTime() - new Date(lastEvent.at).getTime()) / (1000 * 60 * 60 * 24)
  );
  // Calendar days difference in Asia/Seoul
  const calendarElapsedDays = Math.max(0, getSeoulCalendarDiff(lastEvent.at, referenceDate));

  // Current score at referenceDate
  const currentScore = calculatePowerLawRetention(
    elapsedDays,
    lastEvent.resultScore,
    effectiveTau,
    settings.alpha
  );

  // Calculate optimal retention interval t* in days
  const theoreticalIntervalDays = calculatePowerLawOptimalInterval(
    lastEvent.resultScore,
    effectiveTau,
    settings.alpha,
    settings.threshold
  );

  // Stage 10: personal interval multiplier. Keeps the base formula and coefficients
  // intact and only scales the model-derived interval (postpone offset is preserved).
  const safeMultiplier =
    Number.isFinite(intervalMultiplier) && intervalMultiplier > 0 ? intervalMultiplier : 1;

  // Base calendar interval: round theoretical interval (at least 1 day if initial score was above threshold)
  const rawBaseIntervalDays =
    lastEvent.resultScore <= settings.threshold ? 0 : Math.max(1, theoreticalIntervalDays);
  const baseIntervalDays =
    rawBaseIntervalDays === 0 ? 0 : Math.max(1, Math.round(rawBaseIntervalDays * safeMultiplier));

  // Postpone days (pure schedule offset without boosting memory score)
  const postponeDays = concept.postponeDays || 0;
  const totalIntervalDays = baseIntervalDays + postponeDays;

  // Calendar days until review: (total scheduled interval) - (days already passed)
  const daysUntilReview = totalIntervalDays - calendarElapsedDays;

  // Recommended review date in KST
  const recommendedAt = addDaysToDate(lastEvent.at, totalIntervalDays);
  const recommendedDateStr = toSeoulDateString(recommendedAt);

  // Exam proximity bonus calculation
  let examProximityWeight = 0;
  if (examAtIso) {
    const ddayResult = calculateDDay(examAtIso, referenceDate);
    if (!ddayResult.isNotSet && !ddayResult.isOverdue && ddayResult.calendarDiff >= 0) {
      if (ddayResult.calendarDiff <= 7) {
        examProximityWeight = (8 - ddayResult.calendarDiff) * 6; // High priority in final week
      } else if (ddayResult.calendarDiff <= 14) {
        examProximityWeight = (15 - ddayResult.calendarDiff) * 2.5; // Medium boost
      } else if (ddayResult.calendarDiff <= 30) {
        examProximityWeight = (31 - ddayResult.calendarDiff) * 0.5;
      }
    }
  }

  // Urgency score calculation:
  // (100 - currentScore) * 1.5 + (overdue days * 6) + examProximityWeight
  const overdueBonus = Math.max(0, -daysUntilReview) * 6.0;
  const scoreDeficit = (100 - currentScore) * 1.5;
  const urgencyScore = Number((scoreDeficit + overdueBonus + examProximityWeight).toFixed(2));

  // Human-readable rationale text explaining factors
  const rationaleParts: string[] = [];
  if (daysUntilReview <= 0) {
    rationaleParts.push(`모델 점수 ${currentScore.toFixed(1)}점 (임계치 ${settings.threshold}점 이하)`);
    if (daysUntilReview < 0) {
      rationaleParts.push(`${Math.abs(daysUntilReview)}일 초과 연체`);
    } else {
      rationaleParts.push('오늘 복습 권장일 도래');
    }
  } else {
    rationaleParts.push(`모델 점수 ${currentScore.toFixed(1)}점 (안정 유지 중) · D+${daysUntilReview} 권장`);
  }

  if (confidence < 3) {
    rationaleParts.push(`확신도 ${confidence}점(신뢰도 낮음) 감쇠 가속`);
  }
  if (hintCount > 0) {
    rationaleParts.push(`힌트 ${hintCount}개 사용 반영`);
  }
  if (vulnerableCount > 0) {
    rationaleParts.push(`취약 루브릭 ${vulnerableCount}건 보완 필요`);
  }
  if (postponeDays > 0) {
    rationaleParts.push(`하루 미루기(+${postponeDays}일) 반영`);
  }
  if (examProximityWeight > 10) {
    rationaleParts.push('시험 임박 가중치 적용');
  }
  if (safeMultiplier !== 1) {
    const baseRounded = Math.max(0, Math.round(rawBaseIntervalDays));
    rationaleParts.push(
      `개인별 간격 보정 x${safeMultiplier.toFixed(2)} (모델 기본 ${baseRounded}일 → 적용 ${baseIntervalDays}일)`
    );
  }

  const priorityReason = rationaleParts.join(' · ');

  return {
    conceptId: concept.id,
    recommendedAt,
    recommendedDateStr,
    daysUntilReview,
    urgencyScore,
    priorityRank: 1, // updated by rankConceptsForReview
    priorityReason,
    isDueTodayOrOverdue: daysUntilReview <= 0,
    factors: {
      lastScore: lastEvent.resultScore,
      elapsedDays: Number(elapsedDays.toFixed(2)),
      effectiveTau: Number(effectiveTau.toFixed(2)),
      confidenceFactor: Number((0.85 + 0.075 * Math.max(0, Math.min(4, confidence - 1))).toFixed(2)),
      hintPenalty: Number(Math.max(0.70, 1.0 - 0.10 * hintCount).toFixed(2)),
      vulnerableCriterionCount: vulnerableCount,
      examProximityWeight,
      postponeDays,
    },
    baseIntervalDays,
    intervalMultiplier: safeMultiplier,
    isPersonalized: safeMultiplier !== 1,
  };
}

/**
 * Deterministically ranks concepts for today's review recommendations.
 * Priority ordering:
 * 1. Due today / Overdue first (daysUntilReview <= 0)
 * 2. Higher urgency score (lower model score, urgent exam D-day)
 * 3. Shorter days until review
 * 4. Concept order
 * 5. Deterministic ID
 */
export function rankConceptsForReview(
  concepts: Concept[],
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  examAtIso?: string,
  referenceDate: Date = new Date(),
  intervalMultiplier: number = 1
): {
  rankedRecommendations: ReviewRecommendation[];
  dueTodayCount: number;
  unstudiedConcepts: Concept[];
} {
  const recommendations: ReviewRecommendation[] = [];
  const unstudied: Concept[] = [];

  for (const c of concepts) {
    if (c.status === 'unstudied' || !c.events || c.events.length === 0) {
      unstudied.push(c);
      continue;
    }
    const rec = calculateNextReviewRecommendation(c, settings, examAtIso, referenceDate, intervalMultiplier);
    if (rec) {
      recommendations.push(rec);
    } else {
      unstudied.push(c);
    }
  }

  recommendations.sort((a, b) => {
    // 1. Due today/overdue (daysUntilReview <= 0) comes before future
    const aDue = a.isDueTodayOrOverdue ? 1 : 0;
    const bDue = b.isDueTodayOrOverdue ? 1 : 0;
    if (aDue !== bDue) return bDue - aDue;

    // 2. Urgency score descending
    if (b.urgencyScore !== a.urgencyScore) {
      return b.urgencyScore - a.urgencyScore;
    }

    // 3. Days until review ascending
    if (a.daysUntilReview !== b.daysUntilReview) {
      return a.daysUntilReview - b.daysUntilReview;
    }

    // 4. Stable concept order
    const conceptA = concepts.find((c) => c.id === a.conceptId);
    const conceptB = concepts.find((c) => c.id === b.conceptId);
    const orderA = conceptA?.order ?? 999;
    const orderB = conceptB?.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;

    // 5. Lexicographical ID
    return a.conceptId.localeCompare(b.conceptId);
  });

  // Assign 1-indexed priority ranks
  recommendations.forEach((rec, idx) => {
    rec.priorityRank = idx + 1;
  });

  const dueTodayCount = recommendations.filter((r) => r.isDueTodayOrOverdue).length;

  return {
    rankedRecommendations: recommendations,
    dueTodayCount,
    unstudiedConcepts: unstudied,
  };
}

export interface CurvePoint {
  day: number;
  score: number;
  isEventPoint?: boolean;
  eventLabel?: string;
  eventId?: string;
  dateStr?: string;
  isToday?: boolean;
  isExam?: boolean;
}

export interface TrajectoryProjection {
  historyCurve: CurvePoint[];
  neglectedProjection: CurvePoint[];
  reviewedProjection: CurvePoint[];
  currentScore: number;
  examProjectedScoreNeglected: number;
  examProjectedScoreReviewed: number;
  criticalThreshold: number;
  dateTicks: { day: number; label: string; dateStr: string; isToday?: boolean; isExam?: boolean }[];
  minDay: number;
  maxDay: number;
  hasExamDate: boolean;
  isUnstudied: boolean;
}

/**
 * Generates continuous curve coordinates for SVG visualization based on real event dates.
 * Past segments represent observed decay between confirmed events.
 * Future segments represent academic model projection ("모델 예상치") and hypothetical scenario ("오늘 복습 시 예상 경로").
 */
export function generateConceptTrajectory(
  concept: Concept,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  examDayOffset: number = 14,
  referenceDate: Date = new Date()
): TrajectoryProjection {
  if (!concept.events || concept.events.length === 0 || concept.status === 'unstudied') {
    return {
      historyCurve: [],
      neglectedProjection: [],
      reviewedProjection: [],
      currentScore: 0,
      examProjectedScoreNeglected: 0,
      examProjectedScoreReviewed: 0,
      criticalThreshold: settings.threshold,
      dateTicks: [],
      minDay: -10,
      maxDay: Math.max(14, examDayOffset),
      hasExamDate: examDayOffset > 0,
      isUnstudied: true,
    };
  }

  const confirmedEvents = getConfirmedEvents(concept.events);
  if (confirmedEvents.length === 0) {
    return {
      historyCurve: [],
      neglectedProjection: [],
      reviewedProjection: [],
      currentScore: 0,
      examProjectedScoreNeglected: 0,
      examProjectedScoreReviewed: 0,
      criticalThreshold: settings.threshold,
      dateTicks: [],
      minDay: -10,
      maxDay: Math.max(14, examDayOffset),
      hasExamDate: examDayOffset > 0,
      isUnstudied: true,
    };
  }

  // Calculate real day offset relative to referenceDate in Asia/Seoul
  const eventsWithRealOffset = confirmedEvents.map((ev) => {
    const calendarDiff = getSeoulCalendarDiff(referenceDate, ev.at); // negative if in the past
    return {
      ...ev,
      realDayOffset: calendarDiff,
      dateFormatted: formatSeoulDate(ev.at),
    };
  }).sort((a, b) => a.realDayOffset - b.realDayOffset);

  const historyCurve: CurvePoint[] = [];
  const earliestOffset = eventsWithRealOffset[0]?.realDayOffset ?? -9;
  const minDay = Math.min(earliestOffset - 1, -10);
  const maxDay = Math.max(examDayOffset, 14);
  const todayOffset = 0;

  // Build piecewise historical curve across confirmed events
  for (let i = 0; i < eventsWithRealOffset.length; i++) {
    const ev = eventsWithRealOffset[i];
    const nextEv = eventsWithRealOffset[i + 1];
    const segmentEndDay = nextEv ? nextEv.realDayOffset : todayOffset;

    const priorReviews = eventsWithRealOffset
      .slice(0, i)
      .filter((e) => e.kind === 'attempt' || e.kind === 'review').length;

    const effectiveTau = calculateComprehensiveTau(
      settings.tau,
      priorReviews,
      ev.confidence ?? 3,
      ev.hintCount ?? 0,
      ev.rubricScores?.filter((r) => r.isVulnerable).length ?? 0
    );

    // Initial event point
    historyCurve.push({
      day: ev.realDayOffset,
      score: ev.resultScore,
      isEventPoint: true,
      eventLabel: `${ev.title} (${ev.resultScore}점)`,
      eventId: ev.id,
      dateStr: ev.dateFormatted,
    });

    // Interpolate decay up to next event or today
    const step = 0.5;
    for (let d = ev.realDayOffset + step; d <= segmentEndDay; d += step) {
      const elapsed = d - ev.realDayOffset;
      const decayedScore = calculatePowerLawRetention(elapsed, ev.resultScore, effectiveTau, settings.alpha);
      historyCurve.push({
        day: Number(d.toFixed(1)),
        score: decayedScore,
      });
    }
  }

  // Calculate current score at today
  const currentScore = calculateCurrentConceptScore(confirmedEvents, settings, referenceDate);

  // Future trajectory 1: Neglected (미복습 시 모델 예상 감쇠)
  const neglectedProjection: CurvePoint[] = [];
  const pastAttemptsCount = confirmedEvents.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
  const lastEvent = eventsWithRealOffset[eventsWithRealOffset.length - 1];
  const daysSinceLastEvent = lastEvent ? Math.max(0, 0 - lastEvent.realDayOffset) : 0;
  const lastScore = lastEvent ? lastEvent.resultScore : currentScore;

  const currentTau = calculateComprehensiveTau(
    settings.tau,
    pastAttemptsCount,
    lastEvent?.confidence ?? 3,
    lastEvent?.hintCount ?? 0,
    lastEvent?.rubricScores?.filter((r) => r.isVulnerable).length ?? 0
  );

  for (let d = 0; d <= maxDay; d += 0.5) {
    const elapsed = daysSinceLastEvent + d;
    const score = calculatePowerLawRetention(elapsed, lastScore, currentTau, settings.alpha);
    neglectedProjection.push({ day: Number(d.toFixed(1)), score });
  }

  // Future trajectory 2: Reviewed today (오늘 복습 이행 시 가상 시나리오)
  const reviewedProjection: CurvePoint[] = [];
  const boostedTau = calculateComprehensiveTau(
    settings.tau,
    pastAttemptsCount + 1,
    4, // Assume good confidence post-review
    0, // Assume independent completion
    0
  );
  // Hypothetical boost to academic review target (82 ~ 92)
  const hypotheticalPostReviewScore = Math.min(95, Math.max(82, currentScore + 36));

  for (let d = 0; d <= maxDay; d += 0.5) {
    const score = calculatePowerLawRetention(d, hypotheticalPostReviewScore, boostedTau, settings.alpha);
    reviewedProjection.push({ day: Number(d.toFixed(1)), score });
  }

  const examProjectedScoreNeglected = neglectedProjection[neglectedProjection.length - 1]?.score ?? 16;
  const examProjectedScoreReviewed = reviewedProjection[reviewedProjection.length - 1]?.score ?? 84;

  // Generate dynamic date ticks for X-axis in Asia/Seoul
  const dateTicks: { day: number; label: string; dateStr: string; isToday?: boolean; isExam?: boolean }[] = [];

  // Ticks for each event day
  eventsWithRealOffset.forEach((ev) => {
    dateTicks.push({
      day: ev.realDayOffset,
      label: `${ev.realDayOffset}D (${ev.dateFormatted})`,
      dateStr: ev.dateFormatted,
    });
  });

  // Today Tick
  const todayFormatted = formatSeoulDate(referenceDate);
  const existingTodayTick = dateTicks.find((t) => t.day === 0);
  if (existingTodayTick) {
    existingTodayTick.isToday = true;
    existingTodayTick.label = `0D 오늘 (${todayFormatted})`;
  } else {
    dateTicks.push({
      day: 0,
      label: `0D 오늘 (${todayFormatted})`,
      dateStr: todayFormatted,
      isToday: true,
    });
  }

  // Exam Day Tick (or default projection limit)
  const hasExam = examDayOffset > 0;
  const examDateStr = formatSeoulDate(addDaysToDate(referenceDate, examDayOffset));
  dateTicks.push({
    day: maxDay,
    label: hasExam ? `+${maxDay}D 시험일 (${examDateStr})` : `+${maxDay}D 모델전망 (${examDateStr})`,
    dateStr: examDateStr,
    isExam: hasExam,
  });

  // Sort and deduplicate ticks by day
  const uniqueTicks = dateTicks.filter(
    (t, idx, arr) => arr.findIndex((other) => other.day === t.day) === idx
  ).sort((a, b) => a.day - b.day);

  return {
    historyCurve,
    neglectedProjection,
    reviewedProjection,
    currentScore,
    examProjectedScoreNeglected,
    examProjectedScoreReviewed,
    criticalThreshold: settings.threshold,
    dateTicks: uniqueTicks,
    minDay,
    maxDay,
    hasExamDate: hasExam,
    isUnstudied: false,
  };
}
