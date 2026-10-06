'use client';

import React, { useState } from 'react';
import {
  Concept,
  Problem,
  Attempt,
  ErrorType,
  Subject,
  EvaluationResult,
  ProblemReportType,
  METHOD_REASON_RATING_LABELS,
} from '../lib/types';
import { MathFormula } from './MathFormula';
import { AcademicMathView } from './AcademicMathView';
import { ProblemReportModal } from './ProblemReportModal';
import { AttemptSaveStatus } from '../lib/storage';
import {
  X,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Send,
  Eye,
  EyeOff,
  Edit,
  Sparkles,
  BookOpen,
  RotateCcw,
  Loader2,
  HelpCircle,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Compass,
} from 'lucide-react';

// Snapshot of every input that the AI evaluation depends on. Recording is only
// allowed while the current inputs still match this snapshot.
interface EvaluationInputSnapshot {
  answer: string;
  solvingReason: string;
  isReasonNotApplicable: boolean;
  reasonNotApplicableJustification: string;
  hintCount: number;
}

interface ProblemSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'modal' | 'page';
  subject: Subject;
  concept: Concept;
  problem: Problem;
  onSubmitAttempt: (attempt: Attempt) => {
    partial: boolean;
    status: AttemptSaveStatus;
    attemptPersisted: boolean;
    eventPersisted: boolean;
    message?: string;
  };
  /** 지연 재도전 예약에서 시작한 경우 전달. 확정 시 예약을 완료 처리하고 독립 풀이로 표시한다. */
  rechallengeReservationId?: string;
  /** 실행한 학습 계획 항목 ID (추적용). */
  planItemId?: string;
  onOpenSourceModal: (sourceRef: string) => void;
  onReportProblem?: (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => { success: boolean; error?: string };
}

