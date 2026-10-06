'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Attempt,
  Concept,
  EvaluationResult,
  MockExamSession,
  Problem,
  ProblemType,
  Subject,
  isProblemAvailableForPractice,
  METHOD_REASON_RATING_LABELS,
} from '../lib/types';
import { expireMockExam, getExamScore, loadMockExams, saveMockExam, selectMockExamProblems, updateMockExamAnswer } from '../lib/mockExam';
import { loadStoredSettings, recordAttemptAndUpdateConcept } from '../lib/storage';
import {
  autosaveMockExam,
  createMockExamOnServer,
  fetchMockExamFromServer,
  planReconcile,
  saveMockExamGradingOnServer,
  submitExamAttemptOnServer,
  submitMockExamOnServer,
} from '../lib/cloud/mockExamSync';
import {
  applyPendingAnswers,
  clearPendingExamAnswers,
  loadPendingExamAnswers,
  pendingAfterAutosave,
  savePendingExamAnswers,
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
  onExamRecorded: () => void;
}

const labels: Partial<Record<ProblemType, string>> = {
  essay_descriptive: '논술·서술', calc_derivation: '계산 유도', proof_counterexample: '증명·반례',
  error_spotting: '오류 검증', impl_descriptive: '구현 서술', algorithm_optimization: '알고리즘 최적화',
  complexity_proof: '복잡도 증명', debug_counterexample: '디버깅·반례',
};

