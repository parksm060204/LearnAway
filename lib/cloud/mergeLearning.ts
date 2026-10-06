import type { Concept, Problem, ProblemVersionSnapshot } from '../types';

/**
 * Server concepts are authoritative. Locally-derived review state (events,
 * scores, schedule) stays local and is merged by id; un-migrated originals
 * (never on the server, never migrated) are kept as un-synced. Records that were
 * migrated and then deleted on the server are NOT resurrected.
 */
export function mergeConcepts(
  server: Concept[],
  originals: Concept[],
  migratedIds: Set<string> = new Set()
): Concept[] {
  const originById = new Map(originals.map((c) => [c.id, c]));
  const serverIds = new Set(server.map((c) => c.id));
  const merged = server.map((remote) => {
    const mine = originById.get(remote.id);
    if (!mine) return remote;
    return {
      ...remote,
      events: mine.events ?? [],
      currentScore: mine.currentScore,
      baseScore: mine.baseScore,
      status: mine.status,
      lastAttemptAt: mine.lastAttemptAt,
      lastAttemptDayOffset: mine.lastAttemptDayOffset,
      firstLearnedAt: mine.firstLearnedAt,
      firstLearnedDayOffset: mine.firstLearnedDayOffset,
      recommendedReviewAt: mine.recommendedReviewAt,
      lastCalculatedAt: mine.lastCalculatedAt,
      postponedUntil: mine.postponedUntil,
      postponeDays: mine.postponeDays,
      needsSourceReview: mine.needsSourceReview ?? remote.needsSourceReview,
      sourceEvidence: mine.sourceEvidence ?? remote.sourceEvidence,
    };
  });
  const unSynced = originals.filter((o) => !serverIds.has(o.id) && !migratedIds.has(o.id));
  return [...merged, ...unSynced];
}

/** Server problems are authoritative; version history + local quality metadata
 *  and un-migrated originals are preserved. */
export function mergeProblems(
  server: Problem[],
  originals: Problem[],
  versions: Record<string, ProblemVersionSnapshot[]>,
  migratedIds: Set<string> = new Set()
): Problem[] {
  const originById = new Map(originals.map((p) => [p.id, p]));
  const serverIds = new Set(server.map((p) => p.id));
  const merged = server.map((remote) => {
    const mine = originById.get(remote.id);
    const versionHistory = versions[remote.id];
    return {
      ...remote,
      ...(versionHistory ? { versionHistory } : {}),
      ...(mine
        ? {
            reports: mine.reports ?? remote.reports ?? [],
            qualityStatus: mine.qualityStatus ?? remote.qualityStatus,
            isOutdated: mine.isOutdated ?? remote.isOutdated,
            needsSourceReview: mine.needsSourceReview ?? remote.needsSourceReview,
            lastReviewedAt: mine.lastReviewedAt,
            reviewNotes: mine.reviewNotes,
          }
        : {}),
    };
  });
  const unSynced = originals.filter((o) => !serverIds.has(o.id) && !migratedIds.has(o.id));
  return [...merged, ...unSynced];
}

/** Server drafts replace originals, but un-migrated drafts (never on the server,
 *  never migrated) are kept so unpersisted edits are not silently dropped. */
export function mergeDrafts<T extends { id: string }>(
  server: T[],
  originals: T[],
  migratedIds: Set<string> = new Set()
): T[] {
  const serverIds = new Set(server.map((d) => d.id));
  return [...server, ...originals.filter((d) => !serverIds.has(d.id) && !migratedIds.has(d.id))];
}
