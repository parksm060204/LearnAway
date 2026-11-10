import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Problem,
  UnsavedProblemRevision,
} from './types';
import {
  reviseProblem,
  getProblemById,
  getProblemVersionSnapshot,
  verifyProblemVersionSnapshotOnServer,
  type ReviseProblemRepoResult,
  type ReviseProblemVerificationFailedResult,
  type ReviseProblemFailureReason,
} from './cloud/learningRepository';
import {
  isRevisionMatchingProblem,
  isCompleteProblemSnapshot,
  snapshotEvaluationMatchesProblem,
} from './problemComparison';
import {
  loadStoredProblems,
  getInMemoryProblem,
  getUnsavedProblemRevision,
  getInMemoryProblemRevision,
  resolveLatestProblemRevision,
  setInMemoryProblemRevision,
  saveUnsavedProblemRevision,
  confirmProblemRevisionSynced,
  recordProblemRevisionVerificationPending,
  recordProblemRevisionMismatchConflict,
  resolveProblemRevisionConflict,
  getEffectiveUnsavedProblemRevision,
  type ConfirmProblemRevisionSyncStatus,
} from './storage';
import { getStorageScopeId } from './storageScope';

export interface ProblemRevisionSyncOutcome {
  outcome:
    | 'verified_synced'
    | 'verification_pending'
    | 'conflict'
    | 'save_failed'
    | 'scope_changed'
    | 'noop';
  syncOutcomeStatus?: ConfirmProblemRevisionSyncStatus;
  savedToServer: boolean | 'unknown';
  contentVerified: boolean;
  needsRecovery: boolean;
  confirmedVersion?: number;
  failureReason?: ReviseProblemFailureReason | 'save_uncertain';
  localPersisted: boolean;
  updatedProblems: Problem[];
  message: string;
}

function buildSubmittedProblemFromUnsaved(
  baseProblem: Problem | undefined,
  unsaved: UnsavedProblemRevision,
  versionOverride?: number
): Problem {
  const version = versionOverride ?? unsaved.confirmedVersion ?? unsaved.revisionVersion;
  return {
    ...(baseProblem ?? ({
      id: unsaved.problemId,
      subjectId: '',
      type: unsaved.type ?? 'essay_descriptive',
      categoryLabel: '',
      categoryNumber: 1,
      conceptIds: unsaved.conceptIds ?? [],
      sourceRefs: '',
      timeBreakdownDesc: '',
      coreEvaluationHighlight: '',
      itemCountDesc: '',
      title: unsaved.title,
      promptText: unsaved.promptText,
      hints: unsaved.hints,
      modelAnswer: unsaved.modelAnswer,
      rubric: unsaved.rubric,
      timeStandardMinutes: unsaved.timeStandardMinutes ?? 20,
    } as Problem)),
    id: unsaved.problemId,
    title: unsaved.title,
    promptText: unsaved.promptText,
    type: unsaved.type ?? baseProblem?.type ?? 'essay_descriptive',
    conceptIds: unsaved.conceptIds ?? baseProblem?.conceptIds ?? [],
    mathFormula: unsaved.mathFormula,
    codeSnippet: unsaved.codeSnippet,
    hints: unsaved.hints,
    modelAnswer: unsaved.modelAnswer,
    rubric: unsaved.rubric,
    timeStandardMinutes: unsaved.timeStandardMinutes ?? baseProblem?.timeStandardMinutes ?? 20,
    appliedConditionNote:
      unsaved.appliedConditionNote !== undefined
        ? unsaved.appliedConditionNote
        : baseProblem?.appliedConditionNote,
    version,
  };
}

function markRevisionSaveFailedIfCurrent(
  problemId: string,
  errorMessage: string,
  targetRevisionId?: string,
  targetGeneration?: number
): void {
  const currentUnsaved = resolveLatestProblemRevision(
    getUnsavedProblemRevision(problemId),
    getInMemoryProblemRevision(problemId)
  ).latest;
  const isCurrentTarget = Boolean(
    currentUnsaved &&
      currentUnsaved.syncStatus !== 'conflict' &&
      (!targetRevisionId || currentUnsaved.revisionId === targetRevisionId) &&
      (targetGeneration === undefined || (currentUnsaved.generation ?? 0) <= targetGeneration)
  );
  if (currentUnsaved && isCurrentTarget) {
    const failedRev: UnsavedProblemRevision = {
      ...currentUnsaved,
      syncStatus: 'failed',
      saveConfirmedOnServer: false,
      syncError: errorMessage,
    };
    setInMemoryProblemRevision(failedRev);
    saveUnsavedProblemRevision(failedRev, {
      onlyIfRevisionId: targetRevisionId,
      onlyIfGeneration: targetGeneration,
    });
  }
}

function formatVerificationFailureMessage(
  confirmedVersion: number,
  reason: ReviseProblemFailureReason,
  detail: string
): string {
  switch (reason) {
    case 'content_mismatch':
      return `서버 확정본(v${confirmedVersion}) 내용과 내 수정본이 일치하지 않아 보호 수정본을 보존했습니다. (${detail})`;
    case 'snapshot_missing':
    case 'snapshot_incomplete':
      return `서버 저장(v${confirmedVersion})은 확인되었으나 버전 스냅샷이 누락·불완전하여 완료 처리하지 않고 보호 수정본을 유지했습니다. (${detail})`;
    case 'read_error':
    default:
      return `서버에는 v${confirmedVersion} 저장이 확인되었으나 저장 직후 재조회 검증에 실패하여 확인 필요 상태로 보존했습니다. (${detail})`;
  }
}

