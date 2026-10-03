import type { Concept, Problem, ProblemVersionSnapshot } from '../types';

/**
 * Server concept definitions are authoritative, but locally-derived review
 * state (events, scores, schedule) stays local in this stage and must not be
 * lost when the server copy is loaded.
 */
export function mergeConcepts(server: Concept[], local: Concept[]): Concept[] {
  const localById = new Map(local.map((c) => [c.id, c]));
  return server.map((remote) => {
    const mine = localById.get(remote.id);
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
    };
  });
}

/**
 * Server problems are authoritative. Immutable version history and locally
 * managed quality metadata (reports, review notes) are preserved.
 */
export function mergeProblems(
  server: Problem[],
  local: Problem[],
  versions: Record<string, ProblemVersionSnapshot[]>
): Problem[] {
  const localById = new Map(local.map((p) => [p.id, p]));
  return server.map((remote) => {
    const mine = localById.get(remote.id);
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
}

/**
 * Server drafts replace local ones, but local-only drafts (e.g. a generation
 * whose server save failed and has not been retried) are kept so unpersisted
 * edits are never silently dropped.
 */
export function mergeDrafts<T extends { id: string }>(server: T[], local: T[]): T[] {
  const serverIds = new Set(server.map((d) => d.id));
  return [...server, ...local.filter((d) => !serverIds.has(d.id))];
}
