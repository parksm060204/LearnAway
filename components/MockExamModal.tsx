'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Attempt,
  Concept,
  EvaluationResult,
  MockExamSession,
  Problem,
  ProblemType,
  ReviewEvent,
  Subject,
  isProblemAvailableForPractice,
  METHOD_REASON_RATING_LABELS,
} from '../lib/types';
import { examOpenPolicy, expireMockExam, getExamScore, loadMockExams, saveMockExam, selectMockExamProblems, updateMockExamAnswer } from '../lib/mockExam';
import { loadStoredSettings, recordAttemptAndUpdateConcept } from '../lib/storage';
import {
  autosaveMockExam,
  createMockExamOnServer,
  decideExpiredSubmit,
  decideServerSnapshotAdoption,
  executeResolveFromServer,
  fetchMockExamFromServer,
  finalizeRecordedExamOnServer,
  planExpiredUrlOpen,
  planReconcile,
  resolveExamSaveRetry,
  resolveLocalBaseVersion,
  saveMockExamGradingOnServer,
  shouldAutoSubmitExpired,
  submitExamAttemptOnServer,
  submitMockExamOnServer,
  type FailedExamSaveOp,
} from '../lib/cloud/mockExamSync';
import {
  answerFieldsEqual,
  applyPendingAnswers,
  clearConflictArchive,
  clearPendingExamAnswers,
  listOtherTabConflictArchives,
  listOtherTabPendingExamAnswers,
  loadConflictArchiveResult,
  loadPendingExamAnswersResult,
  pendingAfterAutosave,
  pendingDiffersFrom,
  refreshExamTabLease,
  releaseExamTabLease,
  resolveExamTabId,
  saveConflictArchive,
  saveImmutableConflictArchive,
  savePendingExamAnswers,
  type ExamConflictArchive,
  type PendingExamAnswers,
} from '../lib/cloud/pendingExamAnswers';
import { AcademicMathView } from './AcademicMathView';
import { X, Clock, Award, Compass, HelpCircle } from 'lucide-react';

/** 계획(StudyPlanItem)에서 모의시험을 시작할 때 전달하는 실행 설정 스냅샷 */
export interface MockExamInitialConfig {
  conceptIds?: string[];
  selectedTypes?: ProblemType[];
  minutes?: number;
  /** 실행한 계획 항목 ID (표시/추적용) */
  planItemId?: string;
  planItemTitle?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'modal' | 'page';
  subject: Subject;
  concepts: Concept[];
  problems: Problem[];
  /** 계정 ID — 미저장 답안 보존 영역을 계정·세션별로 분리한다. */
  userId?: string;
  /** 계획에서 시작한 경우 전달되는 초기 설정. 일반 메뉴에서는 undefined. */
  initialConfig?: MockExamInitialConfig | null;
  /**
   * URL(?tab=exam&exam=Y)로 직접 접근한 경우 그 시험을 연다. 이 값이 없으면
   * 해당 과목의 진행 중 세션을 연다. URL 접근은 조회만 하며 새 시험을 만들지 않는다.
   */
  initialExamId?: string | null;
  /**
   * URL 딥링크로 연 경우 true: 만료된 시험을 열었다는 이유만으로 새 제출 요청을
   * 보내지 않고, '저장된 답안으로 제출' 명시적 행동을 제공한다. 일반 메뉴에서
   * 연 경우 기존 마감 자동 제출 정책을 유지한다.
   */
  deferExpiredSubmit?: boolean;
  onExamRecorded: () => void;
}

const labels: Partial<Record<ProblemType, string>> = {
  essay_descriptive: '논술·서술', calc_derivation: '계산 유도', proof_counterexample: '증명·반례',
  error_spotting: '오류 검증', impl_descriptive: '구현 서술', algorithm_optimization: '알고리즘 최적화',
  complexity_proof: '복잡도 증명', debug_counterexample: '디버깅·반례',
};

