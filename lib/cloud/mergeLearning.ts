import type { Concept, Problem, ProblemVersionSnapshot, UnsavedProblemRevision, ConceptScheduleAdjustment } from '../types';

function normalizeText(val?: string | null): string {
  if (val === undefined || val === null) return '';
  return val.replace(/\r\n/g, '\n').trim();
}

function normalizeCode(val?: string | null): string {
  if (val === undefined || val === null) return '';
  // Normalize Windows CRLF to LF and strip only leading/trailing newlines.
  // CRITICAL: Preserve all indentation spaces, tabs, and intra-line spacing.
  return val.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

function findMatchingHistorySnapshot(
  unsaved: {
    baseVersion?: number;
    revisionVersion?: number;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): ProblemVersionSnapshot | undefined {
  if (!referenceSnapshots || referenceSnapshots.length === 0) return undefined;
  if (unsaved.baseVersion !== undefined) {
    const byBase = referenceSnapshots.find((s) => s && s.version === unsaved.baseVersion);
    if (byBase) return byBase;
  }
  if (unsaved.revisionVersion !== undefined) {
    const byRev = referenceSnapshots.find((s) => s && s.version === unsaved.revisionVersion);
    if (byRev) return byRev;
  }
  return undefined;
}

function resolveReferenceSnapshot(
  unsaved: {
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): ProblemVersionSnapshot | undefined {
  const fromHistory = findMatchingHistorySnapshot(unsaved, referenceSnapshots);
  if (unsaved.baseSnapshot && fromHistory) {
    return {
      ...fromHistory,
      ...unsaved.baseSnapshot,
      type: unsaved.baseSnapshot.type ?? fromHistory.type,
      conceptIds: unsaved.baseSnapshot.conceptIds ?? fromHistory.conceptIds,
      appliedConditionNote: unsaved.baseSnapshot.appliedConditionNote ?? fromHistory.appliedConditionNote,
    };
  }
  return unsaved.baseSnapshot ?? fromHistory;
}

function hasVerifiableConditionNote(
  unsaved: {
    appliedConditionNote?: string;
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  referenceSnapshots?: ProblemVersionSnapshot[]
): { verifiable: boolean; value?: string } {
  if ('appliedConditionNote' in unsaved && unsaved.appliedConditionNote !== undefined) {
    return { verifiable: true, value: unsaved.appliedConditionNote };
  }
  if (unsaved.baseSnapshot && 'appliedConditionNote' in unsaved.baseSnapshot && unsaved.baseSnapshot.appliedConditionNote !== undefined) {
    return { verifiable: true, value: unsaved.baseSnapshot.appliedConditionNote };
  }
  const refSnap = findMatchingHistorySnapshot(unsaved, referenceSnapshots);
  if (refSnap && 'appliedConditionNote' in refSnap && refSnap.appliedConditionNote !== undefined) {
    return { verifiable: true, value: refSnap.appliedConditionNote };
  }
  return { verifiable: false };
}

/**
 * Checks if unsaved revision content matches remote problem content.
 * Comprehensively compares all meaningful stored fields: prompt, answer, title,
 * formula, code (preserving indentation), hints, full rubric (including description & weight),
 * time standard, type, conceptIds, and applied conditions.
 */
export function isRevisionMatchingProblem(
  unsaved: {
    title?: string;
    promptText?: string;
    type?: Problem['type'];
    conceptIds?: string[];
    modelAnswer?: string;
    rubric?: Problem['rubric'];
    mathFormula?: string;
    codeSnippet?: string;
    hints?: string[];
    timeStandardMinutes?: number;
    appliedConditionNote?: string;
    baseVersion?: number;
    revisionVersion?: number;
    baseSnapshot?: ProblemVersionSnapshot;
  },
  remote: Problem,
  referenceSnapshots?: ProblemVersionSnapshot[]
): boolean {
  if (normalizeText(unsaved.promptText) !== normalizeText(remote.promptText)) return false;
  if (normalizeText(unsaved.modelAnswer) !== normalizeText(remote.modelAnswer)) return false;
  if (normalizeText(unsaved.title) !== normalizeText(remote.title)) return false;
  if (normalizeText(unsaved.mathFormula) !== normalizeText(remote.mathFormula)) return false;
  if (normalizeCode(unsaved.codeSnippet) !== normalizeCode(remote.codeSnippet)) return false;

  const refSnap = resolveReferenceSnapshot(unsaved, referenceSnapshots);

  // Problem type comparison (with fallback to reference snapshot for legacy revisions)
  const expectedType = unsaved.type !== undefined ? unsaved.type : refSnap?.type;
  if (expectedType !== undefined && remote.type !== undefined) {
    if (normalizeText(expectedType) !== normalizeText(remote.type)) return false;
  }

  // Concept IDs comparison (with fallback to reference snapshot for legacy revisions)
  const expectedConcepts = Array.isArray(unsaved.conceptIds)
    ? unsaved.conceptIds
    : Array.isArray(refSnap?.conceptIds)
      ? refSnap.conceptIds
      : undefined;
  if (expectedConcepts !== undefined && Array.isArray(remote.conceptIds)) {
    const uConcepts = [...expectedConcepts].sort();
    const rConcepts = [...remote.conceptIds].sort();
    if (uConcepts.length !== rConcepts.length) return false;
    for (let i = 0; i < uConcepts.length; i++) {
      if (uConcepts[i] !== rConcepts[i]) return false;
    }
  }

  // Applied condition note comparison with backward compatibility for legacy revisions
  const condCheck = hasVerifiableConditionNote(unsaved, referenceSnapshots);
  if (condCheck.verifiable) {
    if (normalizeText(condCheck.value) !== normalizeText(remote.appliedConditionNote)) {
      return false;
    }
  } else if (normalizeText(remote.appliedConditionNote) !== '') {
    // Legacy revision lacks condition note and no reference snapshot has condition note,
    // while remote has a non-empty condition note: cannot verify equivalence without loosening comparison.
    return false;
  }

  // Time standard comparison
  if (unsaved.timeStandardMinutes !== undefined || remote.timeStandardMinutes !== undefined) {
    const uTime = unsaved.timeStandardMinutes !== undefined ? Number(unsaved.timeStandardMinutes) : 0;
    const rTime = remote.timeStandardMinutes !== undefined ? Number(remote.timeStandardMinutes) : 0;
    if (uTime !== rTime) return false;
  }

  // Full rubric comparison (id, label, maxScore, weight, description)
  const uRubric = unsaved.rubric || [];
  const rRubric = remote.rubric || [];
  if (uRubric.length !== rRubric.length) return false;
  for (let i = 0; i < uRubric.length; i++) {
    const ur = uRubric[i];
    const rr = rRubric[i];
    if (
      ur.id !== rr.id ||
      Number(ur.maxScore ?? 0) !== Number(rr.maxScore ?? 0) ||
      Number(ur.weight ?? 0) !== Number(rr.weight ?? 0) ||
      normalizeText(ur.label) !== normalizeText(rr.label) ||
      normalizeText(ur.description) !== normalizeText(rr.description)
    ) {
      return false;
    }
  }

  // Hints comparison
  const uHints = unsaved.hints || [];
  const rHints = remote.hints || [];
  if (uHints.length !== rHints.length) return false;
  for (let i = 0; i < uHints.length; i++) {
    if (normalizeText(uHints[i]) !== normalizeText(rHints[i])) return false;
  }

  return true;
}

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

    // Bug 3: If the adjustment was set before the concept's latest confirmed review attempt,
    // it is an obsolete adjustment from a prior review round and must NOT be resurrected.
    const isObsoleteAdjustment = Boolean(
      adjustment?.updatedAt &&
      mine?.lastAttemptAt &&
      new Date(adjustment.updatedAt).getTime() <= new Date(mine.lastAttemptAt).getTime()
    );

    const activeAdjustment = isObsoleteAdjustment ? undefined : adjustment;

    const postponeDays = activeAdjustment?.postponeDays !== undefined
      ? activeAdjustment.postponeDays
      : (mine?.postponeDays ?? 0);

    const postponedUntil = activeAdjustment?.postponedUntil !== undefined
      ? activeAdjustment.postponedUntil
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
  unsavedRevisions: Record<string, UnsavedProblemRevision> = {},
  onRevisionChange?: (rev: UnsavedProblemRevision) => void
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
    let unrecordedBaseVersion: number | undefined = undefined;

    if (unsaved) {
      const serverVersion = remote.version ?? 1;
      const referenceSnapshots = [...(versionHistory || []), ...(mine?.versionHistory || [])];
      const isIdentical = isRevisionMatchingProblem(unsaved, remote, referenceSnapshots);

      if (serverVersion >= unsaved.baseVersion && isIdentical) {
        // Server already has this exact revised content (idempotent retry / response loss)
        if (unsaved.syncStatus !== 'synced') {
          const updatedRev: UnsavedProblemRevision = { ...unsaved, syncStatus: 'synced' };
          unsavedRevisions[remote.id] = updatedRev;
          onRevisionChange?.(updatedRev);
        }
        contentToApply = remote;
        effectiveVersion = serverVersion;
      } else if (serverVersion <= unsaved.baseVersion) {
        // Revision branched from this or older server version, and remote hasn't advanced past base: apply revised content!
        const condCheck = hasVerifiableConditionNote(unsaved, referenceSnapshots);
        contentToApply = {
          ...remote,
          title: unsaved.title,
          promptText: unsaved.promptText,
          type: unsaved.type ?? remote.type,
          conceptIds: unsaved.conceptIds ?? remote.conceptIds,
          mathFormula: unsaved.mathFormula,
          codeSnippet: unsaved.codeSnippet,
          hints: unsaved.hints,
          modelAnswer: unsaved.modelAnswer,
          rubric: unsaved.rubric,
          timeStandardMinutes: unsaved.timeStandardMinutes ?? remote.timeStandardMinutes,
          appliedConditionNote: condCheck.verifiable ? condCheck.value : remote.appliedConditionNote,
        };
        effectiveVersion = unsaved.revisionVersion;
        hasActiveUnsavedRevision = true;
        if (unsaved.baseSnapshot) {
          const existingHist = combinedHistory || [];
          const alreadyHasBase = existingHist.some((s) => s.version === unsaved.baseSnapshot!.version);
          combinedHistory = alreadyHasBase ? existingHist : [unsaved.baseSnapshot, ...existingHist];
        }
      } else {
        // serverVersion > unsaved.baseVersion and content differs:
        // Check if this is a legacy ambiguous baseVersion where the user actually edited on top of `remote`
        // (e.g. baseSnapshot matches `remote`, or local problem already confirmed `serverVersion`).
        const condCheck = hasVerifiableConditionNote(unsaved, referenceSnapshots);
        const isVerifiableLegacyBaseOnRemote = Boolean(
          condCheck.verifiable &&
          ((unsaved.baseSnapshot && isRevisionMatchingProblem(unsaved.baseSnapshot, remote, referenceSnapshots)) ||
            mine?.serverConfirmedVersion === serverVersion ||
            mine?.versionHistory?.some(
              (s) => s.version === serverVersion && isRevisionMatchingProblem(s, remote, referenceSnapshots)
            ))
        );

        if (isVerifiableLegacyBaseOnRemote) {
          const rebasedSnapshot: ProblemVersionSnapshot = {
            version: serverVersion,
            title: remote.title,
            promptText: remote.promptText,
            type: remote.type,
            conceptIds: [...(remote.conceptIds || [])],
            mathFormula: remote.mathFormula,
            codeSnippet: remote.codeSnippet,
            timeStandardMinutes: remote.timeStandardMinutes,
            appliedConditionNote: remote.appliedConditionNote,
            hints: [...(remote.hints || [])],
            modelAnswer: remote.modelAnswer,
            rubric: [...(remote.rubric || [])],
            editedAt: remote.lastReviewedAt || unsaved.revisedAt,
            editReason: '서버 확인 기준 스냅샷',
          };
          const rebasedRevVer = Math.max(unsaved.revisionVersion, serverVersion + 1);
          const repairedRev: UnsavedProblemRevision = {
            ...unsaved,
            baseVersion: serverVersion,
            revisionVersion: rebasedRevVer,
            baseSnapshot: rebasedSnapshot,
            syncStatus: unsaved.syncStatus === 'conflict' ? 'pending' : unsaved.syncStatus,
            syncError: undefined,
          };
          unsavedRevisions[remote.id] = repairedRev;
          onRevisionChange?.(repairedRev);

          contentToApply = {
            ...remote,
            title: unsaved.title,
            promptText: unsaved.promptText,
            type: unsaved.type ?? remote.type,
            conceptIds: unsaved.conceptIds ?? remote.conceptIds,
            mathFormula: unsaved.mathFormula,
            codeSnippet: unsaved.codeSnippet,
            hints: unsaved.hints,
            modelAnswer: unsaved.modelAnswer,
            rubric: unsaved.rubric,
            timeStandardMinutes: unsaved.timeStandardMinutes ?? remote.timeStandardMinutes,
            appliedConditionNote: condCheck.value,
          };
          effectiveVersion = rebasedRevVer;
          hasActiveUnsavedRevision = true;
          const existingHist = combinedHistory || [];
          const alreadyHasBase = existingHist.some((s) => s.version === serverVersion);
          combinedHistory = alreadyHasBase ? existingHist : [rebasedSnapshot, ...existingHist];
        } else {
          // Remote server has advanced past local baseVersion and cannot be verified as the edit's base:
          // preserve revision and inform user!
          const matchesWithoutCondition =
            !condCheck.verifiable &&
            normalizeText(remote.appliedConditionNote) !== '' &&
            isRevisionMatchingProblem(
              { ...unsaved, appliedConditionNote: remote.appliedConditionNote },
              remote,
              referenceSnapshots
            );
          const conflictReason = matchesWithoutCondition
            ? `기존 형식 수정본의 적용 조건(appliedConditionNote) 기준 스냅샷을 확인할 수 없어 수정본을 보존했습니다 (서버: v${serverVersion})`
            : `서버 버전 충돌 (서버: v${serverVersion}, 수정 기준: v${unsaved.baseVersion})`;
          const updatedRev: UnsavedProblemRevision = {
            ...unsaved,
            syncStatus: 'conflict',
            syncError: conflictReason,
          };
          unsavedRevisions[remote.id] = updatedRev;
          onRevisionChange?.(updatedRev);
          contentToApply = remote;
        }
      }
    } else if (mine && (mine.version ?? 1) > (remote.version ?? 1) && mine.qualityStatus === 'review_after_edit') {
      contentToApply = {
        ...remote,
        title: mine.title,
        promptText: mine.promptText,
        type: mine.type ?? remote.type,
        conceptIds: mine.conceptIds ?? remote.conceptIds,
        mathFormula: mine.mathFormula,
        codeSnippet: mine.codeSnippet,
        hints: mine.hints,
        modelAnswer: mine.modelAnswer,
        rubric: mine.rubric,
        timeStandardMinutes: mine.timeStandardMinutes ?? remote.timeStandardMinutes,
        appliedConditionNote: mine.appliedConditionNote !== undefined ? mine.appliedConditionNote : remote.appliedConditionNote,
      };
      effectiveVersion = mine.version ?? (remote.version ?? 1) + 1;
      hasActiveUnsavedRevision = true;
      unrecordedBaseVersion = mine.localUnrecordedBaseVersion ?? (remote.version ?? 1);
      if (mine.versionHistory) {
        combinedHistory = mine.versionHistory;
      }
    }

    const activeRev = unsavedRevisions[remote.id] ?? unsaved;
    const isConflict = activeRev?.syncStatus === 'conflict';
    let reviewNotes = remote.reviewNotes ?? mine?.reviewNotes;
    if (hasActiveUnsavedRevision && activeRev) {
      reviewNotes = `v${effectiveVersion} 수정 완료: ${activeRev.editReason}`;
    } else if (isConflict && activeRev) {
      reviewNotes = `[충돌 대기] ${activeRev.syncError || '서버 버전과 충돌한 미저장 수정본이 보존됨'}: ${activeRev.editReason}`;
    }

    return {
      ...contentToApply,
      version: effectiveVersion,
      serverConfirmedVersion: remote.version ?? 1,
      localUnrecordedBaseVersion: unrecordedBaseVersion,
      qualityStatus: hasActiveUnsavedRevision ? 'review_after_edit' : resolveProblemQualityStatus(remote, mine),
      ...(combinedHistory ? { versionHistory: combinedHistory } : {}),
      ...(mine || activeRev
        ? {
            reports: mergeReports(remote.reports, mine?.reports),
            isOutdated: remote.isOutdated ?? false,
            needsSourceReview: remote.needsSourceReview ?? false,
            lastReviewedAt: remote.lastReviewedAt ?? mine?.lastReviewedAt,
            reviewNotes,
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
        const updatedRev: UnsavedProblemRevision = {
          ...unsavedRevisions[id],
          syncStatus: 'conflict',
          syncError: '서버에서 삭제된 문제의 미저장 수정본',
        };
        unsavedRevisions[id] = updatedRev;
        onRevisionChange?.(updatedRev);
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
