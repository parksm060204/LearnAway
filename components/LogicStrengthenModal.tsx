'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Attempt,
  Concept,
  EvaluationResult,
  LogicQuestionSet,
  LogicStrengthenSession,
  Problem,
  ProblemDraft,
  RechallengeReservation,
  RubricCriterion,
  Subject,
  METHOD_REASON_RATING_LABELS,
} from '../lib/types';
import { AcademicMathView } from './AcademicMathView';
import {
  getActiveLogicSessionId,
  loadLogicSessionsForAttempt,
  saveLogicSession,
  setActiveLogicSessionId,
} from '../lib/logicSession';
import { shouldApplyResponse } from '../lib/logicAsync';
import {
  AsyncTracker,
  beginAsyncRequest,
  createAsyncTracker,
  invalidateAsyncRequests,
  registerAsyncController,
  settleAsyncRequest,
} from '../lib/asyncRequestTracker';
import {
  previousApprovedTransfers,
  selectApprovedTransferProblem,
} from '../lib/transferValidation';
import { X, Sparkles, BrainCircuit, CheckCircle2, AlertTriangle, CalendarClock, Loader2, ShieldCheck, GitBranch, Trash2 } from 'lucide-react';

interface LogicStrengthenModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concept: Concept;
  problem: Problem;
  sourceAttempt: Attempt;
  recommendationDate?: string;
  reservations: RechallengeReservation[];
  approvedTransferProblems: Problem[];
  onRecordAssistedAttempt: (attempt: Attempt) => void;
  onReserveRechallenge: (reservation: RechallengeReservation) => boolean;
  onUpdateReservation: (reservationId: string, scheduledDate: string) => boolean;
  onCancelReservation: (reservationId: string) => boolean;
  onSaveTransferDraft: (draft: ProblemDraft) => boolean;
  onStartTransferProblem: (problem: Problem) => void;
}

function simpleHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = (h * 33) ^ value.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

function rubricHash(rubric: RubricCriterion[]): string {
  return rubric.map((c) => `${c.id}:${c.maxScore}`).join(',');
}

function sessionIdFor(attemptId: string, round: number): string {
  return round <= 1 ? `logic-${attemptId}` : `logic-${attemptId}-r${round}`;
}

function buildNewSession(
  subject: Subject,
  concept: Concept,
  problem: Problem,
  sourceAttempt: Attempt,
  round: number
): LogicStrengthenSession {
  const now = new Date().toISOString();
  return {
    id: sessionIdFor(sourceAttempt.id, round),
    subjectId: subject.id,
    conceptId: concept.id,
    problemId: problem.id,
    problemVersion: sourceAttempt.problemVersion ?? problem.version ?? 1,
    sourceAttemptId: sourceAttempt.id,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    problemTitleSnapshot: sourceAttempt.problemTitleSnapshot || problem.title,
    problemPromptSnapshot: sourceAttempt.problemPromptSnapshot || problem.promptText,
    modelAnswerSnapshot: sourceAttempt.modelAnswerSnapshot || problem.modelAnswer,
    problemFormulaSnapshot: problem.mathFormula,
    problemCodeSnapshot: problem.codeSnippet,
    problemConditionNoteSnapshot: problem.appliedConditionNote,
    rubricSnapshot: sourceAttempt.rubricSnapshot || problem.rubric,
    sourceMarkdownHash: problem.sourceMarkdownHash,
    sourceMaterials: problem.sourceMaterials,
    sessionRound: round,
    originalAnswer: sourceAttempt.answer,
    originalScore: sourceAttempt.calculatedScore,
    originalRubricResults: sourceAttempt.rubricResults,
    originalSolvingReason: sourceAttempt.solvingReason,
    originalIsReasonNotApplicable: sourceAttempt.isReasonNotApplicable,
    originalDiagnosisSummary: sourceAttempt.methodSelectionDiagnosis?.summary,
    questions: [],
    questionSetVersion: 1,
    questionSets: [],
    questionAnswers: {},
    revisedAnswer: '',
    transferDraftVersion: 1,
  };
}

function normalizeLoadedSession(session: LogicStrengthenSession): LogicStrengthenSession {
  const migrated: LogicStrengthenSession = {
    ...session,
    questionSetVersion: session.questionSetVersion ?? 1,
    questionSets: Array.isArray(session.questionSets) ? session.questionSets : [],
    sessionRound: session.sessionRound ?? 1,
    transferDraftVersion: session.transferDraftVersion ?? 1,
  };
  const currentHash = simpleHash(
    `${session.revisedAnswer.trim()}|${session.problemVersion}|${rubricHash(session.rubricSnapshot)}`
  );
  if (migrated.revisedEvaluation && migrated.revisedEvaluationInputHash !== currentHash) {
    migrated.revisedEvaluation = undefined;
    migrated.revisedEvaluatedAt = undefined;
    migrated.revisedEvaluatedAnswer = undefined;
    migrated.revisedEvaluationInputHash = undefined;
    if (migrated.status === 'revised_evaluated') migrated.status = 'questions_ready';
  }
  return migrated;
}