function handleVerificationFailedOutcome(
  problemId: string,
  result: ReviseProblemVerificationFailedResult,
  options: {
    targetRevisionId?: string;
    targetGeneration?: number;
    pinnedScopeId: string;
  }
): ProblemRevisionSyncOutcome {
  const msg = formatVerificationFailureMessage(
    result.confirmedVersion,
    result.verificationFailureReason,
    result.verificationError
  );

  if (result.verificationFailureReason === 'content_mismatch') {
    const conflictRec = recordProblemRevisionMismatchConflict(problemId, {
      scopeId: options.pinnedScopeId,
      targetRevisionId: options.targetRevisionId,
      targetGeneration: options.targetGeneration,
      confirmedVersion: result.confirmedVersion,
      saveConfirmedOnServer: true,
      errorMessage: msg,
      serverSnapshot: result.serverSnapshot,
      serverLatestProblem: result.latestServerProblem,
    });
    return {
      outcome: 'conflict',
      savedToServer: true,
      contentVerified: false,
      needsRecovery: true,
      confirmedVersion: result.confirmedVersion,
      failureReason: 'content_mismatch',
      localPersisted: conflictRec.localPersisted,
      updatedProblems: conflictRec.updatedProblems,
      message: conflictRec.preservedNewerRevision
        ? `${msg} (진행 중이던 더 최신 로컬 편집본은 그대로 보존되었습니다.)`
        : msg,
    };
  }

  const pendingRec = recordProblemRevisionVerificationPending(problemId, {
    scopeId: options.pinnedScopeId,
    targetRevisionId: options.targetRevisionId,
    targetGeneration: options.targetGeneration,
    confirmedVersion: result.confirmedVersion,
    saveConfirmedOnServer: true,
    reason: result.verificationFailureReason,
    errorMessage: msg,
    serverSnapshot: result.serverSnapshot,
    serverLatestProblem: result.latestServerProblem,
  });

  return {
    outcome: 'verification_pending',
    savedToServer: true,
    contentVerified: false,
    needsRecovery: true,
    confirmedVersion: result.confirmedVersion,
    failureReason: result.verificationFailureReason,
    localPersisted: pendingRec.localPersisted,
    updatedProblems: loadStoredProblems(),
    message: pendingRec.preservedNewerRevision
      ? `${msg} (더 최신 로컬 편집본은 덮어쓰지 않고 보존했습니다.)`
      : msg,
  };
}

/**
 * Shared state-transition coordinator for all `reviseProblem` call sites
 * (normal save, response-loss recovery after VERSION_CONFLICT, rebased retry,
 * and background auto-sync).
 */
