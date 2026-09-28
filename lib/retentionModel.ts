import { Concept, ConceptStatus, RetentionModelSettings, ReviewEvent } from './types';

/**
 * DEFAULT ACADEMIC DEMO PARAMETERS
 * NOTE: These parameters are strictly for academic demonstration and relative review scheduling.
 * They represent a demo model score (0-100), NOT verified medical memory retention or absolute test predictions.
 */
export const DEFAULT_RETENTION_SETTINGS: RetentionModelSettings = {
  tau: 2.5,       // Base memory stability scale in days (calibrated for demo)
  alpha: 0.55,    // Decay power exponent (calibrated for demo: yields 48.0 at Day 0)
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
 */
export function getEffectiveTau(baseTau: number, reviewCount: number): number {
  return baseTau * (1 + 0.15 * Math.max(0, reviewCount));
}

/**
 * Calculates a concept's current model score at reference Day 0 based on its event history.
 */
export function calculateCurrentConceptScore(
  events: ReviewEvent[],
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  referenceDayOffset: number = 0
): number {
  if (!events || events.length === 0) return 0;

  // Filter events up to reference day and sort ascending
  const pastEvents = events
    .filter((e) => e.dayOffset <= referenceDayOffset)
    .sort((a, b) => a.dayOffset - b.dayOffset);

  if (pastEvents.length === 0) return 0;

  const lastEvent = pastEvents[pastEvents.length - 1];
  const daysSinceLastEvent = referenceDayOffset - lastEvent.dayOffset;
  const reviewCount = pastEvents.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
  const effectiveTau = getEffectiveTau(settings.tau, reviewCount);

  return calculatePowerLawRetention(daysSinceLastEvent, lastEvent.resultScore, effectiveTau, settings.alpha);
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

export interface CurvePoint {
  day: number;
  score: number;
  isEventPoint?: boolean;
  eventLabel?: string;
  isToday?: boolean;
}

export interface TrajectoryProjection {
  historyCurve: CurvePoint[];
  neglectedProjection: CurvePoint[];
  reviewedProjection: CurvePoint[];
  currentScore: number;
  examProjectedScoreNeglected: number;
  examProjectedScoreReviewed: number;
  criticalThreshold: number;
}

/**
 * Generates continuous curve coordinates for SVG visualization
 */
export function generateConceptTrajectory(
  concept: Concept,
  settings: RetentionModelSettings = DEFAULT_RETENTION_SETTINGS,
  examDayOffset: number = 14
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
    };
  }

  const events = [...concept.events].sort((a, b) => a.dayOffset - b.dayOffset);
  const historyCurve: CurvePoint[] = [];

  const startDay = events.length > 0 ? Math.min(events[0].dayOffset, -9) : -9;
  const today = 0;

  // Build piecewise historical curve
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const nextEv = events[i + 1];
    const segmentEndDay = nextEv ? nextEv.dayOffset : today;

    // Review count up to this point
    const priorReviews = events.slice(0, i).filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
    const effectiveTau = getEffectiveTau(settings.tau, priorReviews);

    // Initial event point
    historyCurve.push({
      day: ev.dayOffset,
      score: ev.resultScore,
      isEventPoint: true,
      eventLabel: `${ev.title} (${ev.resultScore}점)`,
    });

    // Interpolate decay up to next event or today
    const step = 0.5;
    for (let d = ev.dayOffset + step; d <= segmentEndDay; d += step) {
      const elapsed = d - ev.dayOffset;
      const decayedScore = calculatePowerLawRetention(elapsed, ev.resultScore, effectiveTau, settings.alpha);
      historyCurve.push({
        day: d,
        score: decayedScore,
      });
    }
  }

  const currentScore = calculateCurrentConceptScore(events, settings, 0);

  // Future trajectory 1: Neglected (방치 시)
  const neglectedProjection: CurvePoint[] = [];
  const pastAttemptsCount = events.filter((e) => e.kind === 'attempt' || e.kind === 'review').length;
  const currentTau = getEffectiveTau(settings.tau, pastAttemptsCount);
  
  const lastEvent = events[events.length - 1];
  const daysSinceLastEvent = lastEvent ? 0 - lastEvent.dayOffset : 0;
  const lastScore = lastEvent ? lastEvent.resultScore : currentScore;

  for (let d = 0; d <= examDayOffset; d += 0.5) {
    const elapsed = daysSinceLastEvent + d;
    const score = calculatePowerLawRetention(elapsed, lastScore, currentTau, settings.alpha);
    neglectedProjection.push({ day: d, score });
  }

  // Future trajectory 2: Reviewed today (복습 이행 시)
  // Assuming successful university review score boost to ~85
  const reviewedProjection: CurvePoint[] = [];
  const boostedTau = getEffectiveTau(settings.tau, pastAttemptsCount + 1);
  const hypotheticalPostReviewScore = Math.min(95, Math.max(82, currentScore + 36));

  for (let d = 0; d <= examDayOffset; d += 0.5) {
    const score = calculatePowerLawRetention(d, hypotheticalPostReviewScore, boostedTau, settings.alpha);
    reviewedProjection.push({ day: d, score });
  }

  const examProjectedScoreNeglected = neglectedProjection[neglectedProjection.length - 1]?.score ?? 16;
  const examProjectedScoreReviewed = reviewedProjection[reviewedProjection.length - 1]?.score ?? 84;

  return {
    historyCurve,
    neglectedProjection,
    reviewedProjection,
    currentScore,
    examProjectedScoreNeglected,
    examProjectedScoreReviewed,
    criticalThreshold: settings.threshold,
  };
}
