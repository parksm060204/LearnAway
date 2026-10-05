import type { MockExamSession, StudyPlanItem, StudyPlanSummary } from './types';

/**
 * Today-study helpers (pure).
 *
 * The main page shows only a compact summary: the top pending items for today,
 * an estimated time only when real data exists, and one primary action.
 * The full list and the plan's priority/round math live in the study-plan flow.
 */

export interface TodayStudyDigest {
  /** Top pending items for today, already sorted by priority. */
  items: StudyPlanItem[];
  /** Total pending items today (including those beyond the visible slice). */
  pendingCount: number;
  /** Sum of the visible items' estimates; null when there is no data. */
  estimatedMinutes: number | null;
  /** '예상 NN분' when data exists, otherwise null (never a fabricated number). */
  estimateText: string | null;
}

export function getTodayPendingItems(
  summary: StudyPlanSummary | null | undefined,
  limit = 4
): TodayStudyDigest {
  const empty: TodayStudyDigest = { items: [], pendingCount: 0, estimatedMinutes: null, estimateText: null };
  if (!summary) return empty;
  const day = summary.days.find((d) => d.date === summary.todayDate);
  if (!day) return empty;
  const pending = (day.items ?? [])
    .filter((i) => i.status === 'pending' || i.status === 'in_progress')
    .slice()
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const items = pending.slice(0, Math.max(1, limit));
  if (items.length === 0) return empty;
  const estimatedMinutes = items.reduce((sum, i) => sum + (i.estimatedMinutes || 0), 0);
  return {
    items,
    pendingCount: pending.length,
    estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : null,
    estimateText: estimatedMinutes > 0 ? `예상 ${estimatedMinutes}분` : null,
  };
}

export type PrimaryCta =
  | { kind: 'resume-mock'; sessionId: string }
  | { kind: 'start-item'; itemId: string }
  | null;

/**
 * One primary action for the exam summary card: resume a live mock exam
 * session when one exists, otherwise start the first pending item.
 * Matches the mock-exam modal's own resume definition (anything not yet
 * recorded or abandoned).
 */
export function resolvePrimaryCta(
  activeMock: MockExamSession | null | undefined,
  firstPending: StudyPlanItem | null | undefined
): PrimaryCta {
  if (activeMock && activeMock.status !== 'recorded' && activeMock.status !== 'abandoned') {
    return { kind: 'resume-mock', sessionId: activeMock.id };
  }
  if (firstPending) return { kind: 'start-item', itemId: firstPending.id };
  return null;
}