export async function applyReviseProblemResult(params: {
  supabase: SupabaseClient;
  problemId: string;
  expectedVersion: number;
  problem: Problem;
  snapshotProblem: Problem;
  result: ReviseProblemRepoResult;
  targetRevisionId?: string;
  targetGeneration?: number;
  editReason?: string;
  pinnedScopeId: string;
  localPersisted?: boolean;
  unsaved?: UnsavedProblemRevision | null;
  rebaseAttempted?: boolean;
}): Promise<ProblemRevisionSyncOutcome> {
  const {
    supabase,
    problemId,
    expectedVersion,
    problem,
    snapshotProblem,
    result,
    targetRevisionId,
    targetGeneration,
    editReason,
    pinnedScopeId,
    localPersisted,
    unsaved,
    rebaseAttempted,
  } = params;

  if (getStorageScopeId() !== pinnedScopeId) {
    return {
      outcome: 'scope_changed',
      savedToServer: result.savedToServer,
      contentVerified: result.contentVerified,
      needsRecovery: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      message: '계정이 전환되어 이전 계정의 저장 결과를 적용하지 않았습니다.',
    };
  }

  // 1. Verified server confirmation (savedToServer: true && contentVerified: true)
  if (result.ok) {
    const confirmedVersion = result.confirmedVersion;
    const syncOutcome = confirmProblemRevisionSynced(
      problemId,
      { ...result.data, version: confirmedVersion },
      {
        revisionId: targetRevisionId,
        generation: targetGeneration,
        snapshotProblem,
        editReason,
        scopeId: pinnedScopeId,
        verificationStatus: result.verificationStatus,
        contentVerified: result.contentVerified,
      }
    );

    if (syncOutcome.status === 'stale_ignored') {
      return {
        outcome: 'verified_synced',
        syncOutcomeStatus: 'stale_ignored',
        savedToServer: true,
        contentVerified: true,
        needsRecovery: false,
        confirmedVersion,
        localPersisted: syncOutcome.localPersisted,
        updatedProblems: syncOutcome.updatedProblems,
        message: syncOutcome.message,
      };
    }

    if (syncOutcome.status === 'duplicate') {
      return {
        outcome: 'verified_synced',
        syncOutcomeStatus: 'duplicate',
        savedToServer: true,
        contentVerified: true,
        needsRecovery: false,
        confirmedVersion,
        localPersisted: syncOutcome.localPersisted,
        updatedProblems: syncOutcome.updatedProblems,
        message: syncOutcome.message,
      };
    }

    if (syncOutcome.status === 'conflict') {
      recordProblemRevisionMismatchConflict(problemId, {
        scopeId: pinnedScopeId,
        targetRevisionId,
        targetGeneration,
        confirmedVersion,
        saveConfirmedOnServer: true,
        errorMessage: syncOutcome.message || '서버 버전 충돌이 감지되었습니다.',
        serverSnapshot: result.confirmedSnapshot,
        serverLatestProblem: result.latestServerProblem ?? result.data,
      });
      return {
        outcome: 'conflict',
        syncOutcomeStatus: 'conflict',
        savedToServer: true,
        contentVerified: true,
        needsRecovery: true,
        confirmedVersion,
        failureReason: 'content_mismatch',
        localPersisted: syncOutcome.localPersisted,
        updatedProblems: syncOutcome.updatedProblems,
        message: syncOutcome.message || '서버 버전 충돌이 감지되었습니다.',
      };
    }

    let nextProblems = syncOutcome.updatedProblems;
    if (
      result.serverAdvancedBeyondConfirmed &&
      result.latestServerProblem &&
      !syncOutcome.advancedInFlightRevision
    ) {
      const latestVer = result.latestServerProblem.version ?? confirmedVersion;
      if (latestVer > confirmedVersion) {
        const advanceOutcome = confirmProblemRevisionSynced(
          problemId,
          { ...result.latestServerProblem, version: latestVer },
          {
            scopeId: pinnedScopeId,
            verificationStatus: 'verified_current',
            contentVerified: true,
          }
        );
        if (advanceOutcome.reconciled) {
          nextProblems = advanceOutcome.updatedProblems;
        }
      }
    }

    const finalMessage =
      localPersisted === false && !syncOutcome.localPersisted
        ? '서버에는 수정본이 저장되었으나 브라우저 로컬 영속 저장소 기록에는 실패했습니다. (메모리 상태만 유지됨)'
        : syncOutcome.message;

    return {
      outcome: 'verified_synced',
      syncOutcomeStatus: syncOutcome.status,
      savedToServer: true,
      contentVerified: true,
      needsRecovery: false,
      confirmedVersion,
      localPersisted: syncOutcome.localPersisted,
      updatedProblems: nextProblems,
      message: finalMessage,
    };
  }

  // 2. Post-save verification failure (savedToServer: true, contentVerified: false)
  if (result.outcome === 'verification_failed') {
    return handleVerificationFailedOutcome(problemId, result, {
      targetRevisionId,
      targetGeneration,
      pinnedScopeId,
    });
  }

  // 3. Uncertain save outcome on ambiguous network/transport failure (savedToServer: 'unknown')
  if (result.outcome === 'save_uncertain') {
    const uncertainMsg = `네트워크 통신 오류로 서버 저장 완료 여부를 확인하지 못했습니다. 보호 수정본은 안전하게 유지되었으니 [저장 결과 다시 확인]으로 먼저 확인해 주세요. (${result.error})`;
    const pendingRec = recordProblemRevisionVerificationPending(problemId, {
      scopeId: pinnedScopeId,
      targetRevisionId,
      targetGeneration,
      saveConfirmedOnServer: false,
      reason: 'save_uncertain',
      errorMessage: uncertainMsg,
    });
    return {
      outcome: 'verification_pending',
      savedToServer: 'unknown',
      contentVerified: false,
      needsRecovery: true,
      failureReason: 'save_uncertain',
      localPersisted: pendingRec.localPersisted,
      updatedProblems: loadStoredProblems(),
      message: uncertainMsg,
    };
  }

  // 4. Deterministic failure (VERSION_CONFLICT recovery or non-conflict rejection)
  if (result.error && /VERSION_CONFLICT/i.test(result.error)) {
    const latestServer = await getProblemById(supabase, problemId);
    if (getStorageScopeId() !== pinnedScopeId) {
      return {
        outcome: 'scope_changed',
        savedToServer: false,
        contentVerified: false,
        needsRecovery: false,
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: '계정이 전환되어 충돌 확인 결과를 적용하지 않았습니다.',
      };
    }

    if (!latestServer.ok) {
      const readErrMsg = `버전 충돌 확인 중 서버 조회에 실패했습니다. [저장 결과 다시 확인]을 눌러 확인해 주세요. (${latestServer.error})`;
      const pendingRec = recordProblemRevisionVerificationPending(problemId, {
        scopeId: pinnedScopeId,
        targetRevisionId,
        targetGeneration,
        saveConfirmedOnServer: false,
        reason: 'read_error',
        errorMessage: readErrMsg,
      });
      return {
        outcome: 'verification_pending',
        savedToServer: 'unknown',
        contentVerified: false,
        needsRecovery: true,
        failureReason: 'read_error',
        localPersisted: pendingRec.localPersisted,
        updatedProblems: loadStoredProblems(),
        message: readErrMsg,
      };
    }

    if (latestServer.data) {
      const serverVer = latestServer.data.version ?? 1;
      const expectedConfirmedVer = expectedVersion + 1;

      // Check 1: If server advanced beyond expectedVersion + 1, verify immutable snapshot for expectedConfirmedVer
      // STRICTLY checking completeness before matching (never masking incomplete snapshots with latestServer.data!).
      if (serverVer > expectedConfirmedVer) {
        const snapRes = await getProblemVersionSnapshot(supabase, problemId, expectedConfirmedVer);
        if (getStorageScopeId() !== pinnedScopeId) {
          return {
            outcome: 'scope_changed',
            savedToServer: false,
            contentVerified: false,
            needsRecovery: false,
            localPersisted: true,
            updatedProblems: loadStoredProblems(),
            message: '계정이 전환되어 충돌 복구 결과를 적용하지 않았습니다.',
          };
        }
        if (!snapRes.ok) {
          const msg = `후속 버전 확인 중 v${expectedConfirmedVer} 스냅샷 조회에 실패했습니다. (${snapRes.error})`;
          recordProblemRevisionVerificationPending(problemId, {
            scopeId: pinnedScopeId,
            targetRevisionId,
            targetGeneration,
            confirmedVersion: expectedConfirmedVer,
            saveConfirmedOnServer: false,
            reason: 'read_error',
            errorMessage: msg,
            serverLatestProblem: latestServer.data,
          });
          return {
            outcome: 'verification_pending',
            savedToServer: 'unknown',
            contentVerified: false,
            needsRecovery: true,
            confirmedVersion: expectedConfirmedVer,
            failureReason: 'read_error',
            localPersisted: true,
            updatedProblems: loadStoredProblems(),
            message: msg,
          };
        }
        if (snapRes.data && !isCompleteProblemSnapshot(snapRes.data)) {
          return handleVerificationFailedOutcome(
            problemId,
            {
              outcome: 'verification_failed',
              ok: false,
              savedToServer: true,
              contentVerified: false,
              verificationStatus: 'verification_failed',
              verificationFailureReason: 'snapshot_incomplete',
              verificationError: `v${expectedConfirmedVer} 버전 스냅샷의 필수 평가 필드가 누락되어 검증에 실패했습니다.`,
              confirmedVersion: expectedConfirmedVer,
              serverSnapshot: snapRes.data,
              latestServerProblem: latestServer.data,
              serverAdvancedBeyondConfirmed: true,
              error: '스냅샷 불완전',
            },
            { targetRevisionId, targetGeneration, pinnedScopeId }
          );
        }
        if (
          snapRes.data &&
          isCompleteProblemSnapshot(snapRes.data) &&
          snapshotEvaluationMatchesProblem(problem, snapRes.data)
        ) {
          const candidateAtExpected: Problem & { version: number } = {
            ...latestServer.data,
            ...snapRes.data,
            id: problemId,
            version: expectedConfirmedVer,
          };
          const syncOutcome = confirmProblemRevisionSynced(problemId, candidateAtExpected, {
            revisionId: targetRevisionId,
            generation: targetGeneration,
            snapshotProblem,
            editReason,
            scopeId: pinnedScopeId,
            verificationStatus: 'verified_snapshot_only',
            contentVerified: true,
          });
          if (syncOutcome.status === 'stale_ignored') {
            return {
              outcome: 'verified_synced',
              syncOutcomeStatus: 'stale_ignored',
              savedToServer: true,
              contentVerified: true,
              needsRecovery: false,
              confirmedVersion: expectedConfirmedVer,
              localPersisted: syncOutcome.localPersisted,
              updatedProblems: syncOutcome.updatedProblems,
              message: syncOutcome.message,
            };
          }
          if (syncOutcome.status === 'conflict') {
            recordProblemRevisionMismatchConflict(problemId, {
              scopeId: pinnedScopeId,
              targetRevisionId,
              targetGeneration,
              confirmedVersion: expectedConfirmedVer,
              saveConfirmedOnServer: true,
              errorMessage: syncOutcome.message || '서버 버전 충돌: 내용 불일치가 감지되었습니다.',
              serverSnapshot: snapRes.data,
              serverLatestProblem: latestServer.data,
            });
            return {
              outcome: 'conflict',
              syncOutcomeStatus: 'conflict',
              savedToServer: true,
              contentVerified: true,
              needsRecovery: true,
              confirmedVersion: expectedConfirmedVer,
              failureReason: 'content_mismatch',
              localPersisted: syncOutcome.localPersisted,
              updatedProblems: syncOutcome.updatedProblems,
              message: syncOutcome.message || '서버 버전 충돌: 내용 불일치가 감지되었습니다.',
            };
          }
          let nextProblems = syncOutcome.updatedProblems;
          if (!syncOutcome.advancedInFlightRevision) {
            const advanceOutcome = confirmProblemRevisionSynced(
              problemId,
              { ...latestServer.data, version: serverVer },
              {
                scopeId: pinnedScopeId,
                verificationStatus: 'verified_current',
                contentVerified: true,
              }
            );
            if (advanceOutcome.reconciled) {
              nextProblems = advanceOutcome.updatedProblems;
            }
          }
          return {
            outcome: 'verified_synced',
            syncOutcomeStatus: syncOutcome.status,
            savedToServer: true,
            contentVerified: true,
            needsRecovery: false,
            confirmedVersion: expectedConfirmedVer,
            localPersisted: syncOutcome.localPersisted,
            updatedProblems: nextProblems,
            message: syncOutcome.localPersisted
              ? '문제 수정본이 이미 서버에 동기화되어 있습니다.'
              : '문제 수정본이 서버에 동기화되어 있으나 브라우저 로컬 영속 저장소 갱신에는 실패했습니다.',
          };
        }
      }

      // Check 2: Current server version matches this revision (response loss recovery)
      if (
        serverVer >= expectedVersion &&
        isCompleteProblemSnapshot(latestServer.data) &&
        isRevisionMatchingProblem(problem, latestServer.data)
      ) {
        const snapAtServer = await getProblemVersionSnapshot(supabase, problemId, serverVer);
        if (getStorageScopeId() !== pinnedScopeId) {
          return {
            outcome: 'scope_changed',
            savedToServer: false,
            contentVerified: false,
            needsRecovery: false,
            localPersisted: true,
            updatedProblems: loadStoredProblems(),
            message: '계정이 전환되어 응답 복구를 중단했습니다.',
          };
        }
        const snapValid =
          snapAtServer.ok &&
          snapAtServer.data &&
          isCompleteProblemSnapshot(snapAtServer.data) &&
          snapshotEvaluationMatchesProblem(problem, snapAtServer.data);

        if (!snapAtServer.ok || !snapAtServer.data || !snapValid) {
          const reason: ReviseProblemFailureReason = !snapAtServer.ok
            ? 'read_error'
            : !snapAtServer.data
              ? 'snapshot_missing'
              : !isCompleteProblemSnapshot(snapAtServer.data)
                ? 'snapshot_incomplete'
                : 'content_mismatch';
          return handleVerificationFailedOutcome(
            problemId,
            {
              outcome: 'verification_failed',
              ok: false,
              savedToServer: true,
              contentVerified: false,
              verificationStatus: 'verification_failed',
              verificationFailureReason: reason,
              verificationError:
                reason === 'read_error'
                  ? snapAtServer.ok
                    ? '스냅샷 조회 실패'
                    : snapAtServer.error
                  : '서버 버전 스냅샷을 검증하지 못했습니다.',
              confirmedVersion: serverVer,
              serverSnapshot: snapAtServer.ok ? snapAtServer.data : null,
              latestServerProblem: latestServer.data,
              serverAdvancedBeyondConfirmed: false,
              error: '서버 스냅샷 검증 실패',
            },
            { targetRevisionId, targetGeneration, pinnedScopeId }
          );
        }

        const syncOutcome = confirmProblemRevisionSynced(
          problemId,
          { ...latestServer.data, version: serverVer },
          {
            revisionId: targetRevisionId,
            generation: targetGeneration,
            snapshotProblem,
            editReason,
            scopeId: pinnedScopeId,
            verificationStatus: 'verified_current',
            contentVerified: true,
          }
        );
        if (syncOutcome.status === 'conflict') {
          recordProblemRevisionMismatchConflict(problemId, {
            scopeId: pinnedScopeId,
            targetRevisionId,
            targetGeneration,
            confirmedVersion: serverVer,
            saveConfirmedOnServer: true,
            errorMessage: syncOutcome.message || '서버 버전 충돌: 내용 불일치가 감지되었습니다.',
            serverSnapshot: snapAtServer.data,
            serverLatestProblem: latestServer.data,
          });
          return {
            outcome: 'conflict',
            syncOutcomeStatus: 'conflict',
            savedToServer: true,
            contentVerified: true,
            needsRecovery: true,
            confirmedVersion: serverVer,
            failureReason: 'content_mismatch',
            localPersisted: syncOutcome.localPersisted,
            updatedProblems: syncOutcome.updatedProblems,
            message: syncOutcome.message || '서버 버전 충돌: 내용 불일치가 감지되었습니다.',
          };
        }
        return {
          outcome: 'verified_synced',
          syncOutcomeStatus: syncOutcome.status,
          savedToServer: true,
          contentVerified: true,
          needsRecovery: false,
          confirmedVersion: serverVer,
          localPersisted: syncOutcome.localPersisted,
          updatedProblems: syncOutcome.updatedProblems,
          message: syncOutcome.localPersisted
            ? '문제 수정본이 이미 서버에 동기화되어 있습니다.'
            : '문제 수정본이 서버에 동기화되어 있으나 브라우저 로컬 영속 저장소 갱신에는 실패했습니다.',
        };
      }

      // Check 3: Legacy ambiguous baseVersion rebase retry (guarded by `rebaseAttempted`)
      if (
        !rebaseAttempted &&
        serverVer > expectedVersion &&
        unsaved?.baseSnapshot &&
        isCompleteProblemSnapshot(latestServer.data) &&
        isRevisionMatchingProblem(unsaved.baseSnapshot, latestServer.data)
      ) {
        const rebasedProblem: Problem = {
          ...problem,
          version: serverVer + 1,
        };
        return pushProblemRevisionToServer({
          supabase,
          problemId,
          expectedVersion: serverVer,
          problem: rebasedProblem,
          snapshotProblem: rebasedProblem,
          targetRevisionId,
          targetGeneration,
          editReason,
          pinnedScopeId,
          localPersisted,
          unsaved,
          rebaseAttempted: true,
        });
      }
    }

    const conflictMsg = `서버 버전 충돌: ${result.error}`;
    const conflictRec = recordProblemRevisionMismatchConflict(problemId, {
      scopeId: pinnedScopeId,
      targetRevisionId,
      targetGeneration,
      confirmedVersion: latestServer.data?.version,
      saveConfirmedOnServer: false,
      errorMessage: conflictMsg,
      serverLatestProblem: latestServer.data ?? null,
    });
    return {
      outcome: 'conflict',
      savedToServer: false,
      contentVerified: false,
      needsRecovery: Boolean(conflictRec.updated),
      localPersisted: conflictRec.localPersisted,
      updatedProblems: conflictRec.updatedProblems,
      message: conflictRec.updated
        ? '서버 버전 충돌: 미저장 수정본이 충돌 복구 대상으로 보존되었습니다.'
        : '더 최신 로컬 수정본이 존재하여 이전 충돌 응답을 무시했습니다.',
    };
  }

  // Other deterministic failure (e.g., not_configured, forbidden, invalid_rpc_response)
  markRevisionSaveFailedIfCurrent(problemId, result.error, targetRevisionId, targetGeneration);
  const isConfigOrAuthErr = /^(not_configured|invalid_rpc_response|forbidden):/i.test(result.error);
  const failMsg =
    localPersisted === false
      ? `로컬 영속 저장과 서버 동기화가 모두 실패했습니다 (${result.error}). 편집기 입력과 메모리 수정본은 유지되었으니 다시 시도해 주세요.`
      : isConfigOrAuthErr
        ? `서버 설정·권한 확인 실패 (${result.error}): 미저장 수정본은 보존되었으며 DB 마이그레이션(0039) 및 RPC 권한 확인 후 다시 시도해 주세요.`
        : `서버 동기화 실패: ${result.error}`;
  return {
    outcome: 'save_failed',
    savedToServer: false,
    contentVerified: false,
    needsRecovery: true,
    localPersisted: localPersisted ?? true,
    updatedProblems: loadStoredProblems(),
    message: failMsg,
  };
}