export function MockExamModal({ isOpen, onClose, variant = 'modal', subject, concepts, problems, userId = '', initialConfig, onExamRecorded }: Props) {
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
    const stored = activeStoredSession();
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
  const [pendingAvailable, setPendingAvailable] = useState(false);
  const [pendingStale, setPendingStale] = useState(false);
  // Server-authoritative version guard for optimistic autosave/submit.
  const serverVersionRef = useRef(1);
  const autosaveTimerRef = useRef<number | null>(null);
  // Autosave/submit are serialized so an older request can never overwrite a
  // newer one, and a final submit always runs after pending autosaves.
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  // Bumped on unmount / account change so late responses never touch other UI.
  const opTokenRef = useRef(0);
  const sessionRef = useRef<MockExamSession | null>(session);

  const enqueue = (task: () => Promise<void>) => {
    syncChainRef.current = syncChainRef.current.then(task, task);
  };

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
  const persistPending = (target: MockExamSession, baseVersion: number): boolean => {
    if (!userId) return true;
    const ok = savePendingExamAnswers(userId, target, baseVersion);
    if (!ok) {
      setSyncNotice('미저장 답안을 이 기기에 보존하지 못했습니다. 창을 닫지 말고 다시 시도해 주세요.');
    }
    return ok;
  };

  const runAutosave = (target: MockExamSession, token: number) => {
    if (token !== opTokenRef.current) return Promise.resolve();
    setSaveState('saving');
    return autosaveMockExam(target, serverVersionRef.current).then((result) => {
      if (token !== opTokenRef.current) return;
      if (result.ok) {
        serverVersionRef.current = result.version;
        setSyncBlocked(false);
        setSaveState('saved');
        if (userId) {
          const current = sessionRef.current;
          if (pendingAfterAutosave(target, current) === 'keep-current' && current) {
            // Newer input arrived while this request was in flight: it is still
            // unsaved, so keep it pending instead of clearing it.
            savePendingExamAnswers(userId, current, result.version);
            setPendingAvailable(true);
          } else {
            clearPendingExamAnswers(userId, target.id);
            setPendingAvailable(false);
          }
        }
      } else if (result.code === 'stale' || result.code === 'locked') {
        // Preserve the LATEST input, never the older request's snapshot.
        persistPending(sessionRef.current ?? target, serverVersionRef.current);
        setPendingAvailable(true);
        setSyncBlocked(true);
        setSaveState('conflict');
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
      } else {
        // Preserve the LATEST input, never the older request's snapshot.
        persistPending(sessionRef.current ?? target, serverVersionRef.current);
        setPendingAvailable(true);
        setSaveState('error');
        setSaveMessage('서버 자동 저장에 실패했습니다. 답안은 이 기기에 보존되며 다시 시도할 수 있습니다.');
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
        setSyncBlocked(false);
        setSaveState('saved');
      } else if (result.code === 'stale' || result.code === 'locked') {
        setSyncBlocked(true);
        setSaveState('conflict');
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
      } else {
        setSaveState('error');
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
    autosaveTimerRef.current = window.setTimeout(() => {
      const token = opTokenRef.current;
      enqueue(() => runAutosave(sessionRef.current ?? target, token));
    }, 800);
  };

  // Persist local, then mirror to the server according to the exam phase.
  const save = (updated: MockExamSession) => {
    saveMockExam(updated);
    setSession(updated);
    const token = opTokenRef.current;
    if (updated.status === 'in_progress' && !syncBlocked) {
      // Preserve the edit BEFORE scheduling the debounced server save.
      persistPending(updated, serverVersionRef.current);
      scheduleAutosave(updated);
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

  // Keep the ref in sync for async callbacks without touching refs during render.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      opTokenRef.current += 1;
      flushAutosaveTimer();
    };
  }, []);

  // Account change: invalidate in-flight work so results don't leak to another UI.
  useEffect(() => {
    opTokenRef.current += 1;
  }, [userId]);

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
          if (userId && !savePendingExamAnswers(userId, submitted, serverVersionRef.current)) {
            setSyncNotice('미저장 답안을 이 기기에 보존하지 못했습니다. 창을 닫지 말고 다시 시도해 주세요.');
          }
          const token = opTokenRef.current;
          enqueue(async () => {
            if (token !== opTokenRef.current) return;
            const result = await submitMockExamOnServer(submitted, serverVersionRef.current);
            if (token !== opTokenRef.current) return;
            if (result.ok) {
              serverVersionRef.current = result.version;
              setSaveState('saved');
            } else if (result.code === 'stale' || result.code === 'locked') {
              if (userId) savePendingExamAnswers(userId, sessionRef.current ?? submitted, serverVersionRef.current);
              setPendingAvailable(true);
              setSyncBlocked(true);
              setSaveState('conflict');
            } else if (result.code !== 'not_configured') {
              if (userId) savePendingExamAnswers(userId, sessionRef.current ?? submitted, serverVersionRef.current);
              setPendingAvailable(true);
              setSaveState('error');
              setSaveMessage('제출을 서버에 저장하지 못했습니다. 다시 시도해 주세요.');
            }
          });
          return submitted;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, session?.status, session?.endsAt, userId]);

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
      const pending = userId ? loadPendingExamAnswers(userId, server.id) : null;
      const plan = planReconcile(local, server, result.version, pending);
      serverVersionRef.current = result.version;

      // Apply the server snapshot (answers + version + status + evaluations) as
      // one unit. Local answers are never merged on top of it.
      applySnapshot(server);

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
      if (plan.clearPending && userId) clearPendingExamAnswers(userId, server.id);
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
  }, [isOpen, session?.id, userId]);

  const resolveFromServer = async () => {
    const local = sessionRef.current;
    if (!local) return;
    const result = await fetchMockExamFromServer(local.id);
    if (!result.ok) {
      setSyncNotice('서버 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    // Apply the server snapshot; NEVER merge pending into it or delete pending.
    const pending = userId ? loadPendingExamAnswers(userId, local.id) : null;
    applySnapshot(result.session);
    serverVersionRef.current = result.version;
    setSyncBlocked(false);
    setSaveState('saved');
    if (pending) {
      setPendingAvailable(true);
      setSyncNotice(
        result.session.status === 'in_progress'
          ? '서버의 최신 기록을 불러왔습니다. 미저장 답안은 별도로 보존되어 복구할 수 있습니다.'
          : '서버에서 이미 제출되어 종료된 시험입니다. 미저장 답안은 제출 답안과 별도로 보존됩니다.'
      );
    } else {
      setPendingAvailable(false);
      setSyncNotice('서버의 최신 기록으로 동기화했습니다.');
    }
  };

  const restorePending = () => {
    const local = sessionRef.current;
    const pending = userId && local ? loadPendingExamAnswers(userId, local.id) : null;
    if (!local || !pending) return;
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
        if (userId) {
          const current = sessionRef.current;
          if (pendingAfterAutosave(submitted, current) === 'keep-current' && current) {
            savePendingExamAnswers(userId, current, result.version);
            setPendingAvailable(true);
          } else {
            clearPendingExamAnswers(userId, submitted.id);
            setPendingAvailable(false);
          }
        }
      } else if (result.code === 'stale' || result.code === 'locked') {
        persistPending(sessionRef.current ?? submitted, serverVersionRef.current);
        setPendingAvailable(true);
        setSyncBlocked(true);
        setSaveState('conflict');
      } else if (result.code === 'not_configured') {
        setSaveState('idle');
      } else {
        persistPending(sessionRef.current ?? submitted, serverVersionRef.current);
        setPendingAvailable(true);
        setSaveState('error');
        setSaveMessage('제출을 서버에 저장하지 못했습니다. 로컬에 보존되며 다시 시도할 수 있습니다.');
      }
    });
  };

  const gradeExam = async () => {
    if (!session || session.status !== 'submitted' || busy || blocked.length) return;
    setBusy(true); setError('');
    const evaluations = { ...session.evaluations };
    try {
      for (const problem of session.problems) {
        const answer = session.answers[problem.id]?.trim();
        if (!answer || evaluations[problem.id]) continue;

        const reason = session.reasons?.[problem.id]?.trim();
        const isNotApplicable = Boolean(session.isReasonNotApplicable?.[problem.id]);
        const reasonJustification = session.reasonNotApplicableJustification?.[problem.id]?.trim();

        const response = await fetch('/api/evaluate-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problemId: problem.id,
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
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(`문항 「${problem.title}」: ${data.error || '평가 실패'}`);
        evaluations[problem.id] = data.evaluation as EvaluationResult;
        // Persist each completed evaluation (server + local) so a failure midway
        // can be recovered without re-calling the paid AI.
        saveGradingProgress({ ...session, evaluations: { ...evaluations } });
      }
      save({ ...session, evaluations, status: 'graded' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '평가에 실패했습니다. 완료된 문항은 보존했습니다.'); }
    finally { setBusy(false); }
  };

  const recordExam = async () => {
    if (!session || session.status !== 'graded' || blocked.length || busy) return;
    setBusy(true);
    setError('');
    try {
    const settings = loadStoredSettings();
    let partialCount = 0;
    const serverSyncs: Array<Promise<{ ok: boolean; code?: string }>> = [];
    for (const problem of session.problems) {
      const answer = session.answers[problem.id]?.trim();
      const evaluation = session.evaluations[problem.id];
      if (!answer || !evaluation || !problem.conceptIds.length) continue;
      const id = `att-exam-${session.id}-${problem.id}`;
      // Always (re)record: the storage layer is idempotent and will recover an
      // Attempt whose review event was lost to a previous partial failure.

      const isNotApplicable = Boolean(session.isReasonNotApplicable?.[problem.id]);
      const reason = session.reasons?.[problem.id];
      const justification = session.reasonNotApplicableJustification?.[problem.id];

      const attemptRecord: Attempt = {
        id,
        mockExamSessionId: session.id,
        problemId: problem.id,
        conceptId: problem.conceptIds[0],
        conceptIds: [...problem.conceptIds],
        subjectId: subject.id,
        at: session.submittedAt || new Date().toISOString(),
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
      if (event) serverSyncs.push(submitExamAttemptOnServer(attemptRecord, event));
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
    const results = await Promise.all(serverSyncs);
    const failed = results.filter((r) => !r.ok && r.code !== 'not_configured').length;
    if (failed > 0) {
      setSaveState('error');
      setSaveMessage('일부 풀이가 서버에 저장되지 않아 기록 완료를 보류했습니다. 다시 시도하면 누락분만 저장됩니다.');
      setError('서버 저장이 완료되지 않아 기록 완료로 확정하지 않았습니다. 다시 시도해 주세요.');
      return;
    }
    save({
      ...session,
      status: 'recorded',
      recordedAttemptIds: session.problems
        .filter((p) => Boolean(session.answers[p.id]?.trim() && session.evaluations[p.id]))
        .map((p) => `att-exam-${session.id}-${p.id}`),
    });
    setSyncNotice('');
    onExamRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '학습 이력 저장에 실패했습니다.');
    } finally {
      setBusy(false);
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
          <p
            role="status"
            className={`p-2 border text-xs ${
              saveState === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : saveState === 'conflict'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-[#faf8f4] border-[#e2ded6] text-[#57544e]'
            }`}
          >
            {saveState === 'saving' && '서버에 저장 중...'}
            {saveState === 'saved' && '서버 저장 완료'}
            {saveState === 'error' && (saveMessage || '서버 저장에 실패했습니다.')}
            {saveState === 'conflict' && '서버 기록과 충돌했습니다.'}
          </p>
        )}
        {pendingAvailable && (
          <div role="alert" className="p-3 bg-[#faf8f4] border border-[#e2ded6] text-xs space-y-2 text-[#57544e]">
            <p>
              이 기기에 저장되지 않은 답안이 있습니다. 삭제하지 않고 별도로 보존 중입니다.
              {session && session.status !== 'in_progress'
                ? ' 제출·채점이 끝난 시험에는 적용할 수 없어 제출 답안과 구분해 보관합니다.'
                : pendingStale
                ? ' 서버 버전이 달라 자동 저장하지 않으며, 확인 후 복구할 수 있습니다.'
                : ''}
            </p>
            {session?.status === 'in_progress' && (
              <button
                type="button"
                onClick={restorePending}
                className="border border-[#c8c2b5] bg-white px-3 py-1 font-bold"
              >
                {pendingStale ? '미저장 답안 복구 (서버 변경 확인)' : '미저장 답안 복구'}
              </button>
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
