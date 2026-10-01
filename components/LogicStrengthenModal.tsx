'use client';

import React, { useState } from 'react';
import {
  Attempt,
  Concept,
  EvaluationResult,
  LogicStrengthenSession,
  Problem,
  RechallengeReservation,
  RubricCriterion,
  Subject,
  METHOD_REASON_RATING_LABELS,
} from '../lib/types';
import { getLogicSession, saveLogicSession } from '../lib/logicSession';
import { X, Sparkles, BrainCircuit, CheckCircle2, AlertTriangle, CalendarClock, Loader2, ShieldCheck } from 'lucide-react';

interface LogicStrengthenModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concept: Concept;
  problem: Problem;
  sourceAttempt: Attempt;
  recommendationDate?: string;
  onRecordAssistedAttempt: (attempt: Attempt) => void;
  onReserveRechallenge: (reservation: RechallengeReservation) => void;
}

function sessionIdFor(attemptId: string): string {
  return `logic-${attemptId}`;
}

function buildNewSession(
  subject: Subject,
  concept: Concept,
  problem: Problem,
  sourceAttempt: Attempt
): LogicStrengthenSession {
  const now = new Date().toISOString();
  return {
    id: sessionIdFor(sourceAttempt.id),
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
    rubricSnapshot: sourceAttempt.rubricSnapshot || problem.rubric,
    sourceMarkdownHash: problem.sourceMarkdownHash,
    sourceMaterials: problem.sourceMaterials,
    originalAnswer: sourceAttempt.answer,
    originalScore: sourceAttempt.calculatedScore,
    originalRubricResults: sourceAttempt.rubricResults,
    originalSolvingReason: sourceAttempt.solvingReason,
    originalIsReasonNotApplicable: sourceAttempt.isReasonNotApplicable,
    originalDiagnosisSummary: sourceAttempt.methodSelectionDiagnosis?.summary,
    questions: [],
    questionAnswers: {},
    revisedAnswer: '',
  };
}