/**
 * Calls `reviseProblem` and funnels the result through `applyReviseProblemResult`.
 */
export async function pushProblemRevisionToServer(params: {
  supabase: SupabaseClient;
  problemId: string;
  expectedVersion: number;
  problem: Problem;
  snapshotProblem?: Problem;
  targetRevisionId?: string;
  targetGeneration?: number;
  editReason?: string;
  pinnedScopeId: string;
  localPersisted?: boolean;
  unsaved?: UnsavedProblemRevision | null;
  rebaseAttempted?: boolean;
}): Promise<ProblemRevisionSyncOutcome> {
  const result = await reviseProblem(
    params.supabase,
    params.problemId,
    params.expectedVersion,
    params.problem
  );
  return applyReviseProblemResult({
    ...params,
    snapshotProblem: params.snapshotProblem ?? params.problem,
    result,
  });
}

/**
 * Read-only post-save verification recovery ("저장 결과 다시 확인").
 * - STRICTLY READ-ONLY: Only calls `getProblemById` / `getProblemVersionSnapshot`.
 * - NEVER executes `revise_problem_with_snapshot` RPC and NEVER triggers AI calls.
 * - Conditionally clears ONLY the matching verified revision; preserves newer edit B
 *   and handles `pendingPriorVerification` when A is verified after B was already edited.
 */
