'use client';

import React, { useState } from 'react';
import {
  Concept,
  Problem,
  Attempt,
  ErrorType,
  RubricResult,
  Subject,
  EvaluationResult,
  ProblemReportType,
} from '../lib/types';
import { MathFormula } from './MathFormula';
import { ProblemReportModal } from './ProblemReportModal';
import {
  X,
  Clock,
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
  CheckSquare,
  Loader2,
  HelpCircle,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

interface ProblemSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concept: Concept;
  problem: Problem;
  onSubmitAttempt: (attempt: Attempt) => void;
  onOpenSourceModal: (sourceRef: string) => void;
  onReportProblem?: (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => { success: boolean; error?: string };
}

export function ProblemSessionModal({
  isOpen,
  onClose,
  subject,
  concept,
  problem,
  onSubmitAttempt,
  onOpenSourceModal,
  onReportProblem,
}: ProblemSessionModalProps) {
  const [answerText, setAnswerText] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [revealedHints, setRevealedHints] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number>(3);
  const [errorType, setErrorType] = useState<ErrorType>('none');
  const [reasoningNotes, setReasoningNotes] = useState('');

  // Stage 4: AI Evaluation State
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModelAnswerVisible, setIsModelAnswerVisible] = useState(false);

  // Stage 6: Report State
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | undefined>();

  if (!isOpen) return null;

  const handleRevealHint = (index: number) => {
    if (!revealedHints.includes(index)) {
      setRevealedHints([...revealedHints, index]);
    }
  };

  const insertMathSnippet = (snippet: string) => {
    setAnswerText((prev) => prev + snippet);
  };

  // Stage 4: Real AI Answer Evaluation Request
  const handleRequestEvaluation = async () => {
    const trimmed = answerText.trim();
    if (!trimmed) {
      alert('답안을 작성한 후 평가를 요청해 주세요.');
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
          hints: problem.hints,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setEvaluationError(data.error || 'AI 평가 요청에 실패했습니다.');
        return;
      }

      const evalData: EvaluationResult = data.evaluation;
      setEvaluationResult(evalData);
      setCurrentAttemptId(`att-${Date.now()}-${Math.random().toString(36).substring(7)}`);

      // Pre-fill error diagnosis with AI recommendation
      if (evalData.recommendedErrorType) {
        setErrorType(evalData.recommendedErrorType);
      }
    } catch (err: any) {
      setEvaluationError(`네트워크 연결 오류: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Stage 4: Confirm and Commit Attempt
  const handleConfirmAndRecord = () => {
    if (!evaluationResult || isSubmitting) return;
    setIsSubmitting(true);

    const attemptIdToUse = currentAttemptId || `att-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const newAttempt: Attempt = {
      id: attemptIdToUse,
      problemId: problem.id,
      conceptId: concept.id,
      conceptIds: problem.conceptIds || [concept.id],
      subjectId: subject.id,
      at: new Date().toISOString(),
      answer: answerText,
      confidence,
      errorType,
      hintCount: revealedHints.length,
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
    };

    onSubmitAttempt(newAttempt);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-4xl bg-white border border-[#c8c2b5] rounded-xs shadow-xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
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

            <h3 className="text-base sm:text-[17px] font-bold text-[#191817] font-academic-serif leading-[1.75] korean-prose">
              {problem.promptText}
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
                          <span className="korean-prose">{hint}</span>
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

          {/* Model Answer (Spoiler Prevention: Hidden by default before submission) */}
          <div className="border border-[#ded6c8] rounded-xs bg-[#fcfbf9] overflow-hidden">
            <button
              type="button"
              onClick={() => setIsModelAnswerVisible(!isModelAnswerVisible)}
              className="w-full px-4 py-2 bg-[#f6f3eb] hover:bg-[#ede8dc] flex items-center justify-between text-xs transition-colors"
            >
              <div className="flex items-center gap-1.5 font-bold text-[#57544e]">
                {isModelAnswerVisible ? (
                  <EyeOff className="w-3.5 h-3.5 text-[#827d73]" />
                ) : (
                  <Eye className="w-3.5 h-3.5 text-[#827d73]" />
                )}
                <span>출제자 모범 답안 (스포일러 방지)</span>
              </div>
              <span className="text-[11px] font-academic-mono text-[#827d73]">
                {isModelAnswerVisible ? '답안 접기' : '풀이 전 스포일러 주의 (클릭하여 확인)'}
              </span>
            </button>

            {isModelAnswerVisible && (
              <div className="p-4 border-t border-[#ded6c8] bg-white space-y-2 text-xs leading-relaxed text-[#191817] korean-prose whitespace-pre-wrap">
                <div className="font-academic-mono text-[11px] text-[#827d73] font-semibold mb-1">
                  모범 답안 및 핵심 논증 단계:
                </div>
                {problem.modelAnswer}
              </div>
            )}
          </div>

          {/* Answer Workspace Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              {/* Tab Selector */}
              <div className="flex items-center gap-1 bg-[#faf8f4] p-1 border border-[#ded6c8] rounded-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('editor')}
                  className={`px-3 py-1 text-xs font-academic-mono rounded-xs transition-colors ${
                    activeTab === 'editor'
                      ? 'bg-white font-bold text-[#191817] shadow-2xs'
                      : 'text-[#827d73] hover:text-[#191817]'
                  }`}
                >
                  답안 작성 (Editor)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1 text-xs font-academic-mono rounded-xs transition-colors ${
                    activeTab === 'preview'
                      ? 'bg-white font-bold text-[#191817] shadow-2xs'
                      : 'text-[#827d73] hover:text-[#191817]'
                  }`}
                >
                  수식 & 서술 미리보기
                </button>
              </div>

              {/* Math / Quick Snippets */}
              <div className="hidden sm:flex items-center gap-1 text-[11px] font-academic-mono text-[#827d73]">
                <span>빠른 기호 입력:</span>
                {['\\int', 'E[Y|X]', '\\iint', '\\le', '\\infty', 'f(x,y)'].map((snip) => (
                  <button
                    key={snip}
                    type="button"
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
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="단계별 증명 전개, 정리 적용 정당화, 또는 코드 알고리즘 논증을 상세히 서술하십시오... (LaTeX 수식 기호 $...$ 사용 가능)"
                rows={9}
                className="w-full p-3.5 essay-answer border border-[#ded6c8] rounded-xs focus:border-[#191817] focus:ring-1 focus:ring-[#191817] resize-y bg-[#fefefe]"
              />
            ) : (
              <div className="w-full min-h-[200px] p-3.5 essay-answer border border-[#ded6c8] rounded-xs bg-[#faf8f4] overflow-y-auto whitespace-pre-wrap">
                {answerText ? (
                  <div>{answerText}</div>
                ) : (
                  <span className="text-[#827d73]">작성된 답안이 없습니다.</span>
                )}
              </div>
            )}
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
                            &ldquo;{rubric.evidenceQuote}&rdquo;
                          </span>
                        </div>
                      )}

                      {/* Deduction reason */}
                      {rubric.deductionReason && (
                        <div className="text-[11px] text-[#57544e]">
                          <strong className="text-[#827d73] font-academic-mono">감점 요인: </strong>
                          <span className={rubric.isVulnerable ? 'text-[#c52828]' : ''}>
                            {rubric.deductionReason}
                          </span>
                        </div>
                      )}

                      {/* Improvement tip */}
                      {rubric.improvementTip && (
                        <div className="text-[11px] text-[#191817] bg-[#faf8f4] p-1.5 rounded-2xs border border-[#f1ede4]">
                          <strong className="text-[#827d73] font-academic-mono">개선 방법: </strong>
                          {rubric.improvementTip}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Comprehensive Feedback Prose */}
              <div className="p-3.5 bg-white border border-[#ded6c8] rounded-xs text-xs sm:text-sm korean-prose text-[#191817] leading-relaxed space-y-1">
                <strong className="text-[#827d73] block font-academic-mono text-[11px] font-semibold">
                  종합 학술 첨삭 총평:
                </strong>
                <p>{evaluationResult.feedback}</p>
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

                <button
                  type="button"
                  onClick={handleConfirmAndRecord}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 py-2.5 px-5 bg-[#191817] hover:bg-[#33302b] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>
                    {isSubmitting ? '기록 저장 중...' : '결과 확인 및 복습 이력에 기록 확정하기'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