export function LogicStrengthenModal({
  isOpen,
  onClose,
  subject,
  concept,
  problem,
  sourceAttempt,
  recommendationDate,
  onRecordAssistedAttempt,
  onReserveRechallenge,
}: LogicStrengthenModalProps) {
  const [session, setSession] = useState<LogicStrengthenSession>(() => {
    const existing = getLogicSession(sessionIdFor(sourceAttempt.id));
    if (existing && existing.problemVersion === (sourceAttempt.problemVersion ?? problem.version ?? 1)) {
      return existing;
    }
    return buildNewSession(subject, concept, problem, sourceAttempt);
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [rechallengeDate, setRechallengeDate] = useState<string>(
    () => recommendationDate || new Date().toISOString().slice(0, 10)
  );

  if (!isOpen) return null;

  const rubric: RubricCriterion[] = session.rubricSnapshot;

  const persist = (next: LogicStrengthenSession) => {
    setSession(next);
    const ok = saveLogicSession(next);
    setSaveWarning(ok ? null : '세션 초안을 브라우저에 저장하지 못했습니다. 새로고침 시 입력이 사라질 수 있습니다.');
  };

  const updateSession = (patch: Partial<LogicStrengthenSession>) =>
    persist({ ...session, ...patch, updatedAt: new Date().toISOString() });

  const handleGenerateQuestions = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/logic-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: subject.id,
          domain: subject.domain || 'math_stats',
          problemTitle: session.problemTitleSnapshot,
          problemPrompt: session.problemPromptSnapshot,
          modelAnswer: session.modelAnswerSnapshot,
          rubric,
          originalAnswer: session.originalAnswer,
          solvingReason: session.originalSolvingReason,
          diagnosisSummary: session.originalDiagnosisSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || '핵심 질문 생성에 실패했습니다.');
        return;
      }
      updateSession({
        questions: data.questions,
        questionsGeneratedAt: new Date().toISOString(),
        questionsModel: data.model,
        status: 'questions_ready',
      });
    } catch (cause) {
      setError(`네트워크 오류: ${cause instanceof Error ? cause.message : '알 수 없는 오류'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEvaluateRevised = async () => {
    if (isEvaluating) return;
    if (!session.revisedAnswer.trim()) {
      setError('보완 답안을 작성한 뒤 평가를 요청해 주세요.');
      return;
    }
    setIsEvaluating(true);
    setError(null);
    try {
      const res = await fetch('/api/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId: problem.id,
          conceptId: concept.id,
          conceptIds: problem.conceptIds || [concept.id],
          subjectId: subject.id,
          domain: subject.domain || 'math_stats',
          problemTitle: session.problemTitleSnapshot,
          problemPrompt: session.problemPromptSnapshot,
          appliedConditionNote: problem.appliedConditionNote,
          mathFormula: problem.mathFormula,
          codeSnippet: problem.codeSnippet,
          modelAnswer: session.modelAnswerSnapshot,
          rubric,
          userAnswer: session.revisedAnswer.trim(),
          revealedHintCount: 0,
          hints: [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || '보완 답안 평가에 실패했습니다.');
        return;
      }
      updateSession({
        revisedEvaluation: data.evaluation as EvaluationResult,
        revisedEvaluatedAt: new Date().toISOString(),
        status: 'revised_evaluated',
      });
    } catch (cause) {
      setError(`네트워크 오류: ${cause instanceof Error ? cause.message : '알 수 없는 오류'}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleConfirmRevision = () => {
    if (!session.revisedEvaluation) {
      setError('보완 답안을 먼저 평가해 주세요.');
      return;
    }
    if (session.revisedAttemptId) {
      setNotice('보완 답안은 이미 별도 기록으로 저장되었습니다.');
      return;
    }
    const attemptId = `att-logic-${session.id}`;
    const revisedAttempt: Attempt = {
      id: attemptId,
      problemId: problem.id,
      conceptId: concept.id,
      conceptIds: problem.conceptIds || [concept.id],
      subjectId: subject.id,
      at: new Date().toISOString(),
      answer: session.revisedAnswer.trim(),
      confidence: sourceAttempt.confidence,
      errorType: session.revisedEvaluation.recommendedErrorType,
      hintCount: 0,
      reasoningNotes: '답안 논리 강화 보완 답안',
      calculatedScore: session.revisedEvaluation.calculatedScore,
      rubricResults: session.revisedEvaluation.rubricResults,
      evaluatorFeedback: session.revisedEvaluation.feedback,
      strengths: session.revisedEvaluation.strengths,
      criticalImprovements: session.revisedEvaluation.criticalImprovements,
      staticAnalysisNotice: session.revisedEvaluation.staticAnalysisNotice,
      needsReview: session.revisedEvaluation.needsReview,
      isAiEvaluated: session.revisedEvaluation.isAiEvaluated,
      modelAnswerSnapshot: session.modelAnswerSnapshot,
      problemTitleSnapshot: session.problemTitleSnapshot,
      problemPromptSnapshot: session.problemPromptSnapshot,
      problemVersion: session.problemVersion,
      rubricSnapshot: rubric,
      methodSelectionDiagnosis: session.revisedEvaluation.methodSelectionDiagnosis,
      attemptOrigin: 'assisted_revision',
      logicSessionId: session.id,
      sourceAttemptId: sourceAttempt.id,
    };
    try {
      onRecordAssistedAttempt(revisedAttempt);
      updateSession({ revisedAttemptId: attemptId, status: 'completed' });
      setNotice('보완 답안이 원본과 연결된 별도 기록으로 저장되었습니다. (원본 점수/평가는 변경되지 않음)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보완 답안 저장에 실패했습니다.');
    }
  };

  const handleReserve = () => {
    if (!rechallengeDate) {
      setError('재도전 날짜를 선택해 주세요.');
      return;
    }
    if (subject.examAt) {
      const examDate = subject.examAt.slice(0, 10);
      if (rechallengeDate > examDate) {
        if (!window.confirm('선택한 재도전 날짜가 시험일 이후입니다. 그래도 예약할까요?')) return;
      }
    }
    const reservation: RechallengeReservation = {
      id: `rr-${session.id}`,
      subjectId: subject.id,
      subjectName: subject.name,
      conceptId: concept.id,
      problemId: problem.id,
      problemVersion: session.problemVersion,
      problemTitle: session.problemTitleSnapshot,
      problemType: problem.type,
      scheduledDate: rechallengeDate,
      estimatedMinutes: problem.timeStandardMinutes || 15,
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      sourceLogicSessionId: session.id,
      sourceAttemptId: sourceAttempt.id,
    };
    onReserveRechallenge(reservation);
    setNotice('지연 재도전이 예약되었습니다. 점수·복습 회차는 변경되지 않습니다.');
  };

  const originalDiag = sourceAttempt.methodSelectionDiagnosis;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto" role="dialog" aria-modal="true" aria-label="답안 논리 강화">
      <div className="w-full max-w-4xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[94vh]">
        <header className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-amber-400" />
            <h2 className="font-academic-serif text-sm font-bold">답안 논리 강화 · {concept.title}</h2>
          </div>
          <button onClick={onClose} aria-label="닫기" className="text-[#ded6c8] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          {error && <p role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs">{error}</p>}
          {notice && <p role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">{notice}</p>}
          {saveWarning && <p role="alert" className="p-3 bg-amber-50 border border-amber-300 text-amber-900 text-xs">{saveWarning}</p>}

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
                <strong>방법 선택 진단:</strong> {originalDiag.summary}
              </div>
            )}
          </section>

          {/* Step 1: questions */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#191817]">1. AI 핵심 질문</h3>
              <button
                type="button"
                onClick={handleGenerateQuestions}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#191817] text-white rounded-xs font-bold disabled:opacity-50"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                <span>{session.questions.length ? '질문 다시 생성' : 'AI 핵심 질문 생성'}</span>
              </button>
            </div>
            {session.questions.length === 0 ? (
              <p className="text-xs text-[#827d73]">질문 생성 버튼을 눌러 원답안의 논리를 점검하는 질문을 받아보세요. 정답은 공개되지 않습니다.</p>
            ) : (
              <ul className="space-y-2">
                {session.questions.map((q, idx) => (
                  <li key={q.id} className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-2.5 space-y-1">
                    <div className="text-xs font-semibold text-[#191817]">Q{idx + 1}. {q.question}</div>
                    {q.linkedQuote && <div className="text-[11px] text-[#827d73]">근거: &ldquo;{q.linkedQuote}&rdquo;</div>}
                    {q.guidance && <div className="text-[11px] text-indigo-800">방향: {q.guidance}</div>}
                    <textarea
                      className="w-full border border-[#ded6c8] p-2 text-xs rounded-xs bg-white"
                      rows={2}
                      placeholder="이 질문에 대한 내 답변을 적어보세요. (점수에 반영되지 않습니다)"
                      value={session.questionAnswers[q.id] || ''}
                      onChange={(e) =>
                        updateSession({ questionAnswers: { ...session.questionAnswers, [q.id]: e.target.value } })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Step 2: revised answer */}
          <section className="space-y-2">
            <h3 className="font-bold text-[#191817]">2. 보완 답안 작성</h3>
            <textarea
              className="w-full border border-[#ded6c8] p-3 text-xs rounded-xs min-h-32"
              placeholder="원답안에서 보완할 점을 반영해 다시 작성하세요."
              value={session.revisedAnswer}
              onChange={(e) => updateSession({ revisedAnswer: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEvaluateRevised}
                disabled={isEvaluating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#c52828] text-white rounded-xs font-bold disabled:opacity-50"
              >
                {isEvaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{session.revisedEvaluation ? '보완 답안 재평가' : '보완 답안 평가'}</span>
              </button>
              <span className="text-[11px] text-[#827d73]">동일한 문제·루브릭 스냅샷으로 평가합니다.</span>
            </div>

            {session.revisedEvaluation && (
              <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs text-xs space-y-1">
                <div className="font-semibold text-[#191817]">보완 답안 평가: {session.revisedEvaluation.calculatedScore}점</div>
                <p className="text-[#57544e]">{session.revisedEvaluation.feedback}</p>
                <div className="text-[11px] text-[#827d73]">원본 {session.originalScore}점 → 보완 {session.revisedEvaluation.calculatedScore}점 (참고용, 원본은 변경되지 않음)</div>
              </div>
            )}
          </section>

          {/* Step 3: confirm + reserve */}
          <section className="border-t border-[#f1ede4] pt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmRevision}
                disabled={!session.revisedEvaluation || Boolean(session.revisedAttemptId)}
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
              <button
                type="button"
                onClick={handleReserve}
                className="px-3 py-1.5 text-xs border border-[#ded6c8] rounded-xs hover:bg-white font-semibold"
              >
                재도전 예약
              </button>
              <span className="text-[11px] text-[#827d73]">예약만으로는 점수·복습 회차가 바뀌지 않습니다.</span>
            </div>
            {subject.examAt && rechallengeDate > subject.examAt.slice(0, 10) && (
              <p className="text-[11px] text-amber-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> 선택한 재도전 날짜가 시험일({subject.examAt.slice(0, 10)}) 이후입니다.
              </p>
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
