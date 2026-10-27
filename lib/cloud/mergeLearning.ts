import type { Concept, Problem, ProblemVersionSnapshot } from '../types';

/**
 * Server concepts are authoritative for content, quality, and source review.
 * Locally-derived review state (events, scores, schedule) stays local and is merged by id;
 * un-migrated originals (never on the server, never migrated) are kept as un-synced.
 * Records that were migrated and then deleted on the server are NOT resurrected.
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
      // Server is authoritative for needsSourceReview and sourceEvidence for server-known concepts
      needsSourceReview: remote.needsSourceReview ?? false,
      sourceEvidence: remote.sourceEvidence ?? mine.sourceEvidence,
    };
  });
  const unSynced = originals.filter((o) => !serverIds.has(o.id) && !migratedIds.has(o.id));
  return [...merged, ...unSynced];
}

function mergeReports(remoteReports?: Problem['reports'], localReports?: Problem['reports']) {
  const rList = remoteReports ?? [];
  const lList = localReports ?? [];
  const seenIds = new Set(rList.map((r) => r.id));
  const combined = [...rList];
  for (const lr of lList) {
    if (!seenIds.has(lr.id)) {
      combined.push(lr);
      seenIds.add(lr.id);
    }
  }
  return combined;
}

function resolveProblemQualityStatus(
  remote: Problem,
  mine?: Problem
): Problem['qualityStatus'] {
  const remoteStatus = remote.qualityStatus ?? 'normal';
  if (!mine) return remoteStatus;
  const localStatus = mine.qualityStatus ?? 'normal';

  // Server quarantine or suspension is authoritative and cannot be overwritten by stale local state
  if (remoteStatus === 'suspended' || (remoteStatus as string) === 'quarantined') {
    return remoteStatus;
  }

  // Server re-approval overrides local reported status and clears past warnings
  if (remoteStatus === 'reapproved') {
    return remoteStatus;
  }

  // If local has genuine un-synced reports (reports not present on server), preserve local reported status
  const remoteReportIds = new Set((remote.reports || []).map((r) => r.id));
  const hasUnsavedLocalReports = (mine.reports || []).some((r) => !remoteReportIds.has(r.id));
  if (hasUnsavedLocalReports) {
    return localStatus === 'under_review' ? 'under_review' : 'reported';
  }

  // If local problem was actively revised locally (version higher than server version)
  if ((mine.version ?? 1) > (remote.version ?? 1) && localStatus === 'review_after_edit') {
    return 'review_after_edit';
  }

  // Otherwise, server qualityStatus is authoritative
  return remoteStatus;
}

/**
 * Server problems are authoritative for content, version history, quarantine,
 * isOutdated, and needsSourceReview. Local review notes, un-synced reports, and
 * un-migrated originals are preserved. Records that were migrated and deleted on
 * the server are NOT resurrected.
 */
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
            reports: mergeReports(remote.reports, mine.reports),
            qualityStatus: resolveProblemQualityStatus(remote, mine),
            // Server is authoritative for freshness and source review for server-known problems
            isOutdated: remote.isOutdated ?? false,
            needsSourceReview: remote.needsSourceReview ?? false,
            lastReviewedAt: remote.lastReviewedAt ?? mine.lastReviewedAt,
            reviewNotes: remote.reviewNotes ?? mine.reviewNotes,
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
