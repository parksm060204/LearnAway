import type { Concept, Problem, ProblemVersionSnapshot, UnsavedProblemRevision, ConceptScheduleAdjustment } from '../types';
import { saveUnsavedProblemRevision } from '../storage';

/**
 * Server concepts are authoritative for content, quality, and source review.
 * Locally-derived review state (events, scores, schedule) stays local and is merged by id;
 * un-migrated originals (never on the server, never migrated) are kept as un-synced.
 * Records that were migrated and then deleted on the server are NOT resurrected.
 */
export function mergeConcepts(
  server: Concept[],
  originals: Concept[],
  migratedIds: Set<string> = new Set(),
  serverKnownIds: Set<string> = new Set(),
  scheduleAdjustments: Record<string, ConceptScheduleAdjustment> = {}
): Concept[] {
  const originById = new Map(originals.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const serverIds = new Set(server.map((c) => c.id));
  const merged = server.map((remote) => {
    seenIds.add(remote.id);
    const mine = originById.get(remote.id);
    const adjustment = scheduleAdjustments[remote.id];

    const postponeDays = adjustment?.postponeDays !== undefined
      ? adjustment.postponeDays
      : (mine?.postponeDays ?? 0);

    const postponedUntil = adjustment?.postponedUntil !== undefined
      ? adjustment.postponedUntil
      : mine?.postponedUntil;

    return {
      ...remote,
      events: mine?.events ?? [],
      currentScore: mine?.currentScore ?? remote.currentScore ?? 0,
      baseScore: mine?.baseScore ?? remote.baseScore ?? 0,
      status: mine?.status ?? remote.status ?? 'not_started',
      lastAttemptAt: mine?.lastAttemptAt ?? remote.lastAttemptAt,
      lastAttemptDayOffset: mine?.lastAttemptDayOffset ?? remote.lastAttemptDayOffset,
      firstLearnedAt: mine?.firstLearnedAt ?? remote.firstLearnedAt,
      firstLearnedDayOffset: mine?.firstLearnedDayOffset ?? remote.firstLearnedDayOffset,
      recommendedReviewAt: mine?.recommendedReviewAt ?? remote.recommendedReviewAt,
      lastCalculatedAt: mine?.lastCalculatedAt ?? remote.lastCalculatedAt,
      postponedUntil,
      postponeDays,
      // Server is authoritative for needsSourceReview and sourceEvidence for server-known concepts
      needsSourceReview: remote.needsSourceReview ?? false,
      sourceEvidence: remote.sourceEvidence ?? mine?.sourceEvidence,
    };
  });
  const unSynced: Concept[] = [];
  for (const o of originals) {
    if (seenIds.has(o.id) || serverIds.has(o.id) || migratedIds.has(o.id) || serverKnownIds.has(o.id)) continue;
    seenIds.add(o.id);
    unSynced.push(o);
  }
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
 * un-migrated originals are preserved.
 *
 * Conflict and deduplication invariants:
 * 1. Output problem IDs are strictly unique.
 * 2. Candidates with identical IDs are resolved deterministically: higher version or active
 *    local revision wins, and reports from all candidate snapshots are preserved without loss.
 * 3. Deleted server cache (records previously known on server or migrated, but absent from
 *    server) are NOT resurrected unless they contain genuine unpersisted local edits or reports.
 */
export function mergeProblems(
  server: Problem[],
  originals: Problem[],
  versions: Record<string, ProblemVersionSnapshot[]>,
  migratedIds: Set<string> = new Set(),
  serverKnownIds: Set<string> = new Set(),
  unsavedRevisions: Record<string, UnsavedProblemRevision> = {}
): Problem[] {
  // Consolidate candidate problems with conflict resolution:
  // Deduplicate candidates by problem ID so duplicate entries (e.g. from live and origin) produce exactly 1 entry.
  // When candidates collide, the one with higher version, active revision (review_after_edit), or newer reports wins,
  // and all reports are merged so no user report is lost.
  const candidateMap = new Map<string, Problem>();
  for (const cand of originals) {
    if (!cand || !cand.id) continue;
    const existing = candidateMap.get(cand.id);
    if (!existing) {
      candidateMap.set(cand.id, cand);
    } else {
      const existingVer = existing.version ?? 1;
      const candVer = cand.version ?? 1;
      const mergedReports = mergeReports(existing.reports, cand.reports);
      let chosen = existing;
      if (candVer > existingVer) {
        chosen = cand;
      } else if (candVer === existingVer) {
        if (cand.qualityStatus === 'review_after_edit' && existing.qualityStatus !== 'review_after_edit') {
          chosen = cand;
        } else if ((cand.reports?.length ?? 0) > (existing.reports?.length ?? 0)) {
          chosen = cand;
        }
      }
      candidateMap.set(cand.id, {
        ...chosen,
        reports: mergedReports,
      });
    }
  }

  const seenProblemIds = new Set<string>();
  const serverIds = new Set(server.map((p) => p.id));

  // Server problems are authoritative, with unsaved revisions preserved
  const merged = server.map((remote) => {
    seenProblemIds.add(remote.id);
    const mine = candidateMap.get(remote.id);
    const versionHistory = versions[remote.id];
    const unsaved = unsavedRevisions[remote.id];

    let contentToApply = remote;
    let effectiveVersion = remote.version ?? 1;
    let combinedHistory = versionHistory;
    let hasActiveUnsavedRevision = false;

    if (unsaved) {
      if ((remote.version ?? 1) === unsaved.baseVersion) {
        // Revision branched from current server version: apply revised content!
        contentToApply = {
          ...remote,
          title: unsaved.title,
          promptText: unsaved.promptText,
          mathFormula: unsaved.mathFormula,
          codeSnippet: unsaved.codeSnippet,
          hints: unsaved.hints,
          modelAnswer: unsaved.modelAnswer,
          rubric: unsaved.rubric,
          timeStandardMinutes: unsaved.timeStandardMinutes ?? remote.timeStandardMinutes,
        };
        effectiveVersion = unsaved.revisionVersion;
        hasActiveUnsavedRevision = true;
        if (unsaved.baseSnapshot) {
          combinedHistory = [unsaved.baseSnapshot, ...(combinedHistory || [])];
        }
      } else if ((remote.version ?? 1) === unsaved.revisionVersion) {
        // Server already has this version
        unsaved.syncStatus = 'pending';
      } else if ((remote.version ?? 1) > unsaved.baseVersion) {
        // Remote conflict!
        unsaved.syncStatus = 'conflict';
        unsaved.syncError = `서버 버전 충돌 (서버: v${remote.version}, 수정 기준: v${unsaved.baseVersion})`;
        saveUnsavedProblemRevision(unsaved);
        contentToApply = remote;
      }
    } else if (mine && (mine.version ?? 1) > (remote.version ?? 1) && mine.qualityStatus === 'review_after_edit') {
      contentToApply = {
        ...remote,
        title: mine.title,
        promptText: mine.promptText,
        mathFormula: mine.mathFormula,
        codeSnippet: mine.codeSnippet,
        hints: mine.hints,
        modelAnswer: mine.modelAnswer,
        rubric: mine.rubric,
        timeStandardMinutes: mine.timeStandardMinutes ?? remote.timeStandardMinutes,
      };
      effectiveVersion = mine.version ?? (remote.version ?? 1) + 1;
      hasActiveUnsavedRevision = true;
      if (mine.versionHistory) {
        combinedHistory = mine.versionHistory;
      }
    }

    return {
      ...contentToApply,
      version: effectiveVersion,
      qualityStatus: hasActiveUnsavedRevision ? 'review_after_edit' : resolveProblemQualityStatus(remote, mine),
      ...(combinedHistory ? { versionHistory: combinedHistory } : {}),
      ...(mine
        ? {
            reports: mergeReports(remote.reports, mine.reports),
            isOutdated: remote.isOutdated ?? false,
            needsSourceReview: remote.needsSourceReview ?? false,
            lastReviewedAt: remote.lastReviewedAt ?? mine.lastReviewedAt,
            reviewNotes: hasActiveUnsavedRevision && unsaved
              ? `v${effectiveVersion} 수정 완료: ${unsaved.editReason}`
              : (remote.reviewNotes ?? mine.reviewNotes),
          }
        : {}),
    };
  });

  // Process unSynced problems: only pure unmigrated local problems
  const unSynced: Problem[] = [];
  for (const [id, cand] of candidateMap.entries()) {
    if (seenProblemIds.has(id)) continue;

    const isServerKnown = serverIds.has(id) || migratedIds.has(id) || serverKnownIds.has(id);
    if (isServerKnown) {
      // Problem was known to the server previously, but is absent from current server list:
      // It was deleted on the server!
      // Do NOT resurrect deleted server cache into unSynced.
      if (unsavedRevisions[id]) {
        unsavedRevisions[id].syncStatus = 'conflict';
        unsavedRevisions[id].syncError = '서버에서 삭제된 문제의 미저장 수정본';
        saveUnsavedProblemRevision(unsavedRevisions[id]);
      }
      continue;
    }

    seenProblemIds.add(id);
    unSynced.push(cand);
  }

  return [...merged, ...unSynced];
}

/** Server drafts replace originals, but un-migrated drafts (never on the server,
 *  never migrated) are kept so unpersisted edits are not silently dropped. */
export function mergeDrafts<T extends { id: string }>(
  server: T[],
  originals: T[],
  migratedIds: Set<string> = new Set()
): T[] {
  const seenIds = new Set(server.map((d) => d.id));
  const unSynced: T[] = [];
  for (const d of originals) {
    if (seenIds.has(d.id) || migratedIds.has(d.id)) continue;
    seenIds.add(d.id);
    unSynced.push(d);
  }
  return [...server, ...unSynced];
}
