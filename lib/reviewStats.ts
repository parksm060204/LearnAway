import type { Concept } from './types';

/**
 * Review statistics over real records only.
 *
 * Nothing here fabricates scores or dates: when no evaluation record exists
 * the caller must render an honest empty state ('평가 기록 없음').
 */

/** Latest review-event timestamp across concepts, or null when there is none. */
export function lastEvaluationAtISO(concepts: Array<Pick<Concept, 'events'>>): string | null {
  let latest: number | null = null;
  for (const concept of concepts) {
    for (const event of concept.events ?? []) {
      if (!event?.at) continue;
      const t = Date.parse(event.at);
      if (!Number.isFinite(t)) continue;
      if (latest === null || t > latest) latest = t;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/** Korean display text: a real date or an explicit 'no records' message. */
export function formatEvaluationDate(iso: string | null | undefined): string {
  if (!iso) return '평가 기록 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '평가 기록 없음';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