export async function verifyProblemRevisionOnServer(params: {
  supabase: SupabaseClient;
  problemId: string;
  pinnedScopeId: string;
}): Promise<ProblemRevisionSyncOutcome> {
  const { supabase, problemId, pinnedScopeId } = params;
  if (getStorageScopeId() !== pinnedScopeId) {
    return {
      outcome: 'scope_changed',
      savedToServer: 'unknown',
      contentVerified: false,
      needsRecovery: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      message: '계정이 전환되어 이전 계정의 저장 결과 확인을 중단했습니다.',
    };
  }

  let currentUnsaved = getEffectiveUnsavedProblemRevision(problemId);
  if (!currentUnsaved) {
    return {
      outcome: 'noop',
      savedToServer: false,
      contentVerified: false,
      needsRecovery: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      message: '확인할 미동기화 수정본이 없습니다.',
    };
  }

  // Step 1: If there is a prior unverified commit A recorded beneath a newer local edit B,
  // verify A first using read-only snapshot lookup so B can be safely rebased onto verified A/v2!
  if (currentUnsaved.pendingPriorVerification) {
    const prior = currentUnsaved.pendingPriorVerification;
    const priorVerifyRes = await verifyProblemVersionSnapshotOnServer(
      supabase,
      problemId,
      prior.confirmedVersion,
      prior.submittedProblem
    );
    if (getStorageScopeId() !== pinnedScopeId) {
      return {
        outcome: 'scope_changed',
        savedToServer: 'unknown',
        contentVerified: false,
        needsRecovery: false,
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: '계정이 전환되어 이전 수정본 확인 결과를 적용하지 않았습니다.',
      };
    }

    if (priorVerifyRes.ok) {
      const priorOutcome = confirmProblemRevisionSynced(
        problemId,
        { ...priorVerifyRes.data, version: priorVerifyRes.confirmedVersion },
        {
          revisionId: prior.revisionId,
          generation: prior.generation,
          snapshotProblem: prior.submittedProblem,
          editReason: prior.editReason,
          scopeId: pinnedScopeId,
          verificationStatus: priorVerifyRes.verificationStatus,
          contentVerified: true,
        }
      );
      // Reload currentUnsaved after A was verified (B is preserved with baseVersion = prior.confirmedVersion)
      currentUnsaved = getEffectiveUnsavedProblemRevision(problemId);
      if (priorOutcome.status === 'in_flight_advanced' || priorOutcome.advancedInFlightRevision) {
        return {
          outcome: 'verified_synced',
          syncOutcomeStatus: 'in_flight_advanced',
          savedToServer: true,
          contentVerified: true,
          needsRecovery: true, // B still needs its own save
          confirmedVersion: prior.confirmedVersion,
          localPersisted: priorOutcome.localPersisted,
          updatedProblems: priorOutcome.updatedProblems,
          message: `이전 수정본(v${prior.confirmedVersion})이 서버에서 확인되어 기준 버전을 갱신했고, 더 최신 로컬 편집본은 그대로 보존되었습니다.`,
        };
      }
      if (!currentUnsaved) {
        return {
          outcome: 'verified_synced',
          syncOutcomeStatus: priorOutcome.status,
          savedToServer: true,
          contentVerified: true,
          needsRecovery: false,
          confirmedVersion: prior.confirmedVersion,
          localPersisted: priorOutcome.localPersisted,
          updatedProblems: priorOutcome.updatedProblems,
          message: priorOutcome.message,
        };
      }
    } else {
      const stillFailingMsg = formatVerificationFailureMessage(
        priorVerifyRes.confirmedVersion,
        priorVerifyRes.verificationFailureReason,
        priorVerifyRes.verificationError
      );
      // Preserve newer B untouched! Only report status for user clarity.
      return {
        outcome: priorVerifyRes.verificationFailureReason === 'content_mismatch' ? 'conflict' : 'verification_pending',
        savedToServer: true,
        contentVerified: false,
        needsRecovery: true,
        confirmedVersion: prior.confirmedVersion,
        failureReason: priorVerifyRes.verificationFailureReason,
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: `이전 저장본(v${prior.confirmedVersion}) 재확인에 실패했지만 최신 로컬 편집본은 안전하게 보존되었습니다. (${stillFailingMsg})`,
      };
    }
  }

  // Step 2: Verify `currentUnsaved` itself using ONLY read-only server reads
  const targetRevisionId = currentUnsaved.revisionId;
  const targetGeneration = currentUnsaved.generation;
  const localProb =
    loadStoredProblems().find((p) => p.id === problemId) ??
    getInMemoryProblem(problemId) ??
    undefined;
  const submittedProblem = buildSubmittedProblemFromUnsaved(localProb, currentUnsaved);

  // If this came from an uncertain network error (`save_uncertain`) or no `confirmedVersion` yet,
  // check the current server row first before looking up a specific version snapshot.
  if (currentUnsaved.confirmedVersion === undefined) {
    const latestRes = await getProblemById(supabase, problemId);
    if (getStorageScopeId() !== pinnedScopeId) {
      return {
        outcome: 'scope_changed',
        savedToServer: 'unknown',
        contentVerified: false,
        needsRecovery: false,
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: '계정이 전환되어 재조회 결과를 적용하지 않았습니다.',
      };
    }
    if (!latestRes.ok) {
      const msg = `저장 결과 확인 중 서버 조회에 실패했습니다. 보호 수정본은 유지되었습니다. (${latestRes.error})`;
      recordProblemRevisionVerificationPending(problemId, {
        scopeId: pinnedScopeId,
        targetRevisionId,
        targetGeneration,
        saveConfirmedOnServer: Boolean(currentUnsaved.saveConfirmedOnServer),
        reason: 'read_error',
        errorMessage: msg,
      });
      return {
        outcome: 'verification_pending',
        savedToServer: 'unknown',
        contentVerified: false,
        needsRecovery: true,
        failureReason: 'read_error',
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: msg,
      };
    }
    if (!latestRes.data) {
      const msg = '서버에서 해당 문제 행을 찾지 못했습니다. 보호 수정본은 유지되었습니다.';
      recordProblemRevisionVerificationPending(problemId, {
        scopeId: pinnedScopeId,
        targetRevisionId,
        targetGeneration,
        saveConfirmedOnServer: false,
        reason: 'snapshot_missing',
        errorMessage: msg,
      });
      return {
        outcome: 'verification_pending',
        savedToServer: 'unknown',
        contentVerified: false,
        needsRecovery: true,
        failureReason: 'snapshot_missing',
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: msg,
      };
    }

    const serverVer = latestRes.data.version ?? 1;
    if (serverVer <= currentUnsaved.baseVersion && !currentUnsaved.saveConfirmedOnServer) {
      // Server did not commit the uncertain RPC. Safe to mark retryable `failed` (still zero RPC calls!).
      if (isCompleteProblemSnapshot(latestRes.data) && isRevisionMatchingProblem(currentUnsaved, latestRes.data)) {
        const outcome = confirmProblemRevisionSynced(
          problemId,
          { ...latestRes.data, version: serverVer },
          {
            revisionId: targetRevisionId,
            generation: targetGeneration,
            snapshotProblem: submittedProblem,
            editReason: currentUnsaved.editReason,
            scopeId: pinnedScopeId,
            verificationStatus: 'verified_current',
            contentVerified: true,
          }
        );
        return {
          outcome: 'verified_synced',
          syncOutcomeStatus: outcome.status,
          savedToServer: true,
          contentVerified: true,
          needsRecovery: false,
          confirmedVersion: serverVer,
          localPersisted: outcome.localPersisted,
          updatedProblems: outcome.updatedProblems,
          message: outcome.message,
        };
      }
      const notCommittedMsg = `서버가 아직 기존 버전(v${serverVer}) 상태입니다. 이전 저장이 서버에 반영되지 않았으므로 이제 안전하게 다시 저장을 시도할 수 있습니다.`;
      markRevisionSaveFailedIfCurrent(problemId, notCommittedMsg, targetRevisionId, targetGeneration);
      return {
        outcome: 'save_failed',
        savedToServer: false,
        contentVerified: false,
        needsRecovery: true,
        localPersisted: true,
        updatedProblems: loadStoredProblems(),
        message: notCommittedMsg,
      };
    }

    const candidateVer = currentUnsaved.revisionVersion <= serverVer
      ? currentUnsaved.revisionVersion
      : serverVer;
    const verifyRes = await verifyProblemVersionSnapshotOnServer(
      supabase,
      problemId,
      candidateVer,
      { ...submittedProblem, version: candidateVer }
    );
    return finalizeReadOnlyVerificationResult({
      problemId,
      pinnedScopeId,
      targetRevisionId,
      targetGeneration,
      submittedProblem: { ...submittedProblem, version: candidateVer },
      editReason: currentUnsaved.editReason,
      verifyRes,
    });
  }

  // Standard Case A / B / C where confirmedVersion is already known
  const targetVer = currentUnsaved.confirmedVersion;
  const verifyRes = await verifyProblemVersionSnapshotOnServer(
    supabase,
    problemId,
    targetVer,
    { ...submittedProblem, version: targetVer }
  );
  return finalizeReadOnlyVerificationResult({
    problemId,
    pinnedScopeId,
    targetRevisionId,
    targetGeneration,
    submittedProblem: { ...submittedProblem, version: targetVer },
    editReason: currentUnsaved.editReason,
    verifyRes,
  });
}

