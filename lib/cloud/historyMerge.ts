import type { Concept, ReviewEvent } from '../types';
import { calculateCurrentConceptScore, getConceptStatusFromScore } from '../retentionModel';

/** Server history is authoritative; local-only rows (not yet migrated) are kept. */
export function mergeById<T extends { id: string }>(server: T[], local: T[]): T[] {
  const serverIds = new Set(server.map((item) => item.id));
  return [...server, ...local.filter((item) => !serverIds.has(item.id))];
}

/**
 * Merges server review events into local concepts by concept id, deduping by
 * event id and attempt id, then recomputes the retention score/status so history
 * from another device is reflected. Past results are never altered.
 */
export function mergeEventsIntoConcepts(
  concepts: Concept[],
  events: ReviewEvent[],
  settings: Parameters<typeof calculateCurrentConceptScore>[1],
  referenceDate: Date
): Concept[] {
  if (events.length === 0) return concepts;
  const byConcept = new Map<string, ReviewEvent[]>();
  for (const event of events) {
    const list = byConcept.get(event.conceptId) ?? [];
    list.push(event);
    byConcept.set(event.conceptId, list);
  }

  return concepts.map((concept) => {
    const additions = byConcept.get(concept.id);
    if (!additions || additions.length === 0) return concept;
    const existing = concept.events ?? [];
    const seenIds = new Set(existing.map((e) => e.id));
    const seenAttemptIds = new Set(existing.map((e) => e.attemptId).filter(Boolean) as string[]);
    const fresh: ReviewEvent[] = [];
    for (const event of additions) {
      if (seenIds.has(event.id)) continue;
      if (event.attemptId && seenAttemptIds.has(event.attemptId)) continue;
      fresh.push(event);
      seenIds.add(event.id);
      if (event.attemptId) seenAttemptIds.add(event.attemptId);
    }
    if (fresh.length === 0) return concept;

    const merged = [...existing, ...fresh].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );
    const currentScore = calculateCurrentConceptScore(merged, settings, referenceDate);
    const status = getConceptStatusFromScore(currentScore);
    const attemptCount = merged.filter((e) => e.kind === 'attempt').length;
    return {
      ...concept,
      events: merged,
      currentScore,
      status,
      isLearned: true,
      exerciseCount: Math.max(concept.exerciseCount, attemptCount),
      lastAttemptAt: merged[merged.length - 1]?.at ?? concept.lastAttemptAt,
    };
  });
}