export function ProblemSessionModal({
  isOpen,
  onClose,
  variant = 'modal',
  subject,
  concept,
  problem,
  onSubmitAttempt,
  rechallengeReservationId,
  planItemId,
  onOpenSourceModal,
  onReportProblem,
}: ProblemSessionModalProps) {
  const [answerText, setAnswerText] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [revealedHints, setRevealedHints] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number>(3);
  const [errorType, setErrorType] = useState<ErrorType>('none');
  const [reasoningNotes, setReasoningNotes] = useState('');

  // Stage 8: Method selection reason input state
  const [solvingReason, setSolvingReason] = useState('');
  const [isReasonNotApplicable, setIsReasonNotApplicable] = useState(false);
  const [reasonNotApplicableJustification, setReasonNotApplicableJustification] = useState('');

  // Stage 4: AI Evaluation State
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [evaluatedSnapshot, setEvaluatedSnapshot] = useState<EvaluationInputSnapshot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitOutcome, setSubmitOutcome] = useState<{
    status: AttemptSaveStatus;
    attemptPersisted: boolean;
    eventPersisted: boolean;
    message: string;
  } | null>(null);
  const [isModelAnswerVisible, setIsModelAnswerVisible] = useState(false);
  const [wasModelAnswerRevealed, setWasModelAnswerRevealed] = useState(false);

  // Stage 6: Report State
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | undefined>();

  if (!isOpen) return null;

  const buildEvaluationSnapshot = (): EvaluationInputSnapshot => ({
    answer: answerText.trim(),
    solvingReason: isReasonNotApplicable ? '' : solvingReason.trim(),
    isReasonNotApplicable,
    reasonNotApplicableJustification: isReasonNotApplicable
      ? reasonNotApplicableJustification.trim()
      : '',
    hintCount: revealedHints.length,
  });

  // Any change to an evaluation input invalidates the previous diagnosis so a
  // stale diagnosis can never be attached to changed content.
  const invalidateEvaluation = () => {
    setEvaluationResult(null);
    setEvaluatedSnapshot(null);
    setEvaluationError(null);
    setCurrentAttemptId(undefined);
  };

  const handleRevealHint = (index: number) => {
    if (isEvaluating) return;
    if (!revealedHints.includes(index)) {
      setRevealedHints([...revealedHints, index]);
      invalidateEvaluation();
    }
  };

  const changeAnswer = (value: string) => {
    if (isEvaluating) return;
    setAnswerText(value);
    invalidateEvaluation();
  };

  const changeSolvingReason = (value: string) => {
    if (isEvaluating) return;
    setSolvingReason(value);
    invalidateEvaluation();
  };

  const changeReasonNotApplicable = (value: boolean) => {
    if (isEvaluating) return;
    setIsReasonNotApplicable(value);
    invalidateEvaluation();
  };

  const changeJustification = (value: string) => {
    if (isEvaluating) return;
    setReasonNotApplicableJustification(value);
    invalidateEvaluation();
  };

  const insertMathSnippet = (snippet: string) => {
    changeAnswer(answerText + snippet);
  };

  // Stage 4 & 8: Real AI Answer & Method Reason Evaluation Request
  const handleRequestEvaluation = async () => {
    if (isEvaluating) return;
    const trimmed = answerText.trim();
    if (!trimmed) {
      alert('답안을 작성한 후 평가를 요청해 주세요.');
      return;
    }

    if (isReasonNotApplicable && !reasonNotApplicableJustification.trim()) {
      alert('방법 선택 이유 [해당 없음]을 선택한 경우, 사유를 간단히 입력해 주세요.');
      return;
    }

    setIsEvaluating(true);
    setEvaluationError(null);

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
          problemTitle: problem.title,
          problemPrompt: problem.promptText,
          appliedConditionNote: problem.appliedConditionNote,
          mathFormula: problem.mathFormula,
          codeSnippet: problem.codeSnippet,
          modelAnswer: problem.modelAnswer,
          rubric: problem.rubric,
          userAnswer: trimmed,
          revealedHintCount: revealedHints.length,
          hints: revealedHints.map((index) => problem.hints[index]),
          // Stage 8 fields
          solvingReason: isReasonNotApplicable ? undefined : solvingReason.trim(),
          isReasonNotApplicable,
          reasonNotApplicableJustification: isReasonNotApplicable
            ? reasonNotApplicableJustification.trim()
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setEvaluationError(data.error || 'AI 평가 요청에 실패했습니다.');
        return;
      }

      const evalData: EvaluationResult = data.evaluation;
      setEvaluationResult(evalData);
      setEvaluatedSnapshot({
        answer: trimmed,
        solvingReason: isReasonNotApplicable ? '' : solvingReason.trim(),
        isReasonNotApplicable,
        reasonNotApplicableJustification: isReasonNotApplicable
          ? reasonNotApplicableJustification.trim()
          : '',
        hintCount: revealedHints.length,
      });
      setCurrentAttemptId(`att-${Date.now()}-${Math.random().toString(36).substring(7)}`);

      // Pre-fill error diagnosis with AI recommendation
      if (evalData.recommendedErrorType) {
        setErrorType(evalData.recommendedErrorType);
      }
    } catch (err) {
      setEvaluationError(`네트워크 연결 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Stage 4 & 8: Confirm and Commit Attempt
  const handleConfirmAndRecord = () => {
    const current = buildEvaluationSnapshot();
    const matchesSnapshot =
      evaluatedSnapshot !== null &&
      evaluatedSnapshot.answer === current.answer &&
      evaluatedSnapshot.solvingReason === current.solvingReason &&
      evaluatedSnapshot.isReasonNotApplicable === current.isReasonNotApplicable &&
      evaluatedSnapshot.reasonNotApplicableJustification === current.reasonNotApplicableJustification &&
      evaluatedSnapshot.hintCount === current.hintCount;

    if (!evaluationResult || isSubmitting || !matchesSnapshot) return;
    setIsSubmitting(true);

    const snapshot = evaluatedSnapshot;
    const attemptIdToUse = currentAttemptId || `att-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const newAttempt: Attempt = {
      id: attemptIdToUse,
      problemId: problem.id,
      conceptId: concept.id,
      conceptIds: problem.conceptIds || [concept.id],
      subjectId: subject.id,
      at: new Date().toISOString(),
      answer: snapshot.answer,
      confidence,
      errorType,
      hintCount: snapshot.hintCount,
      reasoningNotes,
      calculatedScore: evaluationResult.calculatedScore,
      rubricResults: evaluationResult.rubricResults,
      evaluatorFeedback: evaluationResult.feedback,
      strengths: evaluationResult.strengths,
      criticalImprovements: evaluationResult.criticalImprovements,
      staticAnalysisNotice: evaluationResult.staticAnalysisNotice,
      needsReview: evaluationResult.needsReview,
      isAiEvaluated: evaluationResult.isAiEvaluated,
      modelAnswerSnapshot: problem.modelAnswer,
      problemTitleSnapshot: problem.title,
      problemPromptSnapshot: problem.promptText,
      problemVersion: problem.version || 1,
      rubricSnapshot: problem.rubric,
      // Stage 8 fields — record the exact inputs that were evaluated
      solvingReason: snapshot.isReasonNotApplicable ? undefined : snapshot.solvingReason,
      isReasonNotApplicable: snapshot.isReasonNotApplicable,
      reasonNotApplicableJustification: snapshot.isReasonNotApplicable
        ? snapshot.reasonNotApplicableJustification
        : undefined,
      methodSelectionDiagnosis: evaluationResult.methodSelectionDiagnosis,
      attemptOrigin: rechallengeReservationId ? 'rechallenge' : 'independent',
      rechallengeReservationId,
      planItemId,
      modelAnswerRevealed: wasModelAnswerRevealed,
      helpUsage: wasModelAnswerRevealed
        ? 'model_answer'
        : snapshot.hintCount > 0
        ? 'hints'
        : 'independent',
    };

    try {
      const result = onSubmitAttempt(newAttempt);
      if (result.partial) {
        // Distinguish retryable save failures from linkage conflicts/missing targets.
        // Retry reuses the same Attempt ID and never re-calls the AI.
        setSubmitOutcome({
          status: result.status,
          attemptPersisted: result.attemptPersisted,
          eventPersisted: result.eventPersisted,
          message:
            result.message ||
            (result.status === 'retryable_failure'
              ? '풀이 기록 저장이 일부만 완료되었습니다. 같은 기록으로 다시 시도해 주세요.'
              : '계획/예약 연결을 확인해 주세요.'),
        });
        setIsSubmitting(false);
        return;
      }
      onClose();
    } catch (cause) {
      setEvaluationError(cause instanceof Error ? cause.message : '풀이 기록 저장에 실패했습니다.');
      setIsSubmitting(false);
    }
  };

  const isPage = variant === 'page';

  const modalBody = (
    <div className={isPage ? "w-full max-w-5xl mx-auto my-3 bg-white border border-[#c8c2b5] rounded-xs shadow-sm overflow-hidden flex flex-col min-h-[calc(100vh-140px)]" : "w-full max-w-4xl bg-white border border-[#c8c2b5] rounded-xs shadow-xl my-auto overflow-hidden flex flex-col max-h-[92vh]"}>
      {/* Modal Top Bar */}
        <div className="bg-[#191817] text-white px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#c52828] inline-block" />
            <span className="font-academic-mono text-xs text-[#ded6c8]">EXAMINATION PRACTICE</span>
            <span className="text-[#827d73]">|</span>
            <span className="text-xs sm:text-sm font-bold truncate max-w-[240px] sm:max-w-[400px]">
              {concept.title} [{problem.categoryLabel}]
            </span>
            <span className="text-[10px] font-academic-mono bg-[#33302b] text-[#ded6c8] px-1.5 py-0.5 rounded-2xs">
              v{problem.version || 1}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsReportModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-academic-mono bg-[#2b2723] hover:bg-[#3a3530] text-amber-300 border border-amber-500/40 rounded-xs transition-colors"
              title="문제 오류 신고"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">문제 오류 신고</span>
            </button>

            <button
              onClick={onClose}
              className="text-[#ded6c8] hover:text-white p-1 rounded-xs"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {/* Problem Statement Card */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-4 rounded-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-academic-mono text-xs font-bold text-[#c52828]">
                  {problem.categoryLabel} · 표준 소요: {problem.timeStandardMinutes}분
                </span>
                {problem.isDemo ? (
                  <span className="text-[10px] font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#827d73] px-1.5 py-0.5 rounded-2xs">
                    0단계 데모 문제
                  </span>
                ) : (
                  <span className="text-[10px] font-academic-mono bg-emerald-50 border border-emerald-300 text-emerald-800 px-1.5 py-0.5 rounded-2xs font-semibold">
                    AI 출제 승인 문제
                  </span>
                )}
                <span className="text-[10px] font-academic-mono bg-[#ded6c8]/60 text-[#57544e] px-1.5 py-0.5 rounded-2xs font-semibold">
                  v{problem.version || 1}
                </span>
                {problem.needsSourceReview && (
                  <span className="text-[10px] font-academic-mono bg-amber-50 border border-amber-300 text-amber-800 px-1.5 py-0.5 rounded-2xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                    출처 검토 필요
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsReportModalOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-academic-mono text-amber-700 hover:text-amber-900 underline"
                >
                  <ShieldAlert className="w-3 h-3 text-amber-600" />
                  <span>문제 오류 신고</span>
                </button>

                <button
                  onClick={() => onOpenSourceModal(problem.sourceRefs)}
                  className="flex items-center gap-1 text-[11px] font-academic-mono text-[#57544e] hover:text-[#c52828] underline"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>출처: {problem.sourceRefs}</span>
                </button>
              </div>
            </div>

            {problem.appliedConditionNote && (
              <div className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-xs text-[11.5px] text-amber-900 flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">AI 설계 응용 조건: </strong>
                  <span>{problem.appliedConditionNote}</span>
                </div>
              </div>
            )}

            {problem.isOutdated && (
              <div className="p-2.5 bg-amber-100/90 border border-amber-300 rounded-xs text-[11.5px] text-amber-950 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">이전 자료 기반 출제: </strong>
                  <span>원문 학습 자료 또는 Markdown이 수정되어 출제 당시의 원문 버전과 차이가 있을 수 있습니다.</span>
                </div>
              </div>
            )}

            {problem.needsSourceReview && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xs text-[11.5px] text-amber-950 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">출처 검토 필요 안내: </strong>
                  <span>이 문제의 근거 자료 본문이 수정되어 출처 검토가 필요한 상태입니다. 풀이 전 최신 본문 내용을 확인해 주세요.</span>
                </div>
              </div>
            )}

            <h3 className="text-base sm:text-[17px] font-bold text-[#191817] font-academic-serif leading-[1.75] korean-prose">
              <AcademicMathView content={problem.promptText} />
            </h3>

            {problem.mathFormula && (
              <div className="p-2.5 bg-white border border-[#e2ded6] rounded-xs text-center overflow-x-auto">
                <MathFormula math={problem.mathFormula} displayMode />
              </div>
            )}

            {problem.codeSnippet && (
              <pre className="p-3 bg-[#191817] text-[#ded6c8] text-xs font-mono rounded-xs overflow-x-auto leading-relaxed whitespace-pre-wrap">
                <code>{problem.codeSnippet}</code>
              </pre>
            )}

            {/* Rubric Criteria Glance */}
            <div className="pt-1 border-t border-[#ded6c8] flex flex-wrap items-center gap-1.5 text-[11px] font-academic-mono text-[#827d73]">
              <span className="font-bold text-[#57544e]">채점 기준:</span>
              {problem.rubric.map((r) => (
                <span
                  key={r.id}
                  className="px-1.5 py-0.5 bg-white border border-[#ded6c8] rounded-2xs text-[#191817]"
                >
                  {r.label} ({r.maxScore}점)
                </span>
              ))}
              <span className="text-[#c52828] font-bold">
                [총 {problem.rubric.reduce((s, r) => s + r.maxScore, 0)}점 만점]
              </span>
            </div>
          </div>

          {/* Progressive Hints Section */}
          {problem.hints && problem.hints.length > 0 && (
            <div className="border border-[#ded6c8] rounded-xs p-3.5 bg-white space-y-2">
              <div className="flex items-center justify-between text-xs font-academic-mono">
                <div className="flex items-center gap-1.5 text-[#57544e] font-bold">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  <span>단계별 서술 힌트 (열람 시 평가 기록에 반영됨)</span>
                </div>
                <span className="text-[11px] text-[#827d73]">
                  {revealedHints.length} / {problem.hints.length} 열람됨
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                {problem.hints.map((hint, idx) => {
                  const isRevealed = revealedHints.includes(idx);
                  return (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xs text-xs border transition-colors ${
                        isRevealed
                          ? 'bg-[#faf8f4] border-[#ded6c8] text-[#191817]'
                          : 'bg-[#f6f3eb] border-[#e2ded6] text-[#827d73]'
                      }`}
                    >
                      {isRevealed ? (
                        <div className="flex items-start gap-2">
                          <span className="font-academic-mono font-bold text-[#c52828] shrink-0">
                            [힌트 {idx + 1}]
                          </span>
                          <div className="korean-prose flex-1">
                            <AcademicMathView content={hint} />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="font-academic-mono text-[11px]">
                            힌트 {idx + 1}단계 (사고 확장 및 풀이 방향성)
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRevealHint(idx)}
                            className="px-2 py-0.5 bg-white border border-[#ded6c8] hover:border-[#191817] text-[#191817] text-[11px] rounded-xs font-academic-mono transition-colors"
                          >
                            열람하기
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model Answer (Spoiler Prevention: Hidden strictly before submission/evaluation) */}
          {!evaluationResult ? (
            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-xs text-[#827d73] font-academic-mono flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#827d73] shrink-0" />
              <span>출제자 모범 답안 및 AI 채점 결과는 풀이와 방법 선택 이유를 작성하여 제출한 후에 공개됩니다 (스포일러 방지).</span>
            </div>
          ) : (
            <div className="border border-[#ded6c8] rounded-xs bg-[#fcfbf9] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  const next = !isModelAnswerVisible;
                  setIsModelAnswerVisible(next);
                  if (next) setWasModelAnswerRevealed(true);
                }}
                className="w-full px-4 py-2 bg-[#f6f3eb] hover:bg-[#ede8dc] flex items-center justify-between text-xs transition-colors"
              >
                <div className="flex items-center gap-1.5 font-bold text-[#57544e]">
                  {isModelAnswerVisible ? (
                    <EyeOff className="w-3.5 h-3.5 text-[#827d73]" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-[#827d73]" />
                  )}
                  <span>출제자 모범 답안 열람</span>
                </div>
                <span className="text-[11px] font-academic-mono text-[#827d73]">
                  {isModelAnswerVisible ? '답안 접기' : '모범 답안 펼치기'}
                </span>
              </button>

              {isModelAnswerVisible && (
                <div className="p-4 border-t border-[#ded6c8] bg-white space-y-2 text-xs leading-relaxed text-[#191817] korean-prose whitespace-pre-wrap">
                  <div className="font-academic-mono text-[11px] text-[#827d73] font-semibold mb-1">
                    출제자 모범 답안 및 핵심 논증 단계:
                  </div>
                  <AcademicMathView content={problem.modelAnswer} />
                </div>
              )}
            </div>
          )}

          {/* Dual Input Workspace Area: 1. Solution & Conclusion, 2. Method Selection Reason */}
          <div className="space-y-4">
            {/* Input Section 1: Solution & Conclusion */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-academic-mono text-xs font-bold text-[#191817] bg-[#f4f1ea] px-2 py-0.5 border border-[#ded6c8] rounded-2xs">
                    1. 풀이 및 결론 (SOLUTION & CONCLUSION)
                  </span>
                </div>

                {/* Tab Selector */}
                <div className="flex items-center gap-1 bg-[#faf8f4] p-1 border border-[#ded6c8] rounded-xs">
                  <button
                    type="button"
                    onClick={() => setActiveTab('editor')}
                    className={`px-2.5 py-0.5 text-xs font-academic-mono rounded-xs transition-colors ${
                      activeTab === 'editor'
                        ? 'bg-white font-bold text-[#191817] shadow-2xs'
                        : 'text-[#827d73] hover:text-[#191817]'
                    }`}
                  >
                    에디터
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`px-2.5 py-0.5 text-xs font-academic-mono rounded-xs transition-colors ${
                      activeTab === 'preview'
                        ? 'bg-white font-bold text-[#191817] shadow-2xs'
                        : 'text-[#827d73] hover:text-[#191817]'
                    }`}
                  >
                    미리보기
                  </button>
                </div>
              </div>

              {/* Math / Quick Snippets */}
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-academic-mono text-[#827d73]">
                <span>단계별 증명 전개, 정리 적용, 또는 코드 알고리즘 논증을 상세히 서술하십시오.</span>
                <div className="hidden sm:flex items-center gap-1">
                  <span>빠른 기호:</span>
                  {['\\int', 'E[Y|X]', '\\iint', '\\le', '\\infty', 'f(x,y)'].map((snip) => (
                    <button
                      key={snip}
                      type="button"
                      disabled={isEvaluating}
                      onClick={() => insertMathSnippet(` $${snip}$ `)}
                      className="px-1.5 py-0.5 border border-[#ded6c8] bg-[#faf8f4] hover:bg-white text-[#191817] rounded-xs"
                    >
                      {snip}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'editor' ? (
                <textarea
                  value={answerText}
                  onChange={(e) => changeAnswer(e.target.value)}
                  disabled={isEvaluating}
                  placeholder="단계별 증명 전개, 정리 적용 정당화, 또는 코드 알고리즘 논증을 상세히 서술하십시오... (LaTeX 수식 기호 $...$ 사용 가능)"
                  rows={8}
                  className="w-full p-3.5 essay-answer border border-[#ded6c8] rounded-xs focus:border-[#191817] focus:ring-1 focus:ring-[#191817] resize-y bg-[#fefefe]"
                />
              ) : (
                <div className="w-full min-h-[180px] p-3.5 essay-answer border border-[#ded6c8] rounded-xs bg-[#faf8f4] overflow-y-auto whitespace-pre-wrap">
                  {answerText ? (
                    <div>{answerText}</div>
                  ) : (
                    <span className="text-[#827d73]">작성된 풀이가 없습니다.</span>
                  )}
                </div>
              )}
            </div>

            {/* Input Section 2: Method Selection Reason */}
            <div className="border border-[#ded6c8] bg-[#fcfbf9] p-3.5 rounded-xs space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#f1ede4] pb-2">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-indigo-700" />
                  <span className="font-academic-mono text-xs font-bold text-[#191817] bg-indigo-50 text-indigo-900 px-2 py-0.5 border border-indigo-200 rounded-2xs">
                    2. 방법 선택 이유 (WHY THIS METHOD)
                  </span>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-[#57544e] cursor-pointer hover:text-[#191817]">
                  <input
                    type="checkbox"
                    checked={isReasonNotApplicable}
                    onChange={(e) => changeReasonNotApplicable(e.target.checked)}
                    className="rounded-2xs border-[#ded6c8] text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-academic-mono text-[11.5px]">방법 선택 &apos;해당 없음&apos; (선택할 방법 자체가 없는 문항)</span>
                </label>
              </div>

              {isReasonNotApplicable ? (
                <div className="space-y-1.5 p-2.5 bg-amber-50/70 border border-amber-200 rounded-xs">
                  <div className="flex items-center gap-1 text-[11px] font-academic-mono text-amber-900 font-semibold">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-700" />
                    <span>해당 없음 사유 입력 (AI가 문제 유형을 보고 적합성을 판단합니다):</span>
                  </div>
                  <input
                    type="text"
                    value={reasonNotApplicableJustification}
                    onChange={(e) => changeJustification(e.target.value)}
                    placeholder="예: 단순 정의 확인 및 단일 사칙연산 문항으로 별도의 공식·정리·알고리즘 선택 과정이 필요하지 않음"
                    className="w-full p-2 text-xs border border-amber-300 rounded-xs bg-white text-[#191817] focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Domain-specific guidance banner */}
                  <div className="p-2.5 bg-indigo-50/60 border border-indigo-200/80 rounded-xs text-xs text-indigo-950 space-y-1">
                    <div className="font-bold text-[11px] font-academic-mono text-indigo-900 flex items-center gap-1">
                      <span>{subject.domain === 'computer_science' ? '💻 코딩 문제 방법 선택 안내' : '📐 수학·통계 문제 방법 선택 안내'}</span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-indigo-900">
                      {subject.domain === 'computer_science'
                        ? '선택한 자료구조·알고리즘의 선택 이유, 문제의 입력 크기와 제약조건(시간·공간 복잡도)과의 부합성, 대안적 접근법의 한계와 이 방식을 택한 이유를 서술해 주세요.'
                        : '적용한 정리·공식의 선택 이유, 정리에 필요한 필수 전제조건(예: 가측성, 미분가능성, 양의 정부호 등), 다른 접근 방식보다 이 정리가 더 적절한 이유를 서술해 주세요.'}
                    </p>
                  </div>

                  <textarea
                    value={solvingReason}
                    onChange={(e) => changeSolvingReason(e.target.value)}
                    placeholder={
                      subject.domain === 'computer_science'
                        ? '예: N<=10^5 제약으로 O(N^2) 완전탐색 대신 O(N log N) 우선순위 큐 다익스트라를 선택함. 음수 가중치가 없으므로 다익스트라 전제조건을 만족함.'
                        : '예: 피적분함수가 비음수이므로 톤넬리 정리를 적용하여 반복적분의 순서를 자유롭게 변경할 수 있음. 푸비니 정리와 달리 절대적분가능성을 사전에 보일 필요가 없어 더 적합함.'
                    }
                    rows={4}
                    className="w-full p-3 text-xs essay-answer border border-[#ded6c8] rounded-xs focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 resize-y bg-white"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Self-Reflection & Diagnostic Area (Always visible, pre-filled after evaluation) */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-3.5 rounded-xs space-y-3">
            <span className="text-xs font-academic-mono font-bold text-[#827d73] uppercase tracking-wider">
              풀이 자가 진단 및 메타인지 평가
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Confidence */}
              <div>
                <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                  답안 자가 확신도:
                </label>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setConfidence(star)}
                      className={`px-2.5 py-1 rounded-xs border text-xs font-academic-mono ${
                        confidence === star
                          ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                          : 'border-[#ded6c8] bg-white text-[#57544e]'
                      }`}
                    >
                      ★ {star}점 {star === 1 ? '(불안)' : star === 5 ? '(완전)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error Diagnostic Tag */}
              <div>
                <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                  오답/취약 원인 판별 (AI 추천 반영):
                </label>
                <select
                  value={errorType}
                  onChange={(e) => setErrorType(e.target.value as ErrorType)}
                  className="w-full p-1.5 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                >
                  <option value="none">정상 완제 (오류 없음)</option>
                  <option value="concept_confusion">개념 혼동 (정의 또는 정리 오해)</option>
                  <option value="condition_misinterpretation">조건 해석 오류 (문제 전제 누락)</option>
                  <option value="calc_or_impl_mistake">계산 / 구현 실수 (단순 전개 착오)</option>
                  <option value="method_selection_error">방법 선택 오류 (부적절한 증명 기법)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                풀이 이유 및 특이사항 메모 (선택사항):
              </label>
              <input
                type="text"
                value={reasoningNotes}
                onChange={(e) => setReasoningNotes(e.target.value)}
                placeholder="예: 푸비니 정리의 가측성 조건을 증명 서두에 밝히지 못함"
                className="w-full p-2 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
              />
            </div>
          </div>

          {/* Evaluation Trigger Button or Loading / Error / Results */}
          {!evaluationResult && !isEvaluating && !evaluationError && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleRequestEvaluation}
                disabled={!answerText.trim()}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all ${
                  answerText.trim()
                    ? 'bg-[#c52828] hover:bg-[#a82020] text-white cursor-pointer'
                    : 'bg-[#ded6c8] text-[#827d73] cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>답안 제출 및 AI 정밀 평가 요청 (EVALUATE SUBMISSION)</span>
              </button>
            </div>
          )}

          {/* Evaluating Loader State */}
          {isEvaluating && (
            <div className="p-6 border border-[#ded6c8] bg-[#faf8f4] rounded-xs text-center space-y-3">
              <Loader2 className="w-7 h-7 text-[#c52828] animate-spin mx-auto" />
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-[#191817] font-academic-serif">
                  AI 정밀 루브릭 평가 진행 중...
                </h4>
                <p className="text-xs text-[#57544e] korean-prose max-w-lg mx-auto">
                  수학적 동치성 검증, 전제조건 충족 여부, 부분 점수 판별 및 100점 배점표 기반 채점을 수행하고 있습니다. 잠시만 기다려 주십시오.
                </p>
              </div>
            </div>
          )}

          {/* Evaluation Error State (Transparent Failure, No Fake Records) */}
          {evaluationError && (
            <div className="p-4 border border-red-300 bg-red-50/80 rounded-xs space-y-3">
              <div className="flex items-start gap-2 text-red-900 text-xs">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong className="block font-bold">AI 평가 호출 실패</strong>
                  <p className="text-[11.5px] leading-relaxed text-red-800">{evaluationError}</p>
                  <p className="text-[10.5px] font-academic-mono text-red-700">
                    * 오류로 인해 가짜 점수나 임의의 풀이 이력은 생성되지 않았습니다.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRequestEvaluation}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#c52828] hover:bg-[#a82020] text-white text-xs font-bold rounded-xs transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>평가 다시 시도하기</span>
              </button>
            </div>
          )}

          {/* Full Stage 4 AI Evaluation Result Display */}
          {evaluationResult && (
            <div className="border border-[#c52828] bg-[#fef2f2]/30 p-4 sm:p-5 rounded-xs space-y-4 animate-fade-in">
              {/* Header with Score and Verification Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#fecaca] pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#c52828]" />
                  <span className="font-bold text-base text-[#191817] font-academic-serif">
                    AI 채점 결과: SCORE {evaluationResult.calculatedScore} / 100점
                  </span>
                  {evaluationResult.needsReview ? (
                    <span className="flex items-center gap-1 text-[11px] font-academic-mono bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-xs font-semibold">
                      <ShieldAlert className="w-3 h-3 text-amber-700" />
                      검토 필요 (Needs Review)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-academic-mono bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-xs font-semibold">
                      <ShieldCheck className="w-3 h-3 text-emerald-700" />
                      평가 완료
                    </span>
                  )}
                </div>

                <span className="text-[11px] font-academic-mono text-[#827d73]">
                  ENGINE: AI-RUBRIC EVALUATOR V4
                </span>
              </div>

              {/* Static Analysis Notice Banner (Requirement) */}
              {evaluationResult.staticAnalysisNotice && (
                <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded-xs text-[11px] text-amber-950 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">정적 분석 안내</strong>
                    <span>{evaluationResult.staticAnalysisNotice}</span>
                  </div>
                </div>
              )}

              {/* Strengths & Critical Improvements */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xs space-y-1">
                  <strong className="block font-bold text-emerald-950 font-academic-mono text-[11px]">
                    ✓ 잘한 점 (STRENGTHS):
                  </strong>
                  <p className="text-[11.5px] text-emerald-900 leading-relaxed">
                    {evaluationResult.strengths}
                  </p>
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xs space-y-1">
                  <strong className="block font-bold text-amber-950 font-academic-mono text-[11px]">
                    ▲ 가장 중요한 보완점 (IMPROVEMENTS):
                  </strong>
                  <p className="text-[11.5px] text-amber-900 leading-relaxed">
                    {evaluationResult.criticalImprovements}
                  </p>
                </div>
              </div>

              {/* Detailed Rubric Breakdown with Evidence, Deduction, Improvement */}
              <div className="space-y-2">
                <span className="text-[11px] font-academic-mono font-bold text-[#57544e] uppercase tracking-wider block">
                  루브릭 세부 채점 내역 (항목별 획득 점수 / 확인 근거 / 감점 사유):
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {evaluationResult.rubricResults.map((rubric) => (
                    <div
                      key={rubric.criterionId}
                      className={`p-3 rounded-xs border bg-white space-y-2 ${
                        rubric.isVulnerable ? 'border-[#c52828]' : 'border-[#ded6c8]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1 border-b border-[#f1ede4] pb-1.5">
                        <span
                          className={`font-bold leading-tight ${
                            rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'
                          }`}
                        >
                          {rubric.label}
                        </span>
                        <span
                          className={`font-academic-mono font-bold shrink-0 ${
                            rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'
                          }`}
                        >
                          {rubric.score} / {rubric.maxScore}점
                        </span>
                      </div>

                      {/* Evidence quote from user answer */}
                      {rubric.evidenceQuote && (
                        <div className="text-[11px] text-[#57544e]">
                          <strong className="text-[#827d73] font-academic-mono">확인 근거: </strong>
                          <span className="italic">
                            &ldquo;<AcademicMathView inline content={rubric.evidenceQuote} />&rdquo;
                          </span>
                        </div>
                      )}

                      {/* Deduction reason */}
                      {rubric.deductionReason && (
                        <div className="text-[11px] text-[#57544e]">
                          <strong className="text-[#827d73] font-academic-mono">감점 요인: </strong>
                          <span className={rubric.isVulnerable ? 'text-[#c52828]' : ''}>
                            <AcademicMathView inline content={rubric.deductionReason} />
                          </span>
                        </div>
                      )}

                      {/* Improvement tip */}
                      {rubric.improvementTip && (
                        <div className="text-[11px] text-[#191817] bg-[#faf8f4] p-1.5 rounded-2xs border border-[#f1ede4]">
                          <strong className="text-[#827d73] font-academic-mono">개선 방법: </strong>
                          <AcademicMathView inline content={rubric.improvementTip} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Comprehensive Feedback Prose */}
              <div className="p-3.5 bg-white border border-[#ded6c8] rounded-xs text-xs sm:text-sm korean-prose text-[#191817] leading-relaxed space-y-1">
                <strong className="text-[#827d73] block font-academic-mono text-[11px] font-semibold">
                  풀이 종합 학술 첨삭 총평:
                </strong>
                <AcademicMathView content={evaluationResult.feedback} />
              </div>

              {/* Stage 8: Method Selection Reason Diagnosis Zone (Independent from rubric score) */}
              <div className="border border-indigo-200 bg-indigo-50/40 p-4 rounded-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-indigo-200/70 pb-2">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-indigo-700" />
                    <span className="font-bold text-sm sm:text-base text-[#191817] font-academic-serif">
                      방법 선택 이유 진단 (METHOD SELECTION DIAGNOSIS)
                    </span>
                    <span className="text-[10px] font-academic-mono bg-indigo-100 text-indigo-900 border border-indigo-300 px-1.5 py-0.5 rounded-2xs font-semibold">
                      별도 독립 진단
                    </span>
                  </div>
                  <span className="text-[11px] font-academic-mono text-indigo-900 font-semibold">
                    {evaluationResult.methodSelectionDiagnosis?.isApplicable ? '방법 평가 적용 문항' : '해당 없음 검토'}
                  </span>
                </div>

                {/* Applicability Assessment Note */}
                {evaluationResult.methodSelectionDiagnosis?.applicabilityAssessment && (
                  <div className="p-2.5 bg-white/90 border border-indigo-200 rounded-xs text-xs text-indigo-950 flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold text-[11px] font-academic-mono">AI 평가 판단:</strong>
                      <p className="text-[11.5px] leading-relaxed">
                        {evaluationResult.methodSelectionDiagnosis.applicabilityAssessment}
                      </p>
                    </div>
                  </div>
                )}

                {/* 4 Criteria Diagnosis Cards */}
                {evaluationResult.methodSelectionDiagnosis?.criteria && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {evaluationResult.methodSelectionDiagnosis.criteria.map((crit) => {
                      const ratingBadgeClass =
                        crit.rating === 'proficient'
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : crit.rating === 'partially_met'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : crit.rating === 'needs_improvement'
                          ? 'bg-rose-100 text-rose-900 border-rose-300'
                          : 'bg-gray-100 text-gray-700 border-gray-300';

                      return (
                        <div
                          key={crit.key}
                          className="p-3 rounded-xs border border-indigo-200/80 bg-white space-y-2 shadow-2xs"
                        >
                          <div className="flex items-center justify-between gap-1 border-b border-gray-100 pb-1.5">
                            <span className="font-bold text-[#191817] text-xs">
                              {crit.label}
                            </span>
                            <span
                              className={`text-[10.5px] font-academic-mono font-bold px-2 py-0.5 rounded-2xs border ${ratingBadgeClass}`}
                            >
                              {METHOD_REASON_RATING_LABELS[crit.rating] || crit.rating}
                            </span>
                          </div>

                          {/* Student evidence quote */}
                          <div className="text-[11px] text-[#57544e]">
                            <strong className="text-[#827d73] font-academic-mono text-[10.5px]">확인된 근거: </strong>
                            <span className="italic text-[#2e2c29]">&ldquo;<AcademicMathView inline content={crit.evidence} />&rdquo;</span>
                          </div>

                          {/* Feedback */}
                          <div className="text-[11px] text-[#191817] bg-[#fbfbfe] p-1.5 rounded-2xs border border-indigo-100">
                            <strong className="text-indigo-900 font-academic-mono text-[10.5px]">진단 내용: </strong>
                            <span><AcademicMathView inline content={crit.feedback} /></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Diagnosis Summary */}
                {evaluationResult.methodSelectionDiagnosis?.summary && (
                  <div className="p-3 bg-white border border-indigo-200 rounded-xs text-xs text-[#191817] space-y-1">
                    <strong className="font-academic-mono text-[11px] text-indigo-900 block">
                      이유 진단 종합 총평:
                    </strong>
                    <p className="leading-relaxed">
                      <AcademicMathView content={evaluationResult.methodSelectionDiagnosis.summary} />
                    </p>
                  </div>
                )}

                {/* Suggestions and Next Concepts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {/* Suggested Improvements */}
                  {evaluationResult.methodSelectionDiagnosis?.suggestedImprovements && (
                    <div className="p-3 bg-white border border-indigo-200 rounded-xs space-y-1.5">
                      <strong className="font-academic-mono text-[11px] text-[#191817] flex items-center gap-1">
                        <span>✍️ 구체적인 보완 제안 문장</span>
                      </strong>
                      <ul className="list-disc list-inside space-y-1 text-[11.5px] text-[#2e2c29]">
                        {evaluationResult.methodSelectionDiagnosis.suggestedImprovements.map((s, idx) => (
                          <li key={idx} className="leading-relaxed">{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Next Concepts To Review */}
                  {evaluationResult.methodSelectionDiagnosis?.nextConceptsToReview && (
                    <div className="p-3 bg-white border border-indigo-200 rounded-xs space-y-1.5">
                      <strong className="font-academic-mono text-[11px] text-[#191817] flex items-center gap-1">
                        <span>📚 다음에 확인할 개념</span>
                      </strong>
                      <ul className="list-disc list-inside space-y-1 text-[11.5px] text-[#2e2c29]">
                        {evaluationResult.methodSelectionDiagnosis.nextConceptsToReview.map((c, idx) => (
                          <li key={idx} className="leading-relaxed">{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Decoupling invariant notice */}
                <div className="text-[10.5px] font-academic-mono text-[#827d73] bg-white/70 p-2 rounded-2xs border border-indigo-100">
                  ※ 방법 선택 이유 진단은 학생의 메타인지 및 알고리즘/정리 선택 타당성을 진단하는 독립 평가 영역이며, 100점 만점 루브릭 점수에 가감되거나 중복 감점되지 않습니다.
                </div>
              </div>

              {/* Action Buttons: Revise vs Confirm & Commit vs Report Error */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-[#fecaca]">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setEvaluationResult(null)}
                    className="flex-1 sm:flex-initial px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-white rounded-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>답안 수정</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsReportModalOpen(true)}
                    className="flex-1 sm:flex-initial px-3 py-2 text-xs border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 rounded-xs transition-colors flex items-center justify-center gap-1"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                    <span>문제/해설 오류 신고</span>
                  </button>
                </div>

                {submitOutcome && (
                  <div role="alert" className="w-full p-2.5 bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-xs space-y-1.5">
                    <p>{submitOutcome.message}</p>
                    <p className="text-[10.5px]">
                      {submitOutcome.attemptPersisted && submitOutcome.eventPersisted
                        ? '풀이 기록은 저장되었습니다.'
                        : '풀이 기록이 아직 완전히 저장되지 않았습니다.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {submitOutcome.status === 'retryable_failure' && (
                        <button
                          type="button"
                          onClick={handleConfirmAndRecord}
                          disabled={isSubmitting}
                          className="px-2.5 py-1 text-[11px] bg-[#191817] text-white rounded-xs font-bold disabled:opacity-50"
                        >
                          재시도 (AI 재평가 없음)
                        </button>
                      )}
                      {(submitOutcome.status === 'link_conflict' || submitOutcome.status === 'target_missing') &&
                        submitOutcome.attemptPersisted && (
                          <button
                            type="button"
                            onClick={onClose}
                            className="px-2.5 py-1 text-[11px] border border-[#ded6c8] rounded-xs hover:bg-white font-semibold"
                          >
                            기록만 보존하고 닫기
                          </button>
                        )}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleConfirmAndRecord}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 py-2.5 px-5 bg-[#191817] hover:bg-[#33302b] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>
                    {isSubmitting
                      ? '기록 저장 중...'
                      : submitOutcome?.status === 'retryable_failure'
                      ? '계획 연결 재시도 (AI 재평가 없음)'
                      : '결과 확인 및 복습 이력에 기록 확정하기'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <>
      {isPage ? (
        modalBody
      ) : (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
          {modalBody}
        </div>
      )}

      {/* Problem Report Modal */}
      {isReportModalOpen && (
        <ProblemReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          problem={problem}
          attemptId={currentAttemptId}
          onSubmitReport={(probId, reportData) => {
            if (onReportProblem) {
              return onReportProblem(probId, reportData);
            }
            return { success: false, error: '신고 핸들러가 연결되지 않았습니다.' };
          }}
        />
      )}
    </>
  );
}