function finalizeReadOnlyVerificationResult(params: {
  problemId: string;
  pinnedScopeId: string;
  targetRevisionId?: string;
  targetGeneration?: number;
  submittedProblem: Problem;
  editReason?: string;
  verifyRes: Awaited<ReturnType<typeof verifyProblemVersionSnapshotOnServer>>;
}): ProblemRevisionSyncOutcome {
  const {
    problemId,
    pinnedScopeId,
    targetRevisionId,
    targetGeneration,
    submittedProblem,
    editReason,
    verifyRes,
  } = params;

  if (getStorageScopeId() !== pinnedScopeId) {
    return {
      outcome: 'scope_changed',
      savedToServer: 'unknown',
      contentVerified: false,
      needsRecovery: false,
      localPersisted: true,
      updatedProblems: loadStoredProblems(),
      message: '계정이 전환되어 재확인 결과를 적용하지 않았습니다.',
    };
  }

  if (verifyRes.ok) {
    const syncOutcome = confirmProblemRevisionSynced(
      problemId,
      { ...verifyRes.data, version: verifyRes.confirmedVersion },
      {
        revisionId: targetRevisionId,
        generation: targetGeneration,
        snapshotProblem: submittedProblem,
        editReason,
        scopeId: pinnedScopeId,
        verificationStatus: verifyRes.verificationStatus,
        contentVerified: true,
      }
    );

    if (syncOutcome.status === 'conflict') {
      recordProblemRevisionMismatchConflict(problemId, {
        scopeId: pinnedScopeId,
        targetRevisionId,
        targetGeneration,
        confirmedVersion: verifyRes.confirmedVersion,
        saveConfirmedOnServer: true,
        errorMessage: syncOutcome.message,
        serverSnapshot: verifyRes.confirmedSnapshot,
        serverLatestProblem: verifyRes.latestServerProblem ?? verifyRes.data,
      });
      return {
        outcome: 'conflict',
        syncOutcomeStatus: 'conflict',
        savedToServer: true,
        contentVerified: true,
        needsRecovery: true,
        confirmedVersion: verifyRes.confirmedVersion,
        failureReason: 'content_mismatch',
        localPersisted: syncOutcome.localPersisted,
        updatedProblems: syncOutcome.updatedProblems,
        message: syncOutcome.message,
      };
    }

    let nextProblems = syncOutcome.updatedProblems;
    if (
      verifyRes.serverAdvancedBeyondConfirmed &&
      verifyRes.latestServerProblem &&
      !syncOutcome.advancedInFlightRevision
    ) {
      const latestVer = verifyRes.latestServerProblem.version ?? verifyRes.confirmedVersion;
      if (latestVer > verifyRes.confirmedVersion) {
        const adv = confirmProblemRevisionSynced(
          problemId,
          { ...verifyRes.latestServerProblem, version: latestVer },
          {
            scopeId: pinnedScopeId,
            verificationStatus: 'verified_current',
            contentVerified: true,
          }
        );
        if (adv.reconciled) nextProblems = adv.updatedProblems;
      }
    }

    return {
      outcome: 'verified_synced',
      syncOutcomeStatus: syncOutcome.status,
      savedToServer: true,
      contentVerified: true,
      needsRecovery: syncOutcome.status === 'in_flight_advanced',
      confirmedVersion: verifyRes.confirmedVersion,
      localPersisted: syncOutcome.localPersisted,
      updatedProblems: nextProblems,
      message:
        syncOutcome.status === 'in_flight_advanced'
          ? '이전 저장본의 서버 내용 검증이 완료되었으며, 더 최신 로컬 편집본은 그대로 보존되었습니다.'
          : `서버 저장 내용(v${verifyRes.confirmedVersion})이 정상적으로 재확인되어 동기화되었습니다.`,
    };
  }

  return handleVerificationFailedOutcome(problemId, verifyRes, {
    targetRevisionId,
    targetGeneration,
    pinnedScopeId,
  });
}

export { resolveProblemRevisionConflict };