export function LogicStrengthenModal({
  isOpen,
  onClose,
  subject,
  concept,
  problem,
  sourceAttempt,
  recommendationDate,
  reservations,
  approvedTransferProblems,
  onRecordAssistedAttempt,
  onReserveRechallenge,
  onUpdateReservation,
  onCancelReservation,
  onSaveTransferDraft,
  onStartTransferProblem,
}: LogicStrengthenModalProps) {
  const [session, setSessionState] = useState<LogicStrengthenSession>(() => {
    const attemptId = sourceAttempt.id;
    const activeId = getActiveLogicSessionId(attemptId);
    const candidates = loadLogicSessionsForAttempt(attemptId);
    const version = sourceAttempt.problemVersion ?? problem.version ?? 1;
    const pick =
      (activeId ? candidates.find((s) => s.id === activeId) : undefined) ||
      candidates.find((s) => s.problemVersion === version) ||
      candidates[0];
    if (pick) return normalizeLoadedSession(pick);
    return buildNewSession(subject, concept, problem, sourceAttempt, 1);
  });
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const [activeSessionId, setActiveSessionId] = useState(session.id);
  const activeSessionIdRef = useRef(session.id);
  const questionsTrackerRef = useRef<AsyncTracker>(createAsyncTracker());
  const evalTrackerRef = useRef<AsyncTracker>(createAsyncTracker());
  const transferTrackerRef = useRef<AsyncTracker>(createAsyncTracker());

  const [sessionList, setSessionList] = useState<LogicStrengthenSession[]>(() =>
    loadLogicSessionsForAttempt(sourceAttempt.id)
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGeneratingTransfer, setIsGeneratingTransfer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [rechallengeDate, setRechallengeDate] = useState<string>(
    () => recommendationDate || new Date().toISOString().slice(0, 10)
  );
  const [transferDate, setTransferDate] = useState<string>(
    () => recommendationDate || new Date().toISOString().slice(0, 10)
  );

  useEffect(() => {
    mountedRef.current = true;
    const questionsTracker = questionsTrackerRef.current;
    const evalTracker = evalTrackerRef.current;
    const transferTracker = transferTrackerRef.current;
    return () => {
      mountedRef.current = false;
      // Invalidate any in-flight responses once the modal closes.
      invalidateAsyncRequests(questionsTracker);
      invalidateAsyncRequests(evalTracker);
      invalidateAsyncRequests(transferTracker);
    };
  }, []);

  if (!isOpen) return null;

  const isLocked = Boolean(session.revisedAttemptId);
  const isViewingOlderRound = session.id !== activeSessionId;
  const sessionReservations = reservations.filter(
    (r) => r.sourceLogicSessionId === session.id || r.sourceAttemptId === sourceAttempt.id
  );
  // Exact draft match only: a previously approved transfer from an earlier
  // generation must never be shown as the current draft's approval.
  const approvedTransferProblem = selectApprovedTransferProblem(
    approvedTransferProblems,
    session.transferDraftId
  );
  const previousApprovedTransferList = previousApprovedTransfers(
    approvedTransferProblems,
    session.transferDraftId
  );

  const persist = (next: LogicStrengthenSession) => {
    setSessionState(next);
    sessionRef.current = next;
    const ok = saveLogicSession(next);
    setSaveWarning(ok ? null : '세션 초안을 브라우저에 저장하지 못했습니다. 새로고침 시 입력이 사라질 수 있습니다.');
    setSessionList(loadLogicSessionsForAttempt(sourceAttempt.id));
  };
  // Always build from the LATEST state (never a stale render closure).
  const updateSession = (patch: Partial<LogicStrengthenSession>) =>
    persist({ ...sessionRef.current, ...patch, updatedAt: new Date().toISOString() });

  const currentEvalHash = (s: LogicStrengthenSession = sessionRef.current) =>
    simpleHash(`${s.revisedAnswer.trim()}|${s.problemVersion}|${rubricHash(s.rubricSnapshot)}`);
  const currentQuestionsHash = (s: LogicStrengthenSession = sessionRef.current) =>
    simpleHash(
      [
        s.problemTitleSnapshot,
        s.problemPromptSnapshot,
        s.modelAnswerSnapshot,
        rubricHash(s.rubricSnapshot),
        s.originalAnswer,
        s.originalSolvingReason || '',
        s.originalDiagnosisSummary || '',
      ].join('|')
    );

  const switchSession = (target: LogicStrengthenSession) => {
    invalidateAsyncRequests(questionsTrackerRef.current);
    invalidateAsyncRequests(evalTrackerRef.current);
    invalidateAsyncRequests(transferTrackerRef.current);
    setActiveLogicSessionId(sourceAttempt.id, target.id);
    activeSessionIdRef.current = target.id;
    setActiveSessionId(target.id);
    const normalized = normalizeLoadedSession(target);
    setSessionState(normalized);
    sessionRef.current = normalized;
    setError(null);
    setNotice(null);
    setIsGenerating(false);
    setIsEvaluating(false);
    setIsGeneratingTransfer(false);
  };

  // ---- Questions ----
  const handleGenerateQuestions = async (force: boolean) => {
    if (isGenerating || isLocked) return;
    const base = sessionRef.current;
    const inputHash = currentQuestionsHash(base);
    if (!force && base.questions.length > 0 && base.questionsInputHash === inputHash) {
      setNotice('동일한 입력의 질문이 이미 생성되어 재사용했습니다. 다시 만들려면 "질문 다시 생성"을 누르세요.');
      return;
    }
    const requestId = beginAsyncRequest(questionsTrackerRef.current);
    const controller = new AbortController();
    registerAsyncController(questionsTrackerRef.current, requestId, controller);
    const requestSessionId = base.id;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          subjectId: subject.id,
          domain: subject.domain || 'math_stats',
          problemTitle: base.problemTitleSnapshot,
          problemPrompt: base.problemPromptSnapshot,
          modelAnswer: base.modelAnswerSnapshot,
          rubric: base.rubricSnapshot,
          originalAnswer: base.originalAnswer,
          solvingReason: base.originalSolvingReason,
          diagnosisSummary: base.originalDiagnosisSummary,
        }),
      });
      const data = await res.json();
      const latest = sessionRef.current;
      if (
        !shouldApplyResponse({
          mounted: mountedRef.current,
          requestId,
          latestRequestId: questionsTrackerRef.current.generation,
          requestSessionId,
          activeSessionId: activeSessionIdRef.current,
          snapshotHash: inputHash,
          currentHash: currentQuestionsHash(latest),
        })
      ) {
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || '핵심 질문 생성에 실패했습니다.');
        return;
      }
      const newVersion = latest.questionSetVersion + 1;
      const versioned = (data.questions as LogicStrengthenSession['questions']).map((q) => ({
        ...q,
        id: `v${newVersion}-${q.id}`,
      }));
      const archived: LogicQuestionSet[] =
        latest.questions.length > 0
          ? [
              ...latest.questionSets,
              {
                version: latest.questionSetVersion,
                questions: latest.questions,
                answers: latest.questionAnswers,
                generatedAt: latest.questionsGeneratedAt || new Date().toISOString(),
                model: latest.questionsModel,
                inputHash: latest.questionsInputHash || '',
              },
            ]
          : latest.questionSets;
      updateSession({
        questions: versioned,
        questionAnswers: {},
        questionSetVersion: newVersion,
        questionSets: archived,
        questionsGeneratedAt: new Date().toISOString(),
        questionsModel: data.model,
        questionsInputHash: inputHash,
        status: latest.revisedEvaluation ? latest.status : 'questions_ready',
      });
      setNotice(`질문 세트 v${newVersion}이 생성되었습니다. 이전 질문과 응답은 이력으로 보존됩니다.`);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      if (!aborted && mountedRef.current && requestId === questionsTrackerRef.current.generation) {
        setError(`네트워크 오류: ${cause instanceof Error ? cause.message : '알 수 없는 오류'}`);
      }
    } finally {
      const { loading } = settleAsyncRequest(questionsTrackerRef.current, requestId);
      if (mountedRef.current) setIsGenerating(loading);
    }
  };

  // ---- Revised answer ----
  const changeRevisedAnswer = (value: string) => {
    if (isLocked) return;
    // Invalidate any in-flight evaluation/transfer immediately AND release the
    // loading state, so the button never stays disabled after an edit.
    invalidateAsyncRequests(evalTrackerRef.current);
    invalidateAsyncRequests(transferTrackerRef.current);
    setIsEvaluating(false);
    setIsGeneratingTransfer(false);
    const base = sessionRef.current;
    const patch: Partial<LogicStrengthenSession> = { revisedAnswer: value };
    if (base.revisedEvaluation && value.trim() !== (base.revisedEvaluatedAnswer || '').trim()) {
      patch.revisedEvaluation = undefined;
      patch.revisedEvaluatedAt = undefined;
      patch.revisedEvaluatedAnswer = undefined;
      patch.revisedEvaluationInputHash = undefined;
      if (base.status === 'revised_evaluated') patch.status = 'questions_ready';
    }
    updateSession(patch);
  };

  const handleEvaluateRevised = async () => {
    if (isEvaluating || isLocked) return;
    const base = sessionRef.current;
    const answer = base.revisedAnswer.trim();
    if (!answer) {
      setError('보완 답안을 작성한 뒤 평가를 요청해 주세요.');
      return;
    }
    // Snapshot the FULL evaluation input set (never mix in the current problem).
    const snapshot = {
      answer,
      inputHash: simpleHash(`${answer}|${base.problemVersion}|${rubricHash(base.rubricSnapshot)}`),
      sessionId: base.id,
    };
    const requestId = beginAsyncRequest(evalTrackerRef.current);
    const controller = new AbortController();
    registerAsyncController(evalTrackerRef.current, requestId, controller);
    setIsEvaluating(true);
    setError(null);
    try {
      const res = await fetch('/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          problemId: base.problemId,
          conceptId: base.conceptId,
          conceptIds: problem.conceptIds || [base.conceptId],
          subjectId: base.subjectId,
          domain: subject.domain || 'math_stats',
          problemTitle: base.problemTitleSnapshot,
          problemPrompt: base.problemPromptSnapshot,
          appliedConditionNote: base.problemConditionNoteSnapshot,
          mathFormula: base.problemFormulaSnapshot,
          codeSnippet: base.problemCodeSnapshot,
          modelAnswer: base.modelAnswerSnapshot,
          rubric: base.rubricSnapshot,
          userAnswer: snapshot.answer,
          revealedHintCount: 0,
          hints: [],
        }),
      });
      const data = await res.json();
      const latest = sessionRef.current;
      if (
        !shouldApplyResponse({
          mounted: mountedRef.current,
          requestId,
          latestRequestId: evalTrackerRef.current.generation,
          requestSessionId: snapshot.sessionId,
          activeSessionId: activeSessionIdRef.current,
          snapshotHash: snapshot.inputHash,
          currentHash: currentEvalHash(latest),
        })
      ) {
        return; // stale response: ignore and keep the newest input
      }
      if (!res.ok || !data.success) {
        setError(data.error || '보완 답안 평가에 실패했습니다.');
        return;
      }
      updateSession({
        revisedEvaluation: data.evaluation as EvaluationResult,
        revisedEvaluatedAt: new Date().toISOString(),
        revisedEvaluatedAnswer: snapshot.answer,
        revisedEvaluationInputHash: snapshot.inputHash,
        status: 'revised_evaluated',
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      if (!aborted && mountedRef.current && requestId === evalTrackerRef.current.generation) {
        setError(`네트워크 오류: ${cause instanceof Error ? cause.message : '알 수 없는 오류'}`);
      }
    } finally {
      const { loading } = settleAsyncRequest(evalTrackerRef.current, requestId);
      if (mountedRef.current) setIsEvaluating(loading);
    }
  };

  const handleConfirmRevision = () => {
    const base = sessionRef.current;
    if (base.revisedAttemptId) {
      setNotice('이미 확정된 보완 기록은 수정할 수 없습니다. 다시 보완하려면 새 회차를 시작하세요.');
      return;
    }
    if (!base.revisedEvaluation || base.revisedEvaluationInputHash !== currentEvalHash(base)) {
      setError('보완 답안이 평가 시점과 다릅니다. 다시 평가한 뒤 확정해 주세요.');
      return;
    }
    const evaluatedAnswer = base.revisedEvaluatedAnswer || base.revisedAnswer.trim();
    const attemptId = `att-logic-${base.id}`;
    const revisedAttempt: Attempt = {
      id: attemptId,
      problemId: base.problemId,
      conceptId: base.conceptId,
      conceptIds: problem.conceptIds || [base.conceptId],
      subjectId: base.subjectId,
      at: new Date().toISOString(),
      answer: evaluatedAnswer,
      confidence: sourceAttempt.confidence,
      errorType: base.revisedEvaluation.recommendedErrorType,
      hintCount: 0,
      reasoningNotes: '답안 논리 강화 보완 답안',
      calculatedScore: base.revisedEvaluation.calculatedScore,
      rubricResults: base.revisedEvaluation.rubricResults,
      evaluatorFeedback: base.revisedEvaluation.feedback,
      strengths: base.revisedEvaluation.strengths,
      criticalImprovements: base.revisedEvaluation.criticalImprovements,
      staticAnalysisNotice: base.revisedEvaluation.staticAnalysisNotice,
      needsReview: base.revisedEvaluation.needsReview,
      isAiEvaluated: base.revisedEvaluation.isAiEvaluated,
      modelAnswerSnapshot: base.modelAnswerSnapshot,
      problemTitleSnapshot: base.problemTitleSnapshot,
      problemPromptSnapshot: base.problemPromptSnapshot,
      problemVersion: base.problemVersion,
      rubricSnapshot: base.rubricSnapshot,
      methodSelectionDiagnosis: base.revisedEvaluation.methodSelectionDiagnosis,
      attemptOrigin: 'assisted_revision',
      logicSessionId: base.id,
      sourceAttemptId: sourceAttempt.id,
      helpUsage: 'assisted',
    };
    try {
      onRecordAssistedAttempt(revisedAttempt);
      updateSession({ revisedAttemptId: attemptId, status: 'completed' });
      setNotice('보완 답안이 원본과 연결된 별도 기록으로 저장되었습니다. (원본 점수/평가는 변경되지 않음)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보완 답안 저장에 실패했습니다.');
    }
  };

  const handleStartNewRound = () => {
    const existing = loadLogicSessionsForAttempt(sourceAttempt.id);
    const nextRound = existing.reduce((max, s) => Math.max(max, s.sessionRound || 1), 0) + 1;
    const fresh = buildNewSession(subject, concept, problem, sourceAttempt, nextRound);
    if (!saveLogicSession(fresh)) {
      setError('새 보완 회차를 저장하지 못했습니다. 기존 활성 회차를 유지합니다.');
      return;
    }
    setActiveLogicSessionId(sourceAttempt.id, fresh.id);
    switchSession(fresh);
    setNotice(`새 보완 회차(r${nextRound})를 시작했습니다. 이전 회차 기록은 그대로 보존됩니다.`);
  };

  // ---- Reservations ----
  const handleReserve = () => {
    if (!rechallengeDate) {
      setError('재도전 날짜를 선택해 주세요.');
      return;
    }
    if (subject.examAt && rechallengeDate > subject.examAt.slice(0, 10)) {
      if (!window.confirm('선택한 재도전 날짜가 시험일 이후입니다. 그래도 예약할까요?')) return;
    }
    const base = sessionRef.current;
    const reservation: RechallengeReservation = {
      id: `rr-${base.id}`,
      subjectId: subject.id,
      subjectName: subject.name,
      conceptId: concept.id,
      problemId: base.problemId,
      problemVersion: base.problemVersion,
      problemTitle: base.problemTitleSnapshot,
      problemType: problem.type,
      scheduledDate: rechallengeDate,
      estimatedMinutes: problem.timeStandardMinutes || 15,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      sourceLogicSessionId: base.id,
      sourceAttemptId: sourceAttempt.id,
    };
    if (!onReserveRechallenge(reservation)) {
      setError('재도전 예약 저장에 실패했습니다. 다시 시도해 주세요.');
      return;
    }
    setNotice('지연 재도전이 예약되었습니다. 점수·복습 회차는 변경되지 않습니다.');
  };

  // ---- Transfer problem ----
  const transferInputHashFor = (s: LogicStrengthenSession) =>
    simpleHash(
      [
        s.problemId,
        s.problemVersion,
        s.problemPromptSnapshot,
        s.originalAnswer,
        s.revisedEvaluatedAnswer || s.revisedAnswer,
        problem.type,
        problem.difficulty || 'advanced_college',
      ].join('|')
    );

  const handleGenerateTransfer = async (force: boolean) => {
    if (isGeneratingTransfer) return;
    const base = sessionRef.current;
    const inputHash = transferInputHashFor(base);
    if (!force && base.transferDraftId && base.transferInputHash === inputHash) {
      setNotice('동일한 입력의 전이 초안이 이미 생성되어 재사용했습니다. 다시 만들려면 "전이 문제 다시 생성"을 누르세요.');
      return;
    }
    const requestId = beginAsyncRequest(transferTrackerRef.current);
    const controller = new AbortController();
    registerAsyncController(transferTrackerRef.current, requestId, controller);
    const requestSessionId = base.id;
    setIsGeneratingTransfer(true);
    setError(null);
    setNotice(null);
    try {
      const vulnerable = base.originalRubricResults
        .filter((r) => r.isVulnerable || r.score < r.maxScore * 0.6)
        .map((r) => r.label);
      const res = await fetch('/api/transfer-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          subjectId: subject.id,
          domain: subject.domain || 'math_stats',
          problemTitle: base.problemTitleSnapshot,
          problemPrompt: base.problemPromptSnapshot,
          modelAnswer: base.modelAnswerSnapshot,
          rubric: base.rubricSnapshot,
          originalAnswer: base.originalAnswer,
          revisedAnswer: base.revisedEvaluatedAnswer || base.revisedAnswer,
          revisedAnswerConfirmed: Boolean(base.revisedAttemptId),
          vulnerableCriteria: vulnerable,
          concepts: [{ id: concept.id, title: concept.title }],
          problemType: problem.type,
          difficulty: problem.difficulty || 'advanced_college',
        }),
      });
      const data = await res.json();
      if (
        !shouldApplyResponse({
          mounted: mountedRef.current,
          requestId,
          latestRequestId: transferTrackerRef.current.generation,
          requestSessionId,
          activeSessionId: activeSessionIdRef.current,
          snapshotHash: inputHash,
          currentHash: transferInputHashFor(sessionRef.current),
        })
      ) {
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || '전이 문제 생성에 실패했습니다.');
        return;
      }
      const latest = sessionRef.current;
      const draftVersion = (latest.transferDraftVersion || 0) + 1;
      const now = new Date().toISOString();
      const draft: ProblemDraft = {
        id: `draft-transfer-${latest.id}-v${draftVersion}`,
        subjectId: subject.id,
        conceptIds: data.draft.conceptIds,
        conceptTitles: [concept.title],
        title: data.draft.title,
        type: data.draft.type,
        difficulty: data.draft.difficulty,
        categoryLabel: '전이 문제 (조건 변형)',
        categoryNumber: 0,
        promptText: data.draft.promptText,
        mathFormula: data.draft.mathFormula,
        codeSnippet: data.draft.codeSnippet,
        designIntent: data.draft.designIntent,
        appliedConditionNote: data.draft.transferChanges,
        sourceRefs: data.draft.sourceRefs,
        sourceEvidenceQuote: data.draft.evidenceQuote,
        sourceMarkdownHash: latest.sourceMarkdownHash,
        sourceMaterials: latest.sourceMaterials,
        timeStandardMinutes: data.draft.timeStandardMinutes,
        timeBreakdownDesc: `${data.draft.timeStandardMinutes}분 (조건 분석 및 전이 적용)`,
        coreEvaluationHighlight: data.draft.understandingFocus,
        itemCountDesc: '전이 문제 1문항',
        hints: data.draft.hints,
        modelAnswer: data.draft.modelAnswer,
        rubric: data.draft.rubric,
        status: data.draft.numericOnlySuspected ? 'needs_review' : 'draft',
        isApproved: false,
        isDemo: false,
        verificationStatus: {
          hasRequiredFields: true,
          isScore100: true,
          scoreSum: 100,
          hasConceptLink: true,
          // 실제 자료 확인 없이 isSourceVerified=true로 표시하지 않는다.
          isSourceVerified: false,
          note: [
            `변형 유형: ${data.draft.transferKind}`,
            `원래 조건: ${data.draft.originalCondition}`,
            `바뀐 조건: ${data.draft.newCondition}`,
            data.draft.answerEvidenceVerified ? '원답안 인용 확인됨' : '원답안 인용 없음(자료 근거 미확인)',
            data.draft.numericOnlySuspected ? '숫자/변수명만 바뀐 것으로 의심됨 — 검토 필요' : '',
          ]
            .filter(Boolean)
            .join(' | '),
        },
        createdAt: now,
        updatedAt: now,
        isTransfer: true,
        sourceProblemId: problem.id,
        logicSessionId: latest.id,
        transferChanges: data.draft.transferChanges,
        understandingFocus: data.draft.understandingFocus,
        transferKind: data.draft.transferKind,
        originalCondition: data.draft.originalCondition,
        newCondition: data.draft.newCondition,
      };
      if (!onSaveTransferDraft(draft)) {
        setError('전이 문제 초안 저장에 실패했습니다. 이전 초안은 유지됩니다.');
        return;
      }
      updateSession({
        transferDraftId: draft.id,
        transferDraftVersion: draftVersion,
        transferInputHash: inputHash,
      });
      setNotice('전이 문제 초안이 생성되었습니다. 검토·승인 전에는 학습 계획에 배정되지 않습니다.');
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      if (!aborted && mountedRef.current && requestId === transferTrackerRef.current.generation) {
        setError(`네트워크 오류: ${cause instanceof Error ? cause.message : '알 수 없는 오류'}`);
      }
    } finally {
      const { loading } = settleAsyncRequest(transferTrackerRef.current, requestId);
      if (mountedRef.current) setIsGeneratingTransfer(loading);
    }
  };

  const handleReserveTransfer = () => {
    if (!approvedTransferProblem) {
      setError('전이 문제를 먼저 승인해 주세요.');
      return;
    }
    const base = sessionRef.current;
    const reservation: RechallengeReservation = {
      id: `rr-transfer-${base.id}`,
      subjectId: subject.id,
      subjectName: subject.name,
      conceptId: concept.id,
      problemId: approvedTransferProblem.id,
      problemVersion: approvedTransferProblem.version ?? 1,
      problemTitle: approvedTransferProblem.title,
      problemType: approvedTransferProblem.type,
      scheduledDate: transferDate,
      estimatedMinutes: approvedTransferProblem.timeStandardMinutes || 20,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      sourceLogicSessionId: base.id,
      sourceAttemptId: sourceAttempt.id,
      isTransfer: true,
    };
    if (!onReserveRechallenge(reservation)) {
      setError('전이 문제 예약 저장에 실패했습니다. 다시 시도해 주세요.');
      return;
    }
    setNotice('전이 문제가 예약되었습니다. 점수·복습 회차는 변경되지 않습니다.');
  };

  const originalDiag = sourceAttempt.methodSelectionDiagnosis;
  const evaluatedMatches = Boolean(
    session.revisedEvaluation && session.revisedEvaluationInputHash === currentEvalHash(session)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto" role="dialog" aria-modal="true" aria-label="답안 논리 강화">
      <div className="w-full max-w-4xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[94vh]">
        <header className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-amber-400" />
            <h2 className="font-academic-serif text-sm font-bold">
              답안 논리 강화 · {concept.title} <span className="text-[11px] text-[#ded6c8]">(회차 r{session.sessionRound})</span>
            </h2>
          </div>
          <button onClick={onClose} aria-label="닫기" className="text-[#ded6c8] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          {isViewingOlderRound && (
            <p className="p-2.5 bg-[#f6f3eb] border border-[#ded6c8] text-[#57544e] text-xs">
              이전 회차를 보는 중입니다(읽기 전용). 최근 회차로 돌아가려면 아래 회차 목록에서 선택하세요.
            </p>
          )}
          {error && <p role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs">{error}</p>}
          {notice && <p role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">{notice}</p>}
          {saveWarning && <p role="alert" className="p-3 bg-amber-50 border border-amber-300 text-amber-900 text-xs">{saveWarning}</p>}

          {/* Session rounds */}
          <section className="bg-white border border-[#e2ded6] rounded-xs p-2.5 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-[#57544e]">보완 회차:</span>
              {sessionList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => switchSession(s)}
                  className={`px-2 py-0.5 rounded-2xs border ${
                    s.id === session.id ? 'bg-[#191817] text-white border-[#191817]' : 'bg-[#faf8f4] border-[#ded6c8] hover:bg-white'
                  }`}
                >
                  r{s.sessionRound} {s.revisedAttemptId ? '·확정' : s.status === 'draft' ? '·작성중' : ''}
                </button>
              ))}
              <button type="button" onClick={handleStartNewRound} className="px-2 py-0.5 text-xs border border-[#ded6c8] rounded-2xs hover:bg-[#faf8f4] font-semibold">
                + 새 회차
              </button>
            </div>
          </section>

          {/* Snapshot + original */}
          <section className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <strong className="text-[#191817]">{session.problemTitleSnapshot}</strong>
              <span className="font-academic-mono text-[#827d73]">v{session.problemVersion} · 원본 {session.originalScore}점</span>
            </div>
            <p className="whitespace-pre-wrap text-[#57544e] line-clamp-3">{session.problemPromptSnapshot}</p>
            <div className="grid sm:grid-cols-2 gap-2 pt-1">
              <div className="bg-white border border-[#e2ded6] p-2 rounded-2xs">
                <div className="font-semibold text-[#191817] mb-1">원답안</div>
                <p className="whitespace-pre-wrap text-[#57544e] max-h-40 overflow-y-auto">{session.originalAnswer}</p>
              </div>
              <div className="bg-white border border-[#e2ded6] p-2 rounded-2xs">
                <div className="font-semibold text-[#191817] mb-1">원본 루브릭 평가</div>
                <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                  {session.originalRubricResults.map((r) => (
                    <li key={r.criterionId} className="text-[11px] text-[#57544e]">
                      <strong>{r.label}</strong>: {r.score}/{r.maxScore}
                      {r.isVulnerable ? ' · 취약' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {originalDiag && (
              <div className="text-[11px] text-indigo-900 bg-indigo-50/70 border border-indigo-100 p-2 rounded-2xs">
                <strong>방법 선택 진단:</strong> <AcademicMathView inline content={originalDiag.summary} />
              </div>
            )}
          </section>

          {/* Step 1: questions */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#191817]">1. AI 핵심 질문 <span className="text-[11px] text-[#827d73]">(세트 v{session.questionSetVersion})</span></h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateQuestions(false)}
                  disabled={isGenerating || isLocked}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#191817] text-white rounded-xs font-bold disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                  <span>{session.questions.length ? '질문 불러오기(재사용)' : 'AI 핵심 질문 생성'}</span>
                </button>
                {session.questions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleGenerateQuestions(true)}
                    disabled={isGenerating || isLocked}
                    className="px-2.5 py-1.5 text-[11px] border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4] disabled:opacity-50"
                  >
                    질문 다시 생성
                  </button>
                )}
              </div>
            </div>
            {session.questions.length === 0 ? (
              <p className="text-xs text-[#827d73]">질문 생성 버튼을 눌러 원답안의 논리를 점검하는 질문을 받아보세요. 정답은 공개되지 않습니다.</p>
            ) : (
              <ul className="space-y-2">
                {session.questions.map((q, idx) => (
                  <li key={q.id} className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-2.5 space-y-1">
                    <div className="text-xs font-semibold text-[#191817]">Q{idx + 1}. <AcademicMathView inline content={q.question} /></div>
                    {q.linkedQuote && <div className="text-[11px] text-[#827d73]">근거: &ldquo;{q.linkedQuote}&rdquo;</div>}
                    {q.guidance && <div className="text-[11px] text-indigo-800">방향: <AcademicMathView inline content={q.guidance} /></div>}
                    <textarea
                      className="w-full border border-[#ded6c8] p-2 text-xs rounded-xs bg-white"
                      rows={2}
                      placeholder="이 질문에 대한 내 답변을 적어보세요. (점수에 반영되지 않습니다)"
                      value={session.questionAnswers[q.id] || ''}
                      disabled={isLocked}
                      onChange={(e) =>
                        updateSession({ questionAnswers: { ...sessionRef.current.questionAnswers, [q.id]: e.target.value } })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {session.questionSets.length > 0 && (
              <p className="text-[10.5px] text-[#827d73]">이전 질문 세트 {session.questionSets.length}개(응답 포함)가 이력으로 보존되어 있습니다.</p>
            )}
          </section>

          {/* Step 2: revised answer */}
          <section className="space-y-2">
            <h3 className="font-bold text-[#191817]">2. 보완 답안 작성</h3>
            <textarea
              className="w-full border border-[#ded6c8] p-3 text-xs rounded-xs min-h-32 disabled:bg-[#f4f1ea]"
              placeholder="원답안에서 보완할 점을 반영해 다시 작성하세요."
              value={session.revisedAnswer}
              disabled={isLocked}
              onChange={(e) => changeRevisedAnswer(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEvaluateRevised}
                disabled={isEvaluating || isLocked}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#c52828] text-white rounded-xs font-bold disabled:opacity-50"
              >
                {isEvaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{evaluatedMatches ? '보완 답안 재평가' : '보완 답안 평가'}</span>
              </button>
              <span className="text-[11px] text-[#827d73]">동일한 문제·루브릭 스냅샷으로 평가합니다. 답안을 수정하면 평가가 무효화됩니다.</span>
            </div>

            {session.revisedEvaluation && (
              <div className={`border p-3 rounded-xs text-xs space-y-1 ${evaluatedMatches ? 'bg-[#faf8f4] border-[#ded6c8]' : 'bg-amber-50 border-amber-300'}`}>
                <div className="font-semibold text-[#191817]">보완 답안 평가: {session.revisedEvaluation.calculatedScore}점</div>
                <div className="text-[#57544e] leading-relaxed"><AcademicMathView content={session.revisedEvaluation.feedback} /></div>
                {evaluatedMatches ? (
                  <div className="text-[11px] text-[#827d73]">원본 {session.originalScore}점 → 보완 {session.revisedEvaluation.calculatedScore}점 (동일 문제 참고용, 원본은 변경되지 않음)</div>
                ) : (
                  <div className="text-[11px] text-amber-900">평가 이후 답안이 변경되어 확정할 수 없습니다. 다시 평가해 주세요.</div>
                )}
              </div>
            )}
          </section>

          {/* Step 3: confirm + reserve */}
          <section className="border-t border-[#f1ede4] pt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmRevision}
                disabled={!evaluatedMatches || isLocked}
                className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#191817] text-white rounded-xs font-bold disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>{session.revisedAttemptId ? '보완 답안 저장됨' : '보완 답안 확정 저장 (별도 기록)'}</span>
              </button>
              <span className="text-[11px] text-[#827d73]">확정 전에는 새 학습 기록이 생성되지 않습니다.</span>
            </div>

            <div className="flex flex-wrap items-end gap-2 bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-2.5">
              <label className="text-xs text-[#57544e] flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-[#c52828]" />
                <span>나중에 독립적으로 다시 풀기 예약일</span>
                <input
                  type="date"
                  value={rechallengeDate}
                  onChange={(e) => setRechallengeDate(e.target.value)}
                  className="border border-[#ded6c8] p-1 text-xs rounded-xs"
                />
              </label>
              <button type="button" onClick={handleReserve} className="px-3 py-1.5 text-xs border border-[#ded6c8] rounded-xs hover:bg-white font-semibold">
                재도전 예약
              </button>
            </div>

            {sessionReservations.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-[#57544e]">이 세션의 예약</div>
                {sessionReservations.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 bg-white border border-[#e2ded6] rounded-2xs p-2 text-[11px]">
                    <span className={`font-semibold ${r.status === 'cancelled' ? 'text-[#827d73] line-through' : 'text-[#191817]'}`}>
                      {r.scheduledDate} · {r.problemTitle || '문제'} {r.isTransfer ? '(전이)' : '(재도전)'}
                    </span>
                    <span className="text-[#827d73]">[{r.status}]</span>
                    {r.status === 'scheduled' && (
                      <>
                        <input
                          type="date"
                          defaultValue={r.scheduledDate}
                          onChange={(e) => {
                            if (!onUpdateReservation(r.id, e.target.value)) setError('예약 날짜 변경 저장에 실패했습니다.');
                          }}
                          className="border border-[#ded6c8] p-0.5 text-[11px] rounded-2xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!onCancelReservation(r.id)) setError('예약 취소 저장에 실패했습니다.');
                            else setNotice('예약이 취소되었습니다.');
                          }}
                          className="flex items-center gap-0.5 text-[#c52828] hover:underline"
                        >
                          <Trash2 className="w-3 h-3" /> 취소
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {subject.examAt && rechallengeDate > subject.examAt.slice(0, 10) && (
              <p className="text-[11px] text-amber-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> 선택한 재도전 날짜가 시험일({subject.examAt.slice(0, 10)}) 이후입니다.
              </p>
            )}
          </section>

          {/* Step 4: transfer problem */}
          <section className="border-t border-[#f1ede4] pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#191817] flex items-center gap-1.5">
                <GitBranch className="w-4 h-4 text-indigo-600" /> 조건을 바꾼 문제로 확인하기 (전이 문제)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerateTransfer(false)}
                  disabled={isGeneratingTransfer}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-700 text-white rounded-xs font-bold disabled:opacity-50"
                >
                  {isGeneratingTransfer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                  <span>{session.transferDraftId ? '전이 초안 불러오기(재사용)' : '전이 문제 생성'}</span>
                </button>
                {session.transferDraftId && (
                  <button
                    type="button"
                    onClick={() => handleGenerateTransfer(true)}
                    disabled={isGeneratingTransfer}
                    className="px-2.5 py-1.5 text-[11px] border border-[#ded6c8] rounded-xs hover:bg-[#faf8f4] disabled:opacity-50"
                  >
                    전이 문제 다시 생성
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-[#827d73]">
              단순 숫자 변경이 아니라 조건·제약·반례·복잡도가 달라진 문제로 이해를 확인합니다. 생성된 초안은 승인 전까지 학습 계획에 배정되지 않습니다.
            </p>
            {session.transferDraftId && (
              <div className="bg-indigo-50/60 border border-indigo-200 rounded-xs p-2.5 text-[11px] space-y-1">
                <div className="font-semibold text-indigo-900">
                  전이 초안: {session.transferDraftId} (v{session.transferDraftVersion || 1})
                </div>
                {approvedTransferProblem ? (
                  <div className="flex flex-wrap items-end gap-2 pt-1">
                    <span className="text-emerald-800 font-semibold">승인됨 · v{approvedTransferProblem.version ?? 1}</span>
                    <button
                      type="button"
                      onClick={() => onStartTransferProblem(approvedTransferProblem)}
                      className="px-3 py-1.5 text-xs bg-[#191817] text-white rounded-xs font-bold"
                    >
                      지금 전이 문제 풀기
                    </button>
                    <label className="flex items-center gap-1.5">
                      예약일
                      <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="border border-[#ded6c8] p-0.5 text-[11px] rounded-2xs" />
                    </label>
                    <button type="button" onClick={handleReserveTransfer} className="px-2.5 py-1.5 text-xs border border-[#ded6c8] rounded-xs hover:bg-white font-semibold">
                      전이 문제 예약
                    </button>
                  </div>
                ) : (
                  <p className="text-indigo-900">아직 이 회차의 전이 문제가 승인되지 않았습니다. 문제 검토·승인 화면에서 승인하면 즉시 풀거나 예약할 수 있습니다.</p>
                )}
              </div>
            )}
            {previousApprovedTransferList.length > 0 && (
              <div className="border border-[#e2ded6] rounded-xs p-2 text-[11px] space-y-1">
                <div className="font-semibold text-[#57544e]">이전 생성 결과(참고용, 현재 초안과 무관)</div>
                {previousApprovedTransferList.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-[#827d73]">
                    <span className="line-clamp-1">v{p.version ?? 1} · {p.title}</span>
                    <span>승인됨</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {sourceAttempt.methodSelectionDiagnosis && (
            <p className="text-[10.5px] text-[#827d73] font-academic-mono">
              ※ 방법 선택 진단 등급: {sourceAttempt.methodSelectionDiagnosis.criteria.map((c) => `${c.label}:${METHOD_REASON_RATING_LABELS[c.rating]}`).join(' · ')}
            </p>
          )}
        </div>

        <footer className="bg-[#faf8f4] border-t border-[#ded6c8] px-5 py-3 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs bg-[#191817] text-white rounded-xs font-bold">닫기</button>
        </footer>
      </div>
    </div>
  );
}