export function MockExamModal({ isOpen, onClose, variant = 'modal', subject, concepts, problems, userId = '', initialConfig, initialExamId, deferExpiredSubmit = false, onExamRecorded }: Props) {
  const eligible = useMemo(() => problems.filter((p) => p.subjectId === subject.id && p.isApproved !== false && isProblemAvailableForPractice(p)), [problems, subject.id]);
  const availableTypes = useMemo(() => Array.from(new Set(eligible.map((p) => p.type))), [eligible]);

  // 계획에서 전달된 범위는 "전체 범위로 확대"하지 않는다.
  // 전달값이 있는데 유효한 값이 하나도 없으면 빈 선택으로 두어 시작을 차단하고 재선택을 안내한다.
  const requestedConceptIds = initialConfig?.conceptIds ?? [];
  const requestedTypesList = initialConfig?.selectedTypes ?? [];
  const validRequestedConceptIds = requestedConceptIds.filter((id) =>
    concepts.some((c) => c.id === id && c.subjectId === subject.id)
  );
  const validRequestedTypes = requestedTypesList.filter((t) => availableTypes.includes(t));
  const requestedScopeInvalid =
    (requestedConceptIds.length > 0 && validRequestedConceptIds.length === 0) ||
    (requestedTypesList.length > 0 && validRequestedTypes.length === 0);
  // 일부만 유효한 경우: 자동으로 넓히지 않고, 제외되는 항목을 알린 뒤 확인을 받는다.
  const requestedScopePartial =
    !requestedScopeInvalid &&
    (validRequestedConceptIds.length < requestedConceptIds.length ||
      validRequestedTypes.length < requestedTypesList.length);

  // 계획에서 시작한 경우: 계획의 개념 범위·문제 유형·시험 시간을 그대로 사용한다.
  // 일반 메뉴에서 시작한 경우: 과목 전체 개념/유형과 기본 시간(60분)을 사용한다.
  const [conceptIds, setConceptIds] = useState<string[]>(() => {
    if (requestedConceptIds.length) return validRequestedConceptIds; // 0개면 빈 배열 유지(차단)
    return concepts.filter((c) => c.subjectId === subject.id).map((c) => c.id);
  });
  const [types, setTypes] = useState<ProblemType[]>(() => {
    if (requestedTypesList.length) return validRequestedTypes; // 0개면 빈 배열 유지(차단)
    return Array.from(new Set(problems.filter((p) => p.subjectId === subject.id && p.isApproved !== false && isProblemAvailableForPractice(p)).map((p) => p.type)));
  });
  const [count, setCount] = useState(4);
  const [minutes, setMinutes] = useState(() => {
    const requested = initialConfig?.minutes;
    return requested && Number.isFinite(requested) ? Math.min(180, Math.max(5, Math.round(requested))) : 60;
  });
  const activeStoredSession = () =>
    loadMockExams().find(
      (s) => s.subjectId === subject.id && s.status !== 'recorded' && s.status !== 'abandoned'
    );
  const [session, setSession] = useState<MockExamSession | null>(() => {
    // An explicit exam id from the URL opens EXACTLY that session (including a
    // submitted/graded one, shown read-only). Otherwise resume the subject's
    // active session. Never creates a new exam, and never shows another
    // subject's exam under this subject.
    const requested = initialExamId
      ? loadMockExams().find((s) => s.id === initialExamId && s.subjectId === subject.id) ?? null
      : null;
    const stored = requested ?? activeStoredSession();
    return stored ? expireMockExam(stored, Date.now()) : null;
  });
  // 진행 중 세션이 있고 계획 설정이 전달되면 "이어서 풀기"와 "새 계획으로 시작"을 구분한다.
  const [resumeDecision, setResumeDecision] = useState<'ask' | 'resume' | 'new'>(() => {
    if (initialConfig && activeStoredSession()) return 'ask';
    return 'resume';
  });
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [syncBlocked, setSyncBlocked] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [failedSaveOp, setFailedSaveOp] = useState<FailedExamSaveOp>(null);
  const [pendingAvailable, setPendingAvailable] = useState(false);
  const [pendingReadFailed, setPendingReadFailed] = useState(false);
  const [pendingStale, setPendingStale] = useState(false);
  const [otherTabPendings, setOtherTabPendings] = useState<PendingExamAnswers[]>([]);
  const [otherTabReadError, setOtherTabReadError] = useState<string | null>(null);
  const [otherTabArchives, setOtherTabArchives] = useState<ExamConflictArchive[]>([]);
  const [otherTabArchiveError, setOtherTabArchiveError] = useState<string | null>(null);
  // A conflict between the local expired answers and a newer server snapshot
  // (URL deep link). While true, a plain submit is BLOCKED until the user
  // explicitly compares and chooses.
  const [expiredConflict, setExpiredConflict] = useState(false);
  const [serverSnapshot, setServerSnapshot] = useState<MockExamSession | null>(null);
  // Whether THIS open started from an already-expired session: interval ticks
  // and keystroke saves must never auto-submit it (explicit submit only).
  const [expiredAtOpen] = useState(() => {
    const requested = initialExamId
      ? loadMockExams().find((s) => s.id === initialExamId && s.subjectId === subject.id) ?? null
      : null;
    const stored = requested ?? activeStoredSession();
    return Boolean(
      stored && stored.status === 'in_progress' && expireMockExam(stored, Date.now()).status === 'submitted'
    );
  });
  // Local answers preserved at conflict time for explicit review. Never
  // auto-merged, auto-saved or auto-cleared; shown even after the server
  // snapshot is adopted.
  const [conflictArchive, setConflictArchive] = useState<ExamConflictArchive | null>(null);
  // Server version the preserved local answers were written against.
  const [conflictBaseVersion, setConflictBaseVersion] = useState<number | null>(null);
  // Server-authoritative version guard for optimistic autosave/submit.
  const serverVersionRef = useRef(1);
  const autosaveTimerRef = useRef<number | null>(null);
  // Autosave/submit are serialized so an older request can never overwrite a
  // newer one, and a final submit always runs after pending autosaves.
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  // Bumped on unmount / account change / modal close / session switch so late responses never touch other UI.
  const opTokenRef = useRef(0);
  const sessionRef = useRef<MockExamSession | null>(session);
  const userIdRef = useRef(userId);
  const isOpenRef = useRef(isOpen);
  const syncBlockedRef = useRef(syncBlocked);
  const pendingReadFailedRef = useRef(pendingReadFailed);
  const refreshGenRef = useRef(0);
  const inputGenRef = useRef(0);
  const finalizingRecordedRef = useRef(false);
  const tabIdRef = useRef<string>('');

  const enqueue = useCallback((task: () => Promise<void>) => {
    syncChainRef.current = syncChainRef.current.then(task, task);
  }, []);

  const enqueueResult = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = syncChainRef.current.then(task, task);
    syncChainRef.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }, []);

  const isOpValid = useCallback(
    (token: number, expectedUserId: string, expectedSessionId: string): boolean =>
      token === opTokenRef.current &&
      isOpenRef.current &&
      userIdRef.current === expectedUserId &&
      sessionRef.current?.id === expectedSessionId,
    []
  );

  // Applies a server snapshot (answers + version + status + evaluations) as one
  // consistent unit, so a stale local answer set is never paired with a newer
  // server version.
  const applySnapshot = (next: MockExamSession) => {
    saveMockExam(next);
    setSession(next);
  };

  // Persists an unsaved snapshot to the device FIRST, so a closed tab or a late
  // server response can never lose what the user typed. Returns whether the
  // device actually stored it.
  const persistPending = useCallback(
    (target: MockExamSession, baseVersion: number): boolean => {
      if (!userId) return true;
      const ok = savePendingExamAnswers(userId, target, baseVersion, tabIdRef.current || undefined);
      if (!ok) {
        setSyncNotice('미저장 답안을 이 기기에 보존하지 못했습니다. 창을 닫지 말고 다시 시도해 주세요.');
      }
      return ok;
    },
    [userId]
  );

  const syncPendingAfterServerConfirm = useCallback(
    (target: MockExamSession, confirmedVersion: number) => {
      if (!userId) return;
      const tabId = tabIdRef.current || undefined;
      const current = sessionRef.current;
      if (pendingAfterAutosave(target, current) === 'keep-current' && current) {
        const saved = savePendingExamAnswers(userId, current, confirmedVersion, tabId);
        if (!saved) {
          setSyncNotice('서버 저장 후 새로 입력된 답안을 이 기기에 보존하지 못했습니다. 창을 닫지 말고 다시 시도해 주세요.');
        }
        const currentRead = loadPendingExamAnswersResult(userId, target.id, tabId);
        setPendingAvailable(saved || !currentRead.ok || Boolean(currentRead.value));
      } else {
        const cleared = clearPendingExamAnswers(userId, target.id, tabId);
        if (!cleared) {
          setPendingAvailable(true);
          setSyncNotice('서버 저장은 완료되었으나 기기의 임시 미저장 답안 정리에 실패했습니다. 다시 시도할 수 있습니다.');
        } else {
          setPendingAvailable(false);
        }
      }
    },
    [userId]
  );

  const refreshOtherTabRecords = useCallback(
    (targetUserId: string | undefined, sessionId: string, tabId?: string) => {
      if (!targetUserId) {
        setOtherTabPendings([]);
        setOtherTabReadError(null);
        setOtherTabArchives([]);
        setOtherTabArchiveError(null);
        return;
      }
      const otherPendingRes = listOtherTabPendingExamAnswers(targetUserId, sessionId, tabId);
      if (otherPendingRes.ok) {
        setOtherTabPendings(otherPendingRes.value ?? []);
        setOtherTabReadError(null);
      } else {
        // Keep existing list on read/corrupt failure so errors are never hidden as empty.
        setOtherTabReadError(otherPendingRes.error);
      }
      const otherArchRes = listOtherTabConflictArchives(targetUserId, sessionId, tabId);
      if (otherArchRes.ok) {
        setOtherTabArchives(otherArchRes.value ?? []);
        setOtherTabArchiveError(null);
      } else {
        setOtherTabArchiveError(otherArchRes.error);
      }
    },
    []
  );

  const clearArchiveAfterConfirm = useCallback(
    (sessionId: string): boolean => {
      if (!userId) {
        setConflictArchive(null);
        return true;
      }
      const tabId = tabIdRef.current || undefined;
      const cleared = clearConflictArchive(userId, sessionId, tabId);
      if (cleared) {
        setConflictArchive(null);
        refreshOtherTabRecords(userId, sessionId, tabId);
        return true;
      }
      const reload = loadConflictArchiveResult(userId, sessionId, tabId);
      if (reload.ok && reload.value) setConflictArchive(reload.value);
      setSyncNotice('제출·기록은 완료되었으나 기기에 보존된 충돌 답안을 정리하지 못했습니다.');
      return false;
    },
    [userId, refreshOtherTabRecords]
  );

  // Preserves the local conflicting answers as a reviewable archive BEFORE any
  // server snapshot is adopted. An already-preserved copy for the same tab is
  // kept (never silently replaced); if newer local answers `B` differ from an
  // existing archive `A`, `B` must be verified in pending or saved to a separate
  // immutable recovery copy before returning true.
  const preserveLocalAsConflictArchive = useCallback(
    (
      local: MockExamSession,
      baseVersion: number,
      comparedVersion: number
    ): boolean => {
      if (!userId) {
        setSyncNotice('계정 정보가 없어 로컬 답안을 보존하지 못했습니다. 서버 답안을 적용하지 않았습니다.');
        return false;
      }
      const tabId = tabIdRef.current || undefined;
      const archive: ExamConflictArchive = {
        sessionId: local.id,
        answers: { ...local.answers },
        reasons: local.reasons ? { ...local.reasons } : undefined,
        isReasonNotApplicable: local.isReasonNotApplicable ? { ...local.isReasonNotApplicable } : undefined,
        reasonNotApplicableJustification: local.reasonNotApplicableJustification
          ? { ...local.reasonNotApplicableJustification }
          : undefined,
        baseVersion,
        comparedServerVersion: comparedVersion,
        savedAt: new Date().toISOString(),
      };
      const result = saveConflictArchive(userId, archive, tabId);
      if (result.ok) {
        const reload = loadConflictArchiveResult(userId, local.id, tabId);
        setConflictArchive(reload.ok ? (reload.value ?? archive) : archive);
        refreshOtherTabRecords(userId, local.id, tabId);
        return true;
      }
      if (result.reason === 'exists') {
        const reload = loadConflictArchiveResult(userId, local.id, tabId);
        if (!reload.ok || !reload.value) {
          setSyncNotice(
            `이미 보존된 로컬 답안을 불러오지 못했습니다(${reload.ok ? '항목 없음' : reload.error}). 기존 보존 상태를 보호하기 위해 서버 답안을 적용하지 않았습니다.`
          );
          return false;
        }
        setConflictArchive(reload.value);
        // Same content as existing archive `A`: already preserved.
        if (!pendingDiffersFrom(local, reload.value)) {
          return true;
        }
        // Existing archive `A` differs from latest local `B`: verify `B` is
        // already in this tab's pending OR save `B` into an immutable recovery copy.
        const pendingRead = loadPendingExamAnswersResult(userId, local.id, tabId);
        if (pendingRead.ok && pendingRead.value && !pendingDiffersFrom(local, pendingRead.value)) {
          return true;
        }
        const immutableRes = saveImmutableConflictArchive(userId, archive, tabId);
        if (immutableRes.ok) {
          refreshOtherTabRecords(userId, local.id, tabId);
          return true;
        }
        setSyncNotice(
          `최신 로컬 답안의 추가 보존 사본을 저장하지 못했습니다(${immutableRes.error ?? '저장소 확인 불가'}). 현재 로컬 답안을 유지합니다.`
        );
        return false;
      }
      setSyncNotice(
        `로컬 답안 보존에 실패했습니다(${result.error ?? '저장소 확인 불가'}). 현재 로컬 답안을 유지하며, 서버 답안을 적용하지 않았습니다.`
      );
      return false;
    },
    [userId, refreshOtherTabRecords]
  );

  const runAutosave = (target: MockExamSession, token: number) => {
    if (token !== opTokenRef.current || syncBlockedRef.current || pendingReadFailedRef.current) {
      return Promise.resolve();
    }
    setSaveState('saving');
    return autosaveMockExam(target, serverVersionRef.current).then((result) => {
      if (token !== opTokenRef.current || syncBlockedRef.current || pendingReadFailedRef.current) return;
      if (result.ok) {
        serverVersionRef.current = result.version;
        syncBlockedRef.current = false;
        setSyncBlocked(false);
        setSaveState('saved');
        setSaveMessage('');
        setFailedSaveOp(null);
        syncPendingAfterServerConfirm(target, result.version);
      } else if (result.code === 'stale' || result.code === 'locked') {
        // Preserve the LATEST input, never the older request's snapshot.
        const latest = sessionRef.current ?? target;
        const preserved = persistPending(latest, serverVersionRef.current);
        const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
        setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
        syncBlockedRef.current = true;
        flushAutosaveTimer();
        setSyncBlocked(true);
        setSaveState('conflict');
        setFailedSaveOp(null);
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
        setFailedSaveOp(null);
      } else {
        // Preserve the LATEST input, never the older request's snapshot.
        const latest = sessionRef.current ?? target;
        const preserved = persistPending(latest, serverVersionRef.current);
        const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
        setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
        setSaveState('error');
        setFailedSaveOp({ kind: 'autosave' });
        setSaveMessage(
          preserved
            ? '서버 자동 저장에 실패했습니다. 답안은 이 기기에 보존되며 다시 시도할 수 있습니다.'
            : '서버 자동 저장과 기기 임시 보존에 모두 실패했습니다. 창을 닫지 말고 다시 시도해 주세요.'
        );
      }
    });
  };

  const runGrading = (
    target: MockExamSession,
    status: 'submitted' | 'graded' | 'recorded',
    token: number
  ) => {
    if (token !== opTokenRef.current) return Promise.resolve();
    setSaveState('saving');
    return saveMockExamGradingOnServer(target, serverVersionRef.current, status).then((result) => {
      if (token !== opTokenRef.current) return;
      if (result.ok) {
        serverVersionRef.current = result.version;
        syncBlockedRef.current = false;
        setSyncBlocked(false);
        setSaveState('saved');
        setSaveMessage('');
        setFailedSaveOp(null);
      } else if (result.code === 'stale' || result.code === 'locked') {
        syncBlockedRef.current = true;
        flushAutosaveTimer();
        setSyncBlocked(true);
        setSaveState('conflict');
        setFailedSaveOp(null);
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
        setFailedSaveOp(null);
      } else {
        setSaveState('error');
        setFailedSaveOp({ kind: 'grading', status });
        setSaveMessage('채점 결과를 서버에 저장하지 못했습니다. 다시 시도할 수 있습니다.');
      }
    });
  };

  const flushAutosaveTimer = () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const scheduleAutosave = (target: MockExamSession) => {
    flushAutosaveTimer();
    if (syncBlockedRef.current || pendingReadFailedRef.current) return;
    const scheduledToken = opTokenRef.current;
    autosaveTimerRef.current = window.setTimeout(() => {
      if (scheduledToken !== opTokenRef.current || syncBlockedRef.current || pendingReadFailedRef.current) return;
      enqueue(() => runAutosave(sessionRef.current ?? target, scheduledToken));
    }, 800);
  };

  // Idempotent server submit of a submitted/expired session. Shared by the
  // expiry interval and by a keystroke that lands after the deadline.
  const enqueueSubmitSession = useCallback(
    (submitted: MockExamSession) => {
      const token = opTokenRef.current;
      enqueue(async () => {
        if (token !== opTokenRef.current) return;
        const result = await submitMockExamOnServer(submitted, serverVersionRef.current);
        if (token !== opTokenRef.current) return;
        if (result.ok) {
          serverVersionRef.current = result.version;
          setSaveState('saved');
          setSaveMessage('');
          setFailedSaveOp(null);
          // A confirmed submit supersedes any preserved conflict copy.
          clearArchiveAfterConfirm(submitted.id);
          syncPendingAfterServerConfirm(submitted, result.version);
        } else if (result.code === 'stale' || result.code === 'locked') {
          const latest = sessionRef.current ?? submitted;
          const preserved = persistPending(latest, serverVersionRef.current);
          const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
          setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
          setSyncBlocked(true);
          setSaveState('conflict');
          setFailedSaveOp(null);
        } else if (result.code !== 'not_configured') {
          const latest = sessionRef.current ?? submitted;
          const preserved = persistPending(latest, serverVersionRef.current);
          const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
          setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
          setSaveState('error');
          setFailedSaveOp({ kind: 'submit', session: submitted });
          setSaveMessage(
            preserved
              ? '제출을 서버에 저장하지 못했습니다. 답안은 이 기기에 보존되며 다시 시도할 수 있습니다.'
              : '제출 저장과 기기 임시 보존에 모두 실패했습니다. 창을 닫지 말고 다시 시도해 주세요.'
          );
        }
      });
    },
    [enqueue, userId, clearArchiveAfterConfirm, syncPendingAfterServerConfirm, persistPending]
  );

  // Persist local, then mirror to the server according to the exam phase.
  const save = (updated: MockExamSession) => {
    const previousStatus = sessionRef.current?.status;
    saveMockExam(updated);
    setSession(updated);
    const token = opTokenRef.current;
    if (updated.status === 'in_progress') {
      inputGenRef.current += 1;
      // Preserve edits into pending whenever storage is readable, even while
      // syncBlocked (do NOT schedule server autosaves while blocked/unreadable).
      if (!pendingReadFailedRef.current) {
        persistPending(updated, serverVersionRef.current);
      }
      if (!syncBlockedRef.current && !pendingReadFailedRef.current) {
        scheduleAutosave(updated);
      }
    } else if (updated.status === 'submitted' && previousStatus === 'in_progress') {
      // A keystroke landed after the deadline: the session just became
      // submitted. Preserve the answers; the idempotent submit is enqueued
      // ONLY when the deadline policy allows auto-submit (a session that was
      // ALREADY expired at open needs an explicit submit action instead).
      persistPending(updated, serverVersionRef.current);
      if (shouldAutoSubmitExpired({ deferExpiredSubmit, expiredAtOpen })) {
        enqueueSubmitSession(updated);
      } else {
        setSyncNotice('만료된 시험입니다. 자동 제출하지 않습니다. "시험 제출" 또는 "저장된 답안으로 제출" 버튼으로 명시적으로 제출해 주세요.');
      }
    } else if (updated.status === 'graded' || updated.status === 'recorded') {
      enqueue(() => runGrading(updated, updated.status === 'recorded' ? 'recorded' : 'graded', token));
    }
  };

  // Persists partial grading progress while the exam is still 'submitted'.
  const saveGradingProgress = (updated: MockExamSession) => {
    saveMockExam(updated);
    setSession(updated);
    const token = opTokenRef.current;
    enqueue(() => runGrading(updated, 'submitted', token));
  };

  // Keep refs in sync for async callbacks without touching refs during render.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    syncBlockedRef.current = syncBlocked;
    if (syncBlocked) flushAutosaveTimer();
  }, [syncBlocked]);

  useEffect(() => {
    pendingReadFailedRef.current = pendingReadFailed;
    if (pendingReadFailed) flushAutosaveTimer();
  }, [pendingReadFailed]);

  // Keep per-tab lease fresh and release on pagehide so refreshes keep the same tab id
  // while duplicated tabs fork to a distinct tab id.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    if (!tabIdRef.current) tabIdRef.current = resolveExamTabId();
    const tabId = tabIdRef.current;
    refreshExamTabLease(tabId);
    const heartbeat = window.setInterval(() => refreshExamTabLease(tabId), 5000);
    const onPageHide = () => releaseExamTabLease(tabId);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isOpen]);

  // Invalidate in-flight work and cancel pending autosaves on unmount,
  // modal close, account change, or session switch.
  useEffect(() => {
    return () => {
      opTokenRef.current += 1;
      refreshGenRef.current += 1;
      finalizingRecordedRef.current = false;
      flushAutosaveTimer();
      setBusy(false);
    };
  }, [isOpen, session?.id, userId]);

  useEffect(() => {
    if (!isOpen || session?.status !== 'in_progress') return;
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= new Date(session.endsAt).getTime()) {
        setSession((previous) => {
          if (!previous || previous.status !== 'in_progress') return previous;
          const submitted = expireMockExam(previous, tick);
          saveMockExam(submitted);
          // Preserve the submitted answers so a failed/expired submit is not lost.
          if (userId && !savePendingExamAnswers(userId, submitted, serverVersionRef.current, tabIdRef.current || undefined)) {
            setSyncNotice('미저장 답안을 이 기기에 보존하지 못했습니다. 창을 닫지 말고 다시 시도해 주세요.');
          }
          // A session that was ALREADY expired at open never auto-submits from
          // the interval: every submit there needs an explicit user action.
          if (shouldAutoSubmitExpired({ deferExpiredSubmit, expiredAtOpen })) {
            enqueueSubmitSession(submitted);
          } else {
            setSyncNotice('만료된 시험입니다. 자동 제출하지 않습니다. "시험 제출" 또는 "저장된 답안으로 제출" 버튼으로 명시적으로 제출해 주세요.');
          }
          return submitted;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, session?.status, session?.endsAt, userId, enqueueSubmitSession, deferExpiredSubmit, expiredAtOpen]);

  // On open (or session change) reconcile with the server. The server snapshot
  // (answers + version + status + evaluations) is applied as ONE unit. Local
  // answers are only treated as unsaved when a matching pending entry proves it;
  // otherwise the local cache is replaced by the server record.
  useEffect(() => {
    if (!isOpen || !session?.id) return;
    const token = opTokenRef.current;
    let cancelled = false;
    void fetchMockExamFromServer(session.id).then((result) => {
      if (cancelled || token !== opTokenRef.current) return;
      const local = sessionRef.current;
      if (!result.ok) {
        if (result.code === 'missing' && local && local.status === 'in_progress') {
          void createMockExamOnServer(local).then((created) => {
            if (cancelled || token !== opTokenRef.current) return;
            if (created.ok) serverVersionRef.current = created.version;
            else if (created.code === 'conflict') setSyncBlocked(true);
          });
        }
        return;
      }
      const server = result.session;
      // A stale exam opened via URL must NOT be auto-submitted. Keep the local
      // expired (submitted) copy, treat the server answers+version+status as one
      // snapshot, and require an EXPLICIT comparison/choice when the local
      // answers differ from the server's (never let a plain submit overwrite).
      if (deferExpiredSubmit && local && local.status === 'submitted' && server.status === 'in_progress') {
        const pendingRead = userId
          ? loadPendingExamAnswersResult(userId, server.id, tabIdRef.current || undefined)
          : null;
        const adoption = decideServerSnapshotAdoption(pendingRead);
        if (!adoption.adopt) {
          flushAutosaveTimer();
          syncBlockedRef.current = true;
          pendingReadFailedRef.current = true;
          setServerSnapshot(null);
          setExpiredConflict(false);
          setSyncBlocked(true);
          setPendingAvailable(true);
          setPendingReadFailed(true);
          setSyncNotice(
            `로컬 미저장 답안을 읽지 못했습니다(${adoption.error}). 기존 로컬 데이터를 유지하며 서버 답안을 적용하지 않았습니다.`
          );
          return;
        }
        pendingReadFailedRef.current = false;
        setPendingReadFailed(false);
        const pending = adoption.pending;
        const decision = planExpiredUrlOpen({
          local,
          server,
          serverVersion: result.version,
          localBaseVersion: resolveLocalBaseVersion({
            pendingBaseVersion: pending?.baseVersion,
            sessionServerVersion: local.serverVersion,
            lastKnownVersion: serverVersionRef.current,
          }),
        });
        // The version confirmed at comparison time: an explicit submit uses it,
        // so a later server change is caught as stale (re-conflict).
        serverVersionRef.current = decision.confirmedVersion;
        setConflictBaseVersion(decision.localBaseVersion);
        // Preserve the local answers WITH their base version BEFORE showing any
        // choice: adopting the server snapshot must never lose them, and a
        // failed preservation keeps the local copy and blocks the choice UI.
        if (!preserveLocalAsConflictArchive(local, decision.localBaseVersion, decision.confirmedVersion)) {
          setServerSnapshot(server);
          setExpiredConflict(false);
          setSyncBlocked(true);
          return;
        }
        setServerSnapshot(server);
        setExpiredConflict(decision.conflict);
        setSyncBlocked(true);
        setSyncNotice(
          decision.conflict
            ? '서버에 더 최신 답안이 있습니다. 로컬 답안은 이 기기에 보존했습니다. 비교 후 선택해야 하며, 비교 없이 제출하면 서버 답안을 덮어쓰지 않습니다.'
            : '만료된 시험이 서버에는 아직 진행 중으로 남아 있습니다. "저장된 답안으로 제출"을 눌러 마감 처리하세요.'
        );
        return;
      }
      setExpiredConflict(false);
      setServerSnapshot(null);
      const tabId = tabIdRef.current || undefined;
      refreshOtherTabRecords(userId, server.id, tabId);
      const pendingRead = userId ? loadPendingExamAnswersResult(userId, server.id, tabId) : null;
      const adoption = decideServerSnapshotAdoption(pendingRead);
      if (!adoption.adopt) {
        // Do NOT overwrite in-memory session, primary cache, or serverVersionRef
        // when local pending answers could not be verified.
        flushAutosaveTimer();
        syncBlockedRef.current = true;
        pendingReadFailedRef.current = true;
        setPendingAvailable(true);
        setPendingReadFailed(true);
        setSyncBlocked(true);
        setSyncNotice(
          `로컬 미저장 답안을 읽지 못했습니다(${adoption.error}). 기존 로컬 데이터를 보존하기 위해 서버 답안을 적용하지 않았습니다.`
        );
        return;
      }
      pendingReadFailedRef.current = false;
      setPendingReadFailed(false);
      const pending = adoption.pending;
      const plan = planReconcile(local, server, result.version, pending);
      serverVersionRef.current = result.version;

      // Apply the server snapshot (answers + version + status + evaluations) as
      // one unit. Local answers are never merged on top of it.
      applySnapshot(server);
      if (server.status !== 'in_progress') {
        // The server already holds the terminal state: no local submit is pending.
        setSaveState('saved');
        setFailedSaveOp(null);
      }

      if (plan.unsaved) {
        // Unsaved changes stay in the separate pending area for explicit review;
        // a pending entry based on a different server version is never
        // auto-applied or auto-saved.
        setPendingAvailable(true);
        setPendingStale(plan.stale);
        setSyncBlocked(true);
        setSyncNotice(
          plan.stale
            ? '서버 기록이 이 기기의 미저장 답안 기준 버전과 다릅니다. 서버 답안과 비교한 뒤 확인이 필요합니다.'
            : server.status === 'in_progress'
            ? '이 기기에 저장되지 않은 답안이 있습니다. 서버 답안과 비교해 복구할 수 있습니다.'
            : '다른 기기에서 이미 제출되어 종료된 시험입니다. 이 기기의 미저장 답안은 제출 답안과 별도로 보존됩니다.'
        );
        return;
      }

      // No real unsaved changes: discard stale pending and adopt the server copy.
      if (plan.clearPending && userId) {
        const cleared = clearPendingExamAnswers(userId, server.id, tabId);
        if (!cleared) {
          setPendingAvailable(true);
          setPendingStale(false);
          setSyncNotice('서버와 동일한 미저장 답안을 기기에서 정리하지 못했습니다. 기존 데이터는 보존됩니다.');
          return;
        }
      }
      setPendingAvailable(false);
      setPendingStale(false);
      if (plan.notify) {
        setSyncNotice(
          server.status === 'in_progress'
            ? '서버의 최신 기록(답안·채점)을 불러왔습니다.'
            : '다른 기기에서 이미 제출되어 이 시험은 종료되었습니다.'
        );
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, session?.id, userId, deferExpiredSubmit, preserveLocalAsConflictArchive, refreshOtherTabRecords]);

  const resolveFromServer = async () => {
    const localAtStart = sessionRef.current;
    if (!localAtStart) return;
    const token = opTokenRef.current;
    const targetUserId = userId;
    const targetSessionId = localAtStart.id;
    const tabId = tabIdRef.current || undefined;
    const requestGen = ++refreshGenRef.current;
    await enqueueResult(async () => {
      await executeResolveFromServer({
        sessionId: targetSessionId,
        getCurrentLocal: () => sessionRef.current,
        getInputGen: () => inputGenRef.current,
        userId: targetUserId,
        hadPendingReadFailure: pendingReadFailedRef.current,
        requestGen,
        getCurrentRequestGen: () => refreshGenRef.current,
        isStillValid: () => isOpValid(token, targetUserId, targetSessionId),
        fetchServer: fetchMockExamFromServer,
        readPending: (uid, sid) => loadPendingExamAnswersResult(uid, sid, tabId),
        savePending: (uid, s, ver) => savePendingExamAnswers(uid, s, ver, tabId),
        flushAutosaveTimer,
        applySnapshot,
        setServerVersion: (v) => {
          serverVersionRef.current = v;
        },
        setSyncBlocked: (blocked) => {
          syncBlockedRef.current = blocked;
          setSyncBlocked(blocked);
        },
        setSaveState,
        setFailedSaveOp,
        setPendingAvailable,
        setPendingReadFailed: (failed) => {
          pendingReadFailedRef.current = failed;
          setPendingReadFailed(failed);
        },
        setSyncNotice,
      });
      if (isOpValid(token, targetUserId, targetSessionId)) {
        refreshOtherTabRecords(targetUserId, targetSessionId, tabId);
      }
    });
  };

  const restorePending = () => {
    const local = sessionRef.current;
    if (!userId || !local) return;
    const pendingRead = loadPendingExamAnswersResult(userId, local.id, tabIdRef.current || undefined);
    if (!pendingRead.ok) {
      setPendingReadFailed(true);
      setSyncNotice(`미저장 답안을 읽지 못했습니다(${pendingRead.error}). 기존 로컬 데이터는 보존됩니다.`);
      return;
    }
    setPendingReadFailed(false);
    const pending = pendingRead.value;
    if (!pending) return;
    if (local.status !== 'in_progress') {
      setSyncNotice('제출·채점이 끝난 시험에는 미저장 답안을 적용할 수 없습니다. 미저장 내용은 별도로 보존됩니다.');
      return;
    }
    const merged = applyPendingAnswers(local, pending);
    applySnapshot(merged);
    setSyncBlocked(false);
    setPendingStale(false);
    setPendingAvailable(true);
    setSyncNotice('이 기기의 미저장 답안을 복구했습니다. 서버 저장을 다시 시도합니다.');
    scheduleAutosave(merged);
  };

  const applyOtherTabSnapshot = (item: PendingExamAnswers | ExamConflictArchive, label: string) => {
    const local = sessionRef.current;
    if (!local || local.status !== 'in_progress') return;
    const merged = applyPendingAnswers(local, item);
    if (!userId) {
      setSyncNotice('계정 정보가 없어 다른 탭 답안을 이 탭에 안전하게 저장할 수 없습니다.');
      return;
    }
    const tabId = tabIdRef.current || undefined;
    // If this tab already holds a different unsaved draft, preserve it in conflict
    // archive before overwriting the working copy with the user-selected snapshot.
    const currentPendingRead = loadPendingExamAnswersResult(userId, local.id, tabId);
    if (!currentPendingRead.ok) {
      setSyncNotice(`현재 탭의 미저장 답안을 확인하지 못했습니다(${currentPendingRead.error}). 기존 입력을 보호합니다.`);
      return;
    }
    const hasDifferentLocal =
      !answerFieldsEqual(local, merged) &&
      (Boolean(currentPendingRead.value) || pendingAvailable);
    if (hasDifferentLocal) {
      const preserved = preserveLocalAsConflictArchive(local, serverVersionRef.current, serverVersionRef.current);
      if (!preserved) return;
    }
    // Verify the selected snapshot is persisted into THIS tab's pending BEFORE
    // overwriting the working copy or scheduling any server save.
    const saved = savePendingExamAnswers(userId, merged, serverVersionRef.current, tabId);
    const verified = saved ? loadPendingExamAnswersResult(userId, merged.id, tabId) : null;
    if (!saved || !verified || !verified.ok || !verified.value || pendingDiffersFrom(merged, verified.value)) {
      setSyncNotice('선택한 답안을 이 탭의 미저장 영역에 보존하지 못했습니다. 기존 입력을 유지합니다.');
      return;
    }
    applySnapshot(merged);
    syncBlockedRef.current = false;
    setSyncBlocked(false);
    setPendingAvailable(true);
    setSyncNotice(`${label}을(를) 이 탭 작업본으로 불러왔습니다. 서버 저장을 다시 시도합니다.`);
    scheduleAutosave(merged);
  };

  // Explicit choice: adopt the SERVER answers (recommended). The local expired
  // copy is preserved as a reviewable archive FIRST — adopting never deletes
  // it, never submits anything, and never touches the pending slot. If the
  // adopted snapshot is itself past the deadline it is flipped to submitted
  // LOCALLY only; the final submit still needs the explicit submit button.
  const adoptServerSnapshot = () => {
    const local = sessionRef.current;
    if (!local || !serverSnapshot) return;
    const pendingRead = userId ? loadPendingExamAnswersResult(userId, local.id, tabIdRef.current || undefined) : null;
    const adoption = decideServerSnapshotAdoption(pendingRead);
    if (!adoption.adopt) {
      setPendingAvailable(true);
      setPendingReadFailed(true);
      setSyncBlocked(true);
      setSyncNotice(
        `로컬 미저장 답안을 읽지 못했습니다(${adoption.error}). 안전을 위해 서버 답안을 적용하지 않았습니다.`
      );
      return;
    }
    setPendingReadFailed(false);
    const pending = adoption.pending;
    const baseVersion =
      conflictBaseVersion ??
      resolveLocalBaseVersion({
        pendingBaseVersion: pending?.baseVersion,
        sessionServerVersion: local.serverVersion,
        lastKnownVersion: serverVersionRef.current,
      });
    // Preservation failure (or missing account) blocks the adoption: the
    // current local answers are kept and the user is told how to retry.
    if (!preserveLocalAsConflictArchive(local, baseVersion, serverVersionRef.current)) return;
    applySnapshot(serverSnapshot);
    setExpiredConflict(false);
    setServerSnapshot(null);
    if (serverSnapshot.status === 'in_progress' && expireMockExam(serverSnapshot, Date.now()).status === 'submitted') {
      const expired = expireMockExam(serverSnapshot, Date.now());
      applySnapshot(expired);
      setSyncBlocked(true);
      setSyncNotice(
        '서버 답안을 적용했습니다. 만료된 시험이므로 자동 제출하지 않습니다. "저장된 답안으로 제출" 버튼으로 명시적으로 제출하거나, 아래 보존된 로컬 답안을 확인할 수 있습니다.'
      );
    } else {
      setSyncBlocked(false);
      setSaveState('saved');
      setSyncNotice('서버의 최신 답안을 적용했습니다. 보존된 로컬 답안은 아래에서 계속 확인할 수 있습니다.');
    }
  };

  // Restores the preserved local answers onto the working copy. Allowed only
  // while the working copy is still in_progress; a submitted/graded/recorded
  // exam keeps its terminal state and the archive stays for review.
  const restoreConflictArchive = () => {
    const local = sessionRef.current;
    if (!userId || !local) return;
    const tabId = tabIdRef.current || undefined;
    const archiveRead = loadConflictArchiveResult(userId, local.id, tabId);
    if (!archiveRead.ok) {
      setSyncNotice(`보존된 로컬 답안을 읽지 못했습니다(${archiveRead.error}). 기존 보존 데이터는 유지됩니다.`);
      return;
    }
    const archived = archiveRead.value;
    if (!archived) return;
    if (local.status !== 'in_progress') {
      setSyncNotice('제출·채점이 끝난 시험에는 보존된 답안을 적용할 수 없습니다. 보존 내용은 계속 확인할 수 있습니다.');
      return;
    }
    const merged = applyPendingAnswers(local, { ...archived, savedAt: archived.savedAt });
    applySnapshot(merged);
    setConflictArchive(archived);
    setSyncBlocked(false);
    setSyncNotice('보존된 로컬 답안을 작업본에 복구했습니다. 서버 저장을 다시 시도합니다.');
    scheduleAutosave(merged);
  };

  // Explicit user deletion of the preserved copy (e.g. after review). The
  // working copy and the pending slot are untouched.
  const deleteConflictArchive = () => {
    const local = sessionRef.current;
    if (!userId || !local) return;
    if (!window.confirm('보존된 로컬 답안을 삭제할까요? 현재 작업본에는 영향이 없습니다.')) return;
    const tabId = tabIdRef.current || undefined;
    const cleared = clearConflictArchive(userId, local.id, tabId);
    if (!cleared) {
      setSyncNotice('보존된 로컬 답안을 삭제하지 못했습니다. 다시 시도해 주세요.');
      return;
    }
    setConflictArchive(null);
    setSyncNotice('보존된 로컬 답안을 삭제했습니다.');
  };

  // Explicit choice: submit the LOCAL expired answers, using the server version
  // confirmed at comparison time. A server change in between is caught as stale
  // (the submit returns conflict instead of overwriting).
  const submitLocalExpiredAnswers = () => {
    const local = sessionRef.current;
    if (!local) return;
    setExpiredConflict(false);
    setServerSnapshot(null);
    setSyncNotice('선택한 만료 답안을 제출합니다. (확인된 서버 버전 기준)');
    persistPending(local, serverVersionRef.current);
    enqueueSubmitSession(local);
  };
  const current = session?.problems[index];
  const remaining = session ? Math.max(0, Math.ceil((new Date(session.endsAt).getTime() - now) / 1000)) : 0;
  const blocked = session?.problems.filter((p) => !eligible.some((available) => available.id === p.id)) ?? [];
  const history = isOpen ? loadMockExams().filter((s) => s.subjectId === subject.id && s.status === 'recorded') : [];
  // 계획 범위가 무효하여 선택이 비어 있고, 아직 사용자가 새로 선택하지 않은 상태.
  const showScopeWarning = requestedScopeInvalid && (!conceptIds.length || !types.length);

  const startExam = () => {
    // 중복 클릭으로 세션이 여러 개 생성되지 않도록 차단한다.
    if (busy) return;
    // 유효하지 않은 계획 범위로는 시작하지 않는다(전체 범위로 자동 확대 금지).
    if (!conceptIds.length || !types.length) {
      setError('시험 범위를 다시 선택해 주세요. 계획에 지정된 개념 또는 문제 유형이 더 이상 유효하지 않습니다.');
      return;
    }
    if (
      requestedScopePartial &&
      !window.confirm(
        '계획에 지정된 일부 개념 또는 문제 유형이 더 이상 유효하지 않아 제외됩니다. 현재 선택한 범위로 시작할까요?'
      )
    ) {
      return;
    }
    const chosen = selectMockExamProblems(subject, concepts, eligible, conceptIds, types, count);
    if (chosen.length < count) { setError(`조건에 맞는 문제는 ${chosen.length}개입니다. 문항 수나 범위를 조정해 주세요.`); return; }

    setBusy(true);
    const createdAt = new Date();
    const newId = crypto.randomUUID();
    const newSession: MockExamSession = {
      id: newId,
      subjectId: subject.id,
      createdAt: createdAt.toISOString(),
      endsAt: new Date(createdAt.getTime() + minutes * 60_000).toISOString(),
      durationMinutes: minutes,
      status: 'in_progress',
      selectedConceptIds: [...conceptIds],
      selectedTypes: [...types],
      problems: chosen,
      answers: {},
      reasons: {},
      isReasonNotApplicable: {},
      reasonNotApplicableJustification: {},
      evaluations: {},
    };
    try {
      // 기존 미완료 세션은 폐기 처리하고 새 세션을 저장한다(세션 ID로 구분/복원).
      for (const stored of loadMockExams()) {
        if (stored.subjectId === subject.id && stored.status !== 'recorded' && stored.status !== 'abandoned') {
          saveMockExam({ ...stored, status: 'abandoned' });
        }
      }
      saveMockExam(newSession);
      const persisted = loadMockExams().some((s) => s.id === newId);
      if (!persisted) {
        setError('새 모의시험 저장에 실패했습니다. 기존 세션은 그대로 유지됩니다. 다시 시도해 주세요.');
        return;
      }
      setSession(newSession);
      // "새 계획으로 시작"을 선택한 뒤에도 설정 화면에 머무르지 않도록 시험 화면으로 전환한다.
      setResumeDecision('resume');
      setNow(Date.now());
      setIndex(0);
      setError('');
      serverVersionRef.current = 1;
      setSyncBlocked(false);
      setSaveState('saving');
      setSaveMessage('');
      const startToken = opTokenRef.current;
      void createMockExamOnServer(newSession).then((result) => {
        if (startToken !== opTokenRef.current) return;
        if (result.ok) {
          serverVersionRef.current = result.version;
          setSaveState('saved');
        } else if (result.code === 'conflict') {
          // An identical id already exists with different content: never overwrite.
          setSaveState('conflict');
          setSyncBlocked(true);
          setSyncNotice('같은 ID의 시험이 서버에 다른 내용으로 존재합니다. 서버 기록을 확인해 주세요.');
        } else if (result.code === 'error') {
          setSaveState('error');
          setSaveMessage('시험을 서버에 저장하지 못했습니다. 로컬 기록은 보존됩니다.');
        } else {
          setSaveState('idle');
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '모의시험 저장 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const submitExam = () => {
    if (!session || session.status !== 'in_progress' || !window.confirm('답안을 제출하고 시험을 종료할까요?')) return;
    const checked = expireMockExam(session, Date.now());
    const submitted = checked.status === 'submitted' && checked.submittedAt
      ? checked
      : { ...checked, status: 'submitted' as const, submittedAt: new Date().toISOString() };
    saveMockExam(submitted);
    setSession(submitted);
    // Preserve the submitted answers before the request so a failure/close is safe.
    persistPending(submitted, serverVersionRef.current);
    // Cancel any debounced autosave, then enqueue submit AFTER in-flight saves
    // (the chain is FIFO) so the latest answers are what gets submitted.
    flushAutosaveTimer();
    const token = opTokenRef.current;
    setSaveState('saving');
    enqueue(async () => {
      if (token !== opTokenRef.current) return;
      const result = await submitMockExamOnServer(submitted, serverVersionRef.current);
      if (token !== opTokenRef.current) return;
      if (result.ok) {
        serverVersionRef.current = result.version;
        setSaveState('saved');
        setSaveMessage('');
        setFailedSaveOp(null);
        // A confirmed submit supersedes any preserved conflict copy.
        clearArchiveAfterConfirm(submitted.id);
        syncPendingAfterServerConfirm(submitted, result.version);
      } else if (result.code === 'stale' || result.code === 'locked') {
        const latest = sessionRef.current ?? submitted;
        const preserved = persistPending(latest, serverVersionRef.current);
        const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
        setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
        setSyncBlocked(true);
        setSaveState('conflict');
        setFailedSaveOp(null);
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
        setFailedSaveOp(null);
      } else {
        const latest = sessionRef.current ?? submitted;
        const preserved = persistPending(latest, serverVersionRef.current);
        const existing = userId ? loadPendingExamAnswersResult(userId, latest.id, tabIdRef.current || undefined) : null;
        setPendingAvailable(preserved || Boolean(existing && (!existing.ok || existing.value)));
        setSaveState('error');
        setFailedSaveOp({ kind: 'submit', session: submitted });
        setSaveMessage(
          preserved
            ? '제출을 서버에 저장하지 못했습니다. 로컬에 보존되며 다시 시도할 수 있습니다.'
            : '제출 저장과 기기 임시 보존에 모두 실패했습니다. 창을 닫지 말고 다시 시도해 주세요.'
        );
      }
    });
  };

  const gradeExam = async () => {
    if (!session || session.status !== 'submitted' || busy || blocked.length) return;
    const token = opTokenRef.current;
    const targetUserId = userId;
    const targetSession = session;
    setBusy(true); setError('');
    const evaluations = { ...targetSession.evaluations };
    try {
      for (const problem of targetSession.problems) {
        if (!isOpValid(token, targetUserId, targetSession.id)) return;
        const answer = targetSession.answers[problem.id]?.trim();
        if (!answer || evaluations[problem.id]) continue;

        const reason = targetSession.reasons?.[problem.id]?.trim();
        const isNotApplicable = Boolean(targetSession.isReasonNotApplicable?.[problem.id]);
        const reasonJustification = targetSession.reasonNotApplicableJustification?.[problem.id]?.trim();

        const response = await fetch('/api/evaluate-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mockExamSessionId: targetSession.id,
            problemId: problem.id,
            problemVersion: problem.version ?? 1,
            conceptId: problem.conceptIds[0],
            conceptIds: problem.conceptIds,
            subjectId: subject.id,
            domain: subject.domain || 'math_stats',
            problemTitle: problem.title,
            problemPrompt: problem.promptText,
            appliedConditionNote: problem.appliedConditionNote,
            mathFormula: problem.mathFormula,
            codeSnippet: problem.codeSnippet,
            modelAnswer: problem.modelAnswer,
            rubric: problem.rubric,
            userAnswer: answer,
            revealedHintCount: 0,
            hints: [],
            // Stage 8 fields
            solvingReason: isNotApplicable ? undefined : reason,
            isReasonNotApplicable: isNotApplicable,
            reasonNotApplicableJustification: isNotApplicable ? reasonJustification : undefined,
          }),
        });
        if (!isOpValid(token, targetUserId, targetSession.id)) return;
        const data = await response.json();
        if (!isOpValid(token, targetUserId, targetSession.id)) return;
        if (!response.ok || !data.success) throw new Error(`문항 「${problem.title}」: ${data.error || '평가 실패'}`);
        evaluations[problem.id] = data.evaluation as EvaluationResult;
        // Persist each completed evaluation (server + local) so a failure midway
        // can be recovered without re-calling the paid AI.
        saveGradingProgress({ ...targetSession, evaluations: { ...evaluations } });
      }
      if (!isOpValid(token, targetUserId, targetSession.id)) return;
      save({ ...targetSession, evaluations, status: 'graded' });
    } catch (cause) {
      if (isOpValid(token, targetUserId, targetSession.id)) {
        setError(cause instanceof Error ? cause.message : '평가에 실패했습니다. 완료된 문항은 보존했습니다.');
      }
    } finally {
      if (token === opTokenRef.current && userIdRef.current === targetUserId) {
        setBusy(false);
      }
    }
  };

  const finalizeRecorded = useCallback(
    async (recordedSession: MockExamSession, token: number, targetUserId: string) => {
      if (finalizingRecordedRef.current) return false;
      finalizingRecordedRef.current = true;
      try {
        return await enqueueResult(() =>
          finalizeRecordedExamOnServer({
            recordedSession,
            getExpectedVersion: () => serverVersionRef.current,
            isStillValid: () => isOpValid(token, targetUserId, recordedSession.id),
            saveGradingServer: saveMockExamGradingOnServer,
            applyRecordedLocal: (s) => {
              saveMockExam(s);
              setSession(s);
            },
            setServerVersion: (v) => {
              serverVersionRef.current = v;
            },
            setSyncBlocked: (b) => {
              syncBlockedRef.current = b;
              setSyncBlocked(b);
            },
            setSaveState,
            setSaveMessage,
            setFailedSaveOp,
            setError,
            setSyncNotice,
            clearArchiveAfterConfirm,
            onExamRecorded,
          })
        );
      } finally {
        finalizingRecordedRef.current = false;
      }
    },
    [clearArchiveAfterConfirm, enqueueResult, isOpValid, onExamRecorded]
  );

  const recordExam = async () => {
    if (!session || session.status !== 'graded' || blocked.length || busy) return;
    const token = opTokenRef.current;
    const targetUserId = userId;
    const targetSession = session;
    setBusy(true);
    setError('');
    try {
      const settings = loadStoredSettings();
      let partialCount = 0;
      const syncPayloads: Array<{ attemptRecord: Attempt; event: ReviewEvent }> = [];
      for (const problem of targetSession.problems) {
        const answer = targetSession.answers[problem.id]?.trim();
        const evaluation = targetSession.evaluations[problem.id];
        if (!answer || !evaluation || !problem.conceptIds.length) continue;
        const id = `att-exam-${targetSession.id}-${problem.id}`;
        // Always (re)record: the storage layer is idempotent and will recover an
        // Attempt whose review event was lost to a previous partial failure.

        const isNotApplicable = Boolean(targetSession.isReasonNotApplicable?.[problem.id]);
        const reason = targetSession.reasons?.[problem.id];
        const justification = targetSession.reasonNotApplicableJustification?.[problem.id];

        const attemptRecord: Attempt = {
          id,
          mockExamSessionId: targetSession.id,
          problemId: problem.id,
          conceptId: problem.conceptIds[0],
          conceptIds: [...problem.conceptIds],
          subjectId: subject.id,
          at: targetSession.submittedAt || new Date().toISOString(),
          answer,
          confidence: 3,
          errorType: evaluation.recommendedErrorType || 'none',
          hintCount: 0,
          reasoningNotes: '혼합형 모의시험 답안',
          calculatedScore: evaluation.calculatedScore,
          rubricResults: evaluation.rubricResults,
          evaluatorFeedback: evaluation.feedback,
          strengths: evaluation.strengths,
          criticalImprovements: evaluation.criticalImprovements,
          staticAnalysisNotice: evaluation.staticAnalysisNotice,
          needsReview: evaluation.needsReview,
          isAiEvaluated: evaluation.isAiEvaluated,
          problemVersion: problem.version ?? 1,
          problemTitleSnapshot: problem.title,
          problemPromptSnapshot: problem.promptText,
          modelAnswerSnapshot: problem.modelAnswer,
          rubricSnapshot: structuredClone(problem.rubric),
          // Stage 8 fields
          solvingReason: isNotApplicable ? undefined : reason,
          isReasonNotApplicable: isNotApplicable,
          reasonNotApplicableJustification: isNotApplicable ? justification : undefined,
          methodSelectionDiagnosis: evaluation.methodSelectionDiagnosis,
        };
        const result = recordAttemptAndUpdateConcept(attemptRecord, settings);
        if (result.partial) partialCount += 1;
        const concept = result.updatedConcepts.find((c) => c.id === problem.conceptIds[0]);
        const event = concept?.events.find((e) => e.attemptId === id);
        if (event) syncPayloads.push({ attemptRecord, event });
      }
      if (partialCount > 0) {
        // 계획 연결만 실패한 부분 저장: recorded로 확정하지 않고(재시도 가능) 실제 상태를 안내한다.
        // Attempt/ReviewEvent는 이미 저장되어 있고 재시도는 멱등하므로 중복 생성되지 않는다.
        setError(
          `일부 문항(${partialCount}건)의 학습 계획 연결 저장이 완료되지 않았습니다. 다시 시도하면 누락된 계획 연결만 복구됩니다. 평가 결과는 보존됩니다.`
        );
        return;
      }
      // Verify server persistence BEFORE confirming 'recorded'. A dropped response
      // is recovered by re-reading (submit_attempt is idempotent by attempt id).
      const results = await Promise.all(
        syncPayloads.map(({ attemptRecord, event }) =>
          submitExamAttemptOnServer(attemptRecord, event).catch(() => ({ ok: false as const, code: 'error' as const }))
        )
      );
      if (!isOpValid(token, targetUserId, targetSession.id)) return;
      const failed = results.filter((r) => !r.ok && r.code !== 'not_configured').length;
      if (failed > 0) {
        setSaveState('error');
        setFailedSaveOp({ kind: 'record_attempts' });
        setSaveMessage('일부 풀이가 서버에 저장되지 않아 기록 완료를 보류했습니다. 다시 시도하면 누락분만 저장됩니다.');
        setError('서버 저장이 완료되지 않아 기록 완료로 확정하지 않았습니다. 다시 시도해 주세요.');
        return;
      }
      const recordedSession: MockExamSession = {
        ...targetSession,
        status: 'recorded',
        recordedAttemptIds: targetSession.problems
          .filter((p) => Boolean(targetSession.answers[p.id]?.trim() && targetSession.evaluations[p.id]))
          .map((p) => `att-exam-${targetSession.id}-${p.id}`),
      };
      await finalizeRecorded(recordedSession, token, targetUserId);
    } catch (cause) {
      if (isOpValid(token, targetUserId, targetSession.id)) {
        setError(cause instanceof Error ? cause.message : '학습 이력 저장에 실패했습니다.');
      }
    } finally {
      if (token === opTokenRef.current && userIdRef.current === targetUserId) {
        setBusy(false);
      }
    }
  };

  if (!isOpen) return null;
  const isPage = variant === 'page';
  const modalContent = (
    <div className={isPage ? "w-full max-w-5xl mx-auto my-3 bg-white border border-[#c8c2b5] rounded-xs shadow-sm min-h-[calc(100vh-140px)]" : "w-full max-w-4xl max-h-[94vh] overflow-y-auto bg-white border border-[#c8c2b5] shadow-xl"}>
      <header className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2"><Award className="w-4 h-4 text-[#c52828]" />{subject.name} · 혼합형 모의시험</h2>
        <button onClick={onClose} aria-label="닫기"><X className="w-5 h-5" /></button>
      </header>
      <div className="p-5 space-y-4 text-sm">
        {error && <p role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800">{error}</p>}
        {syncNotice && <p className="p-2 bg-[#faf8f4] border border-[#e2ded6] text-xs text-[#57544e]">{syncNotice}</p>}
        {saveState !== 'idle' && (
          <div
            role="status"
            className={`p-2 border text-xs flex flex-wrap items-center justify-between gap-2 ${
              saveState === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : saveState === 'conflict'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-[#faf8f4] border-[#e2ded6] text-[#57544e]'
            }`}
          >
            <span>
              {saveState === 'saving' && '서버에 저장 중...'}
              {saveState === 'saved' && '서버 저장 완료'}
              {saveState === 'error' && (saveMessage || '서버 저장에 실패했습니다.')}
              {saveState === 'conflict' && '서버 기록과 충돌했습니다.'}
            </span>
            {saveState === 'error' && resolveExamSaveRetry(failedSaveOp, session) && (
              <button
                type="button"
                onClick={() => {
                  const retry = resolveExamSaveRetry(failedSaveOp, sessionRef.current ?? session);
                  if (!retry) return;
                  const token = opTokenRef.current;
                  if (retry.kind === 'autosave') {
                    persistPending(retry.session, serverVersionRef.current);
                    enqueue(() => runAutosave(retry.session, token));
                  } else if (retry.kind === 'submit') {
                    persistPending(retry.session, serverVersionRef.current);
                    enqueueSubmitSession(retry.session);
                  } else if (retry.kind === 'grading') {
                    enqueue(() => runGrading(retry.session, retry.status, token));
                  } else if (retry.kind === 'record_attempts') {
                    void recordExam();
                  } else if (retry.kind === 'record_finalize') {
                    void finalizeRecorded(retry.session, token, userId);
                  }
                }}
                className="border border-red-300 bg-white px-2.5 py-1 font-bold text-red-900"
              >
                다시 저장 시도
              </button>
            )}
          </div>
        )}
        {pendingAvailable && (
          <div role="alert" className="p-3 bg-[#faf8f4] border border-[#e2ded6] text-xs space-y-2 text-[#57544e]">
            <p>
              {pendingReadFailed
                ? '이 기기의 미저장 답안을 읽지 못했습니다. 기존 데이터를 보호하기 위해 서버 답안을 덮어쓰지 않았습니다.'
                : '이 기기에 저장되지 않은 답안이 있습니다. 삭제하지 않고 별도로 보존 중입니다.'}
              {!pendingReadFailed && session && session.status !== 'in_progress'
                ? ' 제출·채점이 끝난 시험에는 적용할 수 없어 제출 답안과 구분해 보관합니다.'
                : !pendingReadFailed && pendingStale
                ? ' 서버 버전이 달라 자동 저장하지 않으며, 확인 후 복구할 수 있습니다.'
                : ''}
            </p>
            {pendingReadFailed ? (
              <button
                type="button"
                onClick={() => void resolveFromServer()}
                className="border border-[#c8c2b5] bg-white px-3 py-1 font-bold"
              >
                미저장 답안 다시 확인
              </button>
            ) : (
              session?.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={restorePending}
                  className="border border-[#c8c2b5] bg-white px-3 py-1 font-bold"
                >
                  {pendingStale ? '미저장 답안 복구 (서버 변경 확인)' : '미저장 답안 복구'}
                </button>
              )
            )}
          </div>
        )}
        {(otherTabPendings.length > 0 || otherTabReadError) && session && (
          <div role="region" aria-label="다른 탭의 미저장 답안" className="p-3 bg-[#faf8f4] border border-[#e2ded6] text-xs space-y-2 text-[#57544e]">
            {otherTabReadError && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-amber-800">
                <span>다른 탭의 미저장 답안을 확인하지 못했습니다({otherTabReadError}).</span>
                <button
                  type="button"
                  onClick={() => refreshOtherTabRecords(userId, session.id, tabIdRef.current || undefined)}
                  className="border border-amber-400 bg-white px-2.5 py-1 font-bold"
                >
                  다시 확인
                </button>
              </div>
            )}
            {otherTabPendings.length > 0 && (
              <>
                <p className="font-bold">다른 탭에서 입력 중이던 미저장 답안({otherTabPendings.length}건)이 별도로 보존되어 있습니다. 자동 병합·자동 삭제되지 않습니다.</p>
                <ul className="space-y-1">
                  {otherTabPendings.map((item, idx) => (
                    <li key={item.tabId || `other-${idx}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2ded6] pt-1">
                      <span>저장 시각: {item.savedAt ? new Date(item.savedAt).toLocaleString('ko-KR') : '이전 기록'}</span>
                      {session.status === 'in_progress' && (
                        <button
                          type="button"
                          onClick={() => applyOtherTabSnapshot(item, '다른 탭의 미저장 답안')}
                          className="border border-[#c8c2b5] bg-white px-2.5 py-1 font-bold"
                        >
                          이 탭으로 복구
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {(otherTabArchives.length > 0 || otherTabArchiveError) && session && (
          <div role="region" aria-label="다른 탭의 충돌 보관함" className="p-3 bg-[#faf8f4] border border-[#e2ded6] text-xs space-y-2 text-[#57544e]">
            {otherTabArchiveError && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-amber-800">
                <span>다른 탭의 충돌 보관함을 확인하지 못했습니다({otherTabArchiveError}).</span>
                <button
                  type="button"
                  onClick={() => refreshOtherTabRecords(userId, session.id, tabIdRef.current || undefined)}
                  className="border border-amber-400 bg-white px-2.5 py-1 font-bold"
                >
                  다시 확인
                </button>
              </div>
            )}
            {otherTabArchives.length > 0 && (
              <>
                <p className="font-bold">다른 탭 또는 추가 보존 사본({otherTabArchives.length}건)이 별도로 보관되어 있습니다.</p>
                <ul className="space-y-1">
                  {otherTabArchives.map((item, idx) => (
                    <li key={item.archiveId || item.tabId || `arch-${idx}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2ded6] pt-1">
                      <span>보관 시각: {item.savedAt ? new Date(item.savedAt).toLocaleString('ko-KR') : '이전 기록'}</span>
                      {session.status === 'in_progress' && (
                        <button
                          type="button"
                          onClick={() => applyOtherTabSnapshot(item, '보관된 다른 탭 답안')}
                          className="border border-[#c8c2b5] bg-white px-2.5 py-1 font-bold"
                        >
                          이 탭으로 복구
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {syncBlocked && (
          <div role="alert" className="p-3 bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
            <p>다른 기기에서 이 모의시험이 변경되어 자동 저장을 멈췄습니다. 서버 기록과 이 기기의 미저장 답안을 확인해 복구할 수 있습니다.</p>
            <button
              type="button"
              onClick={() => void resolveFromServer()}
              className="border border-amber-400 bg-white px-3 py-1 font-bold"
            >
              최신 서버 기록 불러오기 (미저장 답안 유지)
            </button>
          </div>
        )}
        {expiredConflict && serverSnapshot && session && (
          <div role="alert" className="p-3 bg-red-50 border border-red-300 text-red-900 text-xs space-y-2">
            <p className="font-bold">
              서버에 더 최신 답안이 있습니다. 비교 후 명시적으로 선택해야 하며, 단순 제출로는 서버 답안을 덮어쓰지 않습니다.
            </p>
            <ul className="space-y-1">
              {session.problems.map((p) => {
                const mine = session.answers[p.id]?.trim() || '미응답';
                const srv = serverSnapshot.answers[p.id]?.trim() || '미응답';
                const differ = mine !== srv;
                return (
                  <li key={p.id} className="border-t border-red-200 pt-1">
                    <strong>{p.title}</strong>
                    <div>내 만료 답안: {mine.slice(0, 60)}{mine.length > 60 ? '…' : ''}</div>
                    <div className={differ ? 'text-red-700' : ''}>
                      서버 답안: {srv.slice(0, 60)}{srv.length > 60 ? '…' : ''}{differ ? ' (다름)' : ' (동일)'}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={adoptServerSnapshot}
                className="border border-red-400 bg-white px-3 py-1 font-bold"
              >
                서버 답안 사용 (권장)
              </button>
              <button
                type="button"
                onClick={submitLocalExpiredAnswers}
                disabled={busy}
                className="bg-[#c52828] text-white px-3 py-1 font-bold disabled:opacity-50"
              >
                내 만료 답안으로 제출
              </button>
            </div>
          </div>
        )}
        {conflictArchive && session && (
          <div role="group" aria-label="보존된 로컬 답안" className="p-3 bg-slate-50 border border-slate-300 text-slate-900 text-xs space-y-2">
            <p className="font-bold">
              보존된 로컬 답안 (서버 선택 후에도 유지됩니다. 자동 병합·자동 저장·자동 삭제되지 않습니다.)
            </p>
            <ul className="space-y-1">
              {session.problems.map((p) => {
                const kept = conflictArchive.answers[p.id]?.trim() || '미응답';
                return (
                  <li key={p.id} className="border-t border-slate-200 pt-1">
                    <strong>{p.title}</strong>
                    <div>보존 답안: {kept.slice(0, 60)}{kept.length > 60 ? '…' : ''}</div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              {session.status === 'in_progress' && (
                <button
                  type="button"
                  onClick={restoreConflictArchive}
                  className="border border-slate-400 bg-white px-3 py-1 font-bold"
                >
                  이 답안으로 복구 선택
                </button>
              )}
              <button
                type="button"
                onClick={deleteConflictArchive}
                className="border border-slate-300 bg-white px-3 py-1"
              >
                보존 삭제
              </button>
            </div>
          </div>
        )}
        {resumeDecision === 'ask' ? (
          <div className="space-y-3" role="group" aria-label="모의시험 이어풀기 선택">
            <p className="text-[#57544e]">
              진행 중인 모의시험이 있습니다. 이어서 풀거나, 계획된 범위·유형·시간 설정으로 새로 시작할 수 있습니다.
            </p>
            {initialConfig?.planItemTitle && (
              <p className="text-xs text-[#827d73]">계획: {initialConfig.planItemTitle}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setResumeDecision('resume')} className="bg-[#191817] text-white px-4 py-2 font-bold">
                이어서 풀기
              </button>
              <button onClick={() => setResumeDecision('new')} className="border border-[#c8c2b5] px-4 py-2 font-bold">
                새 계획으로 시작
              </button>
            </div>
          </div>
        ) : (!session || session.status === 'recorded' || resumeDecision === 'new' ? <>
          {showScopeWarning && (
            <p role="alert" className="p-3 bg-amber-50 border border-amber-300 text-amber-900">
              계획에 지정된 개념 또는 문제 유형이 더 이상 유효하지 않아 시험을 시작할 수 없습니다. 아래에서 범위를 다시 선택해 주세요.
            </p>
          )}
          {requestedScopePartial && (
            <p role="alert" className="p-3 bg-amber-50 border border-amber-300 text-amber-900">
              계획에 지정된 일부 개념 또는 문제 유형이 더 이상 유효하지 않아 제외되었습니다. 시작 시 확인 후 진행합니다.
            </p>
          )}
          <p className="text-[#57544e]">과목의 승인 문제를 섞어 구성합니다. 신고·검토 중인 문항은 제외합니다.</p>
          <div><h3 className="font-semibold mb-2">시험 범위 · 개념 선택</h3><p className="text-xs text-[#606060]">과목 범위: {subject.scope || '별도 지정 없음'} · 아래 개념만 포함합니다.</p>
            <div className="grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto border p-2">{concepts.filter((c) => c.subjectId === subject.id).map((c) =>
              <label key={c.id} className="flex gap-2 items-center"><input type="checkbox" checked={conceptIds.includes(c.id)} onChange={() => setConceptIds(conceptIds.includes(c.id) ? conceptIds.filter((id) => id !== c.id) : [...conceptIds, c.id])} />{c.title} <span className="text-xs text-[#827d73]">{c.chapterRef}</span></label>)}</div>
          </div>
          <div><h3 className="font-semibold mb-2">문제 유형</h3><div className="flex flex-wrap gap-3">{availableTypes.map((type) => <label key={type} className="flex gap-1 items-center"><input type="checkbox" checked={types.includes(type)} onChange={() => setTypes(types.includes(type) ? types.filter((x) => x !== type) : [...types, type])} />{labels[type] || type}</label>)}</div></div>
          <div className="flex flex-wrap gap-4"><label>문항 수 <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className="border p-1 w-20 ml-1" /></label><label>제한 시간(분) <input type="number" min={5} max={180} value={minutes} onChange={(e) => setMinutes(Math.min(180, Math.max(5, Number(e.target.value) || 5)))} className="border p-1 w-20 ml-1" /></label></div>
          <p className="text-xs text-[#606060]">출제 가능: {selectMockExamProblems(subject, concepts, eligible, conceptIds, types, eligible.length).length}문항 · 여러 유형을 선택하면 혼합합니다.</p>
          <button onClick={startExam} disabled={busy || !conceptIds.length || !types.length || !eligible.length} className="bg-[#c52828] text-white px-4 py-2 font-bold disabled:opacity-40">{busy ? '저장 중...' : '모의시험 시작'}</button>
          {history.length > 0 && <section className="border-t pt-3"><h3 className="font-semibold">지난 모의시험</h3>{history.map((item) => <details key={item.id} className="border p-2 my-2 text-xs"><summary className="cursor-pointer">{new Date(item.createdAt).toLocaleString('ko-KR')} · {item.problems.length}문항 · AI 평가 평균 {getExamScore(item) ?? '미평가'}점</summary>
            {item.problems.map((p, i) => <div key={p.id} className="border-t mt-2 pt-2 space-y-1">
              <strong>{i + 1}. {p.title} · 버전 {p.version ?? 1}</strong>
              <div className="whitespace-pre-wrap"><AcademicMathView content={p.promptText} /></div>
              <p><strong>제출 풀이:</strong> {item.answers[p.id] || '미응답'}</p>
              <p><strong>방법 선택 이유:</strong> {item.isReasonNotApplicable?.[p.id] ? `[해당 없음] ${item.reasonNotApplicableJustification?.[p.id] || ''}` : (item.reasons?.[p.id] || '이유 서술 없음')}</p>
              <p><strong>풀이 점수:</strong> {item.evaluations[p.id]?.calculatedScore ?? 0}점 · {item.evaluations[p.id]?.feedback || '미응답'}</p>
              <p><strong>방법 선택 진단:</strong> {item.evaluations[p.id]?.methodSelectionDiagnosis?.summary ?? '이유 진단 없음 (8단계 이전 시험 기록)'}</p>
            </div>)}
          </details>)}</section>}
        </> : <>
          <div className="flex justify-between items-center gap-3 border-b pb-2"><strong>{session.status === 'in_progress' ? '진행 중' : session.status === 'submitted' ? '제출 완료 · 평가 대기' : '평가 완료'}</strong><span className="flex items-center gap-1 font-mono"><Clock className="w-4 h-4" />{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</span></div>
          <nav className="flex flex-wrap gap-2" aria-label="문항 이동">{session.problems.map((p, i) => <button key={p.id} onClick={() => setIndex(i)} className={`border px-2 py-1 ${index === i ? 'bg-[#191817] text-white' : ''}`}>{i + 1}{session.answers[p.id]?.trim() ? ' ✓' : ''}</button>)}</nav>
          {current && <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#827d73]">
              <span>문항 {index + 1}/{session.problems.length} · {labels[current.type]} · 권장 {current.timeStandardMinutes}분 · 버전 {current.version ?? 1}</span>
              {current.needsSourceReview && (
                <span className="bg-amber-50 border border-amber-300 text-amber-800 px-1.5 py-0.5 rounded-2xs font-semibold">
                  ⚠️ 출처 검토 필요
                </span>
              )}
              {current.isOutdated && (
                <span className="bg-red-50 border border-red-300 text-red-800 px-1.5 py-0.5 rounded-2xs font-semibold">
                  구버전 자료 기반
                </span>
              )}
            </div>
            {current.needsSourceReview && (
              <div className="p-2 bg-amber-50 border border-amber-300 rounded-xs text-xs text-amber-900 flex items-center gap-1.5">
                <span>⚠️ 출처 검토 필요 안내: 이 문제의 근거 학습 자료 본문이 수정되었습니다. 최신 자료 내용을 참고하세요.</span>
              </div>
            )}
            {current.isOutdated && (
              <div className="p-2 bg-red-50 border border-red-300 rounded-xs text-xs text-red-900 flex items-center gap-1.5">
                <span>⚠️ 구버전 자료 기반 안내: 학습 자료 본문이 수정되어 출제 당시와 차이가 있을 수 있습니다.</span>
              </div>
            )}
            <h3 className="font-bold text-lg">{current.title}</h3><div className="whitespace-pre-wrap leading-relaxed"><AcademicMathView content={current.promptText} /></div>
            {current.mathFormula && <div className="p-2.5 bg-white border border-[#e2ded6] rounded-xs text-center overflow-x-auto"><AcademicMathView content={current.mathFormula} displayMode /></div>}
            {current.codeSnippet && <pre className="overflow-x-auto bg-[#191817] text-white p-2">{current.codeSnippet}</pre>}

            {/* Dual Input: Solution & Method Reason */}
            <div className="space-y-3">
              <label className="block font-semibold">
                1. 풀이 및 결론
                <textarea
                  className="block border border-[#c8c2b5] p-3 w-full min-h-36 mt-1 font-normal text-xs"
                  value={session.answers[current.id] || ''}
                  disabled={session.status !== 'in_progress'}
                  onChange={(e) => save(updateMockExamAnswer(session, current.id, e.target.value, Date.now()))}
                  placeholder="풀이 과정과 결론을 상세히 서술하세요."
                />
              </label>

              <div className="border border-[#ded6c8] bg-[#fcfbf9] p-3 rounded-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f1ede4] pb-1.5">
                  <span className="font-semibold text-xs text-[#191817] flex items-center gap-1">
                    <Compass className="w-3.5 h-3.5 text-indigo-700" />
                    <span>2. 방법 선택 이유 (WHY THIS METHOD)</span>
                  </span>
                  <label className="flex items-center gap-1 text-xs text-[#57544e] cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={session.status !== 'in_progress'}
                      checked={Boolean(session.isReasonNotApplicable?.[current.id])}
                      onChange={(e) => save({
                        ...session,
                        isReasonNotApplicable: {
                          ...session.isReasonNotApplicable,
                          [current.id]: e.target.checked,
                        },
                      })}
                    />
                    <span className="text-[11px]">방법 선택 &apos;해당 없음&apos;</span>
                  </label>
                </div>

                {session.isReasonNotApplicable?.[current.id] ? (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-xs space-y-1">
                    <span className="text-[11px] text-amber-900 block font-semibold flex items-center gap-1">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-700" />
                      <span>해당 없음 사유:</span>
                    </span>
                    <input
                      type="text"
                      disabled={session.status !== 'in_progress'}
                      value={session.reasonNotApplicableJustification?.[current.id] || ''}
                      onChange={(e) => save({
                        ...session,
                        reasonNotApplicableJustification: {
                          ...session.reasonNotApplicableJustification,
                          [current.id]: e.target.value,
                        },
                      })}
                      placeholder="예: 단순 정의 확인 및 단일 사칙연산 문항으로 별도 방법 선택이 필요하지 않음"
                      className="w-full p-2 text-xs border border-amber-300 bg-white"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-indigo-900 bg-indigo-50/70 p-2 rounded-xs border border-indigo-100 leading-relaxed">
                      {subject.domain === 'computer_science'
                        ? '💻 [코딩] 자료구조·알고리즘 선택 이유, 문제의 제약조건($N$, 복잡도)과의 부합성, 대안의 한계를 적어주세요.'
                        : '📐 [수학] 적용한 정리·공식의 선택 이유, 필요한 필수 전제조건, 다른 접근보다 적절한 이유를 적어주세요.'}
                    </p>
                    <textarea
                      className="block border border-[#c8c2b5] p-2.5 w-full min-h-24 font-normal text-xs bg-white"
                      value={session.reasons?.[current.id] || ''}
                      disabled={session.status !== 'in_progress'}
                      onChange={(e) => save({
                        ...session,
                        reasons: {
                          ...session.reasons,
                          [current.id]: e.target.value,
                        },
                      })}
                      placeholder={
                        subject.domain === 'computer_science'
                          ? '자료구조/알고리즘 선택 이유 및 시간/공간 복잡도 제약과의 부합성을 서술하세요.'
                          : '정리/공식 선택 이유, 전제조건 성립 여부, 다른 접근법 대비 적합성을 서술하세요.'
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            {session.status !== 'in_progress' && <div className="text-xs text-[#827d73]"><strong>모범 답안:</strong> <AcademicMathView content={current.modelAnswer} /></div>}

            {/* Graded Result View: Zone 1 (Solution Score) & Zone 2 (Method Reason Diagnosis) */}
            {session.evaluations[current.id] && (
              <div className="space-y-3 pt-2">
                {/* Zone 1: Solution Score */}
                <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 space-y-1.5 rounded-xs">
                  <div className="flex items-center justify-between border-b pb-1">
                    <strong>AI 풀이 채점: {session.evaluations[current.id].calculatedScore} / 100점</strong>
                    {session.evaluations[current.id].needsReview && (
                      <span className="text-xs text-amber-800 font-semibold">검토 필요</span>
                    )}
                  </div>
                  {session.evaluations[current.id].rubricResults.map((r) => (
                    <div key={r.criterionId} className="text-xs text-[#57544e]">
                      <span className="font-semibold text-[#191817]">{r.label}:</span> {r.score}/{r.maxScore}점 · {r.feedback || r.deductionReason}
                    </div>
                  ))}
                  <div className="text-xs text-[#191817] pt-1"><AcademicMathView content={session.evaluations[current.id].feedback} /></div>
                </div>

                {/* Zone 2: Method Selection Diagnosis */}
                <div className="bg-indigo-50/50 border border-indigo-200 p-3 space-y-2 rounded-xs">
                  <div className="flex items-center justify-between border-b border-indigo-200/80 pb-1">
                    <strong className="text-xs text-indigo-950 flex items-center gap-1 font-academic-serif">
                      <Compass className="w-3.5 h-3.5 text-indigo-700" />
                      <span>방법 선택 이유 진단 (독립 진단 영역)</span>
                    </strong>
                    <span className="text-[10.5px] font-mono text-indigo-800">
                      {session.evaluations[current.id]?.methodSelectionDiagnosis?.isApplicable ? '평가 적용' : '해당 없음'}
                    </span>
                  </div>

                  {session.evaluations[current.id]?.methodSelectionDiagnosis ? (
                    (() => {
                      const diag = session.evaluations[current.id]!.methodSelectionDiagnosis!;
                      return (
                        <div className="space-y-2">
                          <p className="text-[11.5px] text-indigo-900 leading-relaxed">
                            {diag.summary}
                          </p>

                          <div className="grid sm:grid-cols-2 gap-2 text-xs">
                            {diag.criteria.map((crit) => (
                              <div key={crit.key} className="bg-white p-2 border border-indigo-100 rounded-2xs space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-[#191817] text-[11px]">{crit.label}</span>
                                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-2xs bg-indigo-100 text-indigo-900">
                                    {METHOD_REASON_RATING_LABELS[crit.rating] || crit.rating}
                                  </span>
                                </div>
                                <p className="text-[10.5px] text-[#57544e] line-clamp-2">근거: &ldquo;{crit.evidence}&rdquo;</p>
                                <p className="text-[10.5px] text-[#191817]">{crit.feedback}</p>
                              </div>
                            ))}
                          </div>

                          {(diag.suggestedImprovements?.length ?? 0) > 0 && (
                            <div className="text-[11px] text-[#2e2c29] bg-white p-2 border border-indigo-100 rounded-2xs">
                              <strong className="text-indigo-900">✍️ 보완 제안: </strong>
                              {diag.suggestedImprovements.join(' ')}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-xs text-[#827d73]">이유 진단 없음 (8단계 이전 기록)</p>
                  )}
                  <p className="text-[10px] text-[#827d73] font-mono">
                    ※ 방법 선택 진단은 100점 루브릭 점수에 가감되지 않습니다.
                  </p>
                </div>
              </div>
            )}
          </section>}
          {session.status === 'in_progress' && <button onClick={submitExam} className="bg-[#c52828] text-white px-4 py-2">시험 제출</button>}
          {examOpenPolicy(session, deferExpiredSubmit) === 'expired_manual' && saveState !== 'saved' && expiredConflict && (
            <button
              type="button"
              onClick={() =>
                setSyncNotice('서버와 다른 답안이 있어 자동 제출하지 않습니다. 위 비교 영역에서 "서버 답안 사용" 또는 "내 만료 답안으로 제출"을 선택해 주세요.')
              }
              disabled={busy}
              className="bg-amber-700 text-white px-4 py-2 disabled:opacity-50"
            >
              제출 보류 · 서버 답안과 비교 필요
            </button>
          )}
          {examOpenPolicy(session, deferExpiredSubmit) === 'expired_manual' && saveState !== 'saved' && !expiredConflict && (
            <button
              type="button"
              onClick={() => {
                // Real plan state: blocked while a conflict is unresolved OR
                // the server snapshot is already terminal (adopt it instead).
                const decision = decideExpiredSubmit(
                  {
                    serverTerminal: serverSnapshot ? serverSnapshot.status !== 'in_progress' : false,
                    conflict: expiredConflict,
                  },
                  serverVersionRef.current
                );
                if (decision.action !== 'submit') return;
                persistPending(session, decision.expectedVersion);
                enqueueSubmitSession(session);
              }}
              disabled={busy}
              className="bg-[#c52828] text-white px-4 py-2 disabled:opacity-50"
            >
              저장된 답안으로 제출
            </button>
          )}
          {session.status === 'submitted' && <button onClick={gradeExam} disabled={busy || Boolean(blocked.length)} className="bg-[#191817] text-white px-4 py-2 disabled:opacity-50">{busy ? 'AI 평가 중...' : '답안 평가 (미응답 0점)'}</button>}
          {session.status === 'graded' && <div className="border-t pt-3 space-y-3"><h3 className="font-bold">결과: {getExamScore(session)}점 (문항 평균)</h3><p className="text-xs text-[#606060]">미응답은 0점으로 합산하며 풀이 이력은 만들지 않습니다. 코딩 답안은 실행하지 않는 AI 정적 평가입니다.</p><button onClick={recordExam} disabled={Boolean(blocked.length)} className="bg-[#191817] text-white px-4 py-2 disabled:opacity-50">결과 확인 및 학습 이력 확정</button></div>}
          {blocked.length > 0 && <p className="text-sm text-red-700">품질 검토 상태로 바뀐 문항 {blocked.length}개가 있습니다. 평가·기록을 보류합니다.</p>}
        </>)}
      </div>
    </div>
  );

  return isPage ? (
    <div role="region" aria-label="혼합형 모의시험 전용 작업 화면">
      {modalContent}
    </div>
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50" role="dialog" aria-modal="true" aria-label="혼합형 모의시험">
      {modalContent}
    </div>
  );
}
