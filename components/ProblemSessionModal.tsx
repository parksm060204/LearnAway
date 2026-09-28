'use client';

import React, { useState } from 'react';
import { Concept, Problem, Attempt, ErrorType, RubricResult, Subject } from '../lib/types';
import { MathFormula } from './MathFormula';
import {
  X,
  Clock,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Send,
  Eye,
  Edit,
  Sparkles,
  BookOpen,
} from 'lucide-react';

interface ProblemSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  concept: Concept;
  problem: Problem;
  onSubmitAttempt: (attempt: Attempt) => void;
  onOpenSourceModal: (sourceRef: string) => void;
}

export function ProblemSessionModal({
  isOpen,
  onClose,
  subject,
  concept,
  problem,
  onSubmitAttempt,
  onOpenSourceModal,
}: ProblemSessionModalProps) {
  const [answerText, setAnswerText] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [revealedHints, setRevealedHints] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number>(3);
  const [errorType, setErrorType] = useState<ErrorType>('none');
  const [reasoningNotes, setReasoningNotes] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<{
    calculatedScore: number;
    rubricResults: RubricResult[];
    feedback: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleRevealHint = (index: number) => {
    if (!revealedHints.includes(index)) {
      setRevealedHints([...revealedHints, index]);
    }
  };

  const insertMathSnippet = (snippet: string) => {
    setAnswerText((prev) => prev + snippet);
  };

  // Demo Rubric Evaluator Adapter (Transparent & Honest Demo Grader)
  const runDemoEvaluation = () => {
    const text = answerText.trim();
    if (!text) {
      alert('답안을 작성한 후 제출해 주세요.');
      return;
    }

    // Keyword & rubric-based mock evaluation adapter
    let calculatedScore = 75;
    const rubricResults: RubricResult[] = [];

    // Analyze text keywords based on domain
    const isMath = subject.domain === 'math_stats';
    const hasFubini = text.includes('푸비니') || text.includes('Fubini') || text.includes('절대수렴');
    const hasIntegral = text.includes('적분') || text.includes('\\int') || text.includes('int');
    const hasExpectation = text.includes('기댓값') || text.includes('E[') || text.includes('밀도');

    const hasRbt = text.includes('불변식') || text.includes('회전') || text.includes('Rotate');
    const hasCase = text.includes('Case') || text.includes('삼촌') || text.includes('부모');

    problem.rubric.forEach((criterion, idx) => {
      let critScore = 4.0;
      let isVulnerable = false;
      let critFeedback = '논리적 서술 및 단계별 전개가 명확함.';

      if (idx === 1) {
        // Second criterion is usually rigorous condition check
        if (isMath && !hasFubini) {
          critScore = 2.5;
          isVulnerable = true;
          critFeedback = '정리 적용의 절대수렴 요건(푸비니 정리 정당화) 명시가 미흡하여 감점됨.';
        } else if (!isMath && !hasRbt) {
          critScore = 2.5;
          isVulnerable = true;
          critFeedback = '서브트리 포인터 재배치 및 블랙-하이트 보존 엄밀성 서술 부족.';
        } else {
          critScore = 4.5;
          critFeedback = '정리 및 조건의 전제조건을 엄밀하게 서술함.';
        }
      } else if (idx === 0) {
        critScore = text.length > 80 ? 4.5 : 3.0;
        critFeedback = text.length > 80 ? '수식 전개 및 도입부 논리성이 우수함.' : '서술 분량이 다소 압축되어 추가 설명 필요.';
      } else {
        critScore = 4.5;
        critFeedback = '최종 결론의 수렴성 및 논리적 닫힘이 양호함.';
      }

      rubricResults.push({
        criterionId: criterion.id,
        label: criterion.label,
        score: critScore,
        maxScore: criterion.maxScore,
        isVulnerable,
        feedback: critFeedback,
      });
    });

    const totalWeightedScore = rubricResults.reduce(
      (sum, r) => sum + (r.score / r.maxScore) * 100 * (1 / rubricResults.length),
      0
    );

    calculatedScore = Math.round(totalWeightedScore);

    const feedback = isMath
      ? hasFubini
        ? '반복 기댓값의 법칙 증명에서 푸비니 정리의 전제 조건과 결합밀도함수의 이중적분 순서 교환을 적절하게 서술하였습니다.'
        : '반복 기댓값의 법칙 증명 과정에서 이중적분 순서 교환 시 푸비니 정리(Fubini\'s Theorem)의 절대수렴성 정당화 단계가 일부 생략되었습니다.'
      : '알고리즘 불변식 복구 단계와 케이스별 포인터 회전/색상 반전 메커니즘을 대체로 정확하게 도출하였습니다.';

    setEvaluationResult({
      calculatedScore,
      rubricResults,
      feedback,
    });
  };

  const handleConfirmAndRecord = () => {
    if (!evaluationResult) return;

    const newAttempt: Attempt = {
      id: `att-${Date.now()}`,
      problemId: problem.id,
      conceptId: concept.id,
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
            <span className="text-xs sm:text-sm font-bold truncate max-w-[300px] sm:max-w-[450px]">
              {concept.title} [{problem.categoryLabel}]
            </span>
          </div>

          <button
            onClick={onClose}
            className="text-[#ded6c8] hover:text-white p-1 rounded-xs"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {/* Problem Statement Card */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-4 rounded-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-academic-mono text-xs font-bold text-[#c52828]">
                {problem.categoryLabel} · 표준 소요: {problem.timeStandardMinutes}분
              </span>

              <button
                onClick={() => onOpenSourceModal(problem.sourceRefs)}
                className="flex items-center gap-1 text-[11px] font-academic-mono text-[#57544e] hover:text-[#c52828] underline"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>출처: {problem.sourceRefs}</span>
              </button>
            </div>

            <h3 className="text-base sm:text-[17px] font-bold text-[#191817] font-academic-serif leading-[1.75] korean-prose">
              {problem.promptText}
            </h3>

            {problem.mathFormula && (
              <div className="p-2.5 bg-white border border-[#e2ded6] rounded-xs text-center overflow-x-auto">
                <MathFormula math={problem.mathFormula} displayMode />
              </div>
            )}

            {problem.codeSnippet && (
              <pre className="p-2.5 bg-[#252321] text-[#f4f1ea] font-academic-mono text-xs rounded-xs overflow-x-auto leading-relaxed">
                <code>{problem.codeSnippet}</code>
              </pre>
            )}

            <div className="text-[11px] font-academic-mono text-[#827d73] pt-1 border-t border-[#ede8de]">
              핵심 채점 포인트: <span className="font-semibold text-[#191817]">{problem.coreEvaluationHighlight}</span>
            </div>
          </div>

          {/* Hints Section */}
          <div className="border border-[#ded6c8] bg-white rounded-xs p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#57544e] font-academic-mono">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                <span>단계별 힌트 (사용한 힌트 수는 복습 성취도 계산에 반영됩니다)</span>
              </div>
              <span className="text-xs font-academic-mono text-[#827d73]">
                사용한 힌트: {revealedHints.length} / {problem.hints.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {problem.hints.map((hint, idx) => {
                const isRevealed = revealedHints.includes(idx);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xs border text-xs ${
                      isRevealed
                        ? 'border-amber-300 bg-amber-50/70 text-[#191817]'
                        : 'border-[#ded6c8] bg-[#faf8f4] text-[#827d73]'
                    }`}
                  >
                    {isRevealed ? (
                      <p className="text-[14px] sm:text-[15px] leading-relaxed korean-prose">{hint}</p>
                    ) : (
                      <button
                        onClick={() => handleRevealHint(idx)}
                        className="w-full text-left font-academic-mono font-medium hover:text-[#191817] flex items-center justify-between"
                      >
                        <span>[힌트 {idx + 1} 열기]</span>
                        <span className="text-[10px] text-amber-700">클릭하여 확인</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Answer Workspace Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-[#ded6c8] pb-1.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`px-3 py-1 text-xs font-medium rounded-xs transition-colors ${
                    activeTab === 'editor'
                      ? 'bg-[#191817] text-white font-semibold'
                      : 'text-[#57544e] hover:bg-[#faf8f4]'
                  }`}
                >
                  답안 작성 에디터
                </button>
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1 text-xs font-medium rounded-xs transition-colors ${
                    activeTab === 'preview'
                      ? 'bg-[#191817] text-white font-semibold'
                      : 'text-[#57544e] hover:bg-[#faf8f4]'
                  }`}
                >
                  수식 & 서술 미리보기
                </button>
              </div>

              {/* Math / Quick Snippets */}
              <div className="hidden sm:flex items-center gap-1 text-[11px] font-academic-mono text-[#827d73]">
                <span>빠른 수식 입력:</span>
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

          {/* Self-Reflection & Diagnostic Area */}
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
                  자가 오답/취약 원인 판별:
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

          {/* Evaluation Trigger or Evaluation Result Display */}
          {!evaluationResult ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={runDemoEvaluation}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#c52828] hover:bg-[#a82020] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all"
              >
                <Send className="w-4 h-4" />
                <span>제출 및 정밀 첨삭 평가 (EVALUATE SUBMISSION)</span>
              </button>
            </div>
          ) : (
            <div className="border border-[#c52828] bg-[#fef2f2]/40 p-4 rounded-xs space-y-3 animate-fade-in">
              <div className="flex items-center justify-between border-b border-[#fecaca] pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#c52828]" />
                  <span className="font-bold text-xs sm:text-sm text-[#191817] font-academic-serif">
                    정밀 루브릭 평가 결과: SCORE {evaluationResult.calculatedScore}점
                  </span>
                </div>
                <span className="text-[11px] font-academic-mono text-[#827d73]">
                  데모 루브릭 어댑터 산출
                </span>
              </div>

              {/* Rubric Breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {evaluationResult.rubricResults.map((rubric) => (
                  <div
                    key={rubric.criterionId}
                    className={`p-2.5 rounded-xs border bg-white ${
                      rubric.isVulnerable ? 'border-[#c52828]' : 'border-[#ded6c8]'
                    }`}
                  >
                    <div className="flex justify-between font-bold mb-1">
                      <span className={rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'}>
                        {rubric.label}
                      </span>
                      <span className={rubric.isVulnerable ? 'text-[#c52828]' : 'text-[#191817]'}>
                        {rubric.score.toFixed(1)} / {rubric.maxScore.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#57544e]">{rubric.feedback}</p>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-white border border-[#ded6c8] rounded-xs text-sm sm:text-base korean-prose text-[#191817] leading-relaxed">
                <strong className="text-[#827d73] block mb-1 font-academic-mono text-xs font-semibold">정밀 첨삭 총평:</strong>
                {evaluationResult.feedback}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEvaluationResult(null)}
                  className="px-3 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-white rounded-xs"
                >
                  다시 수정하기
                </button>

                <button
                  type="button"
                  onClick={handleConfirmAndRecord}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-4 bg-[#191817] hover:bg-[#33302b] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>이력 저장 및 망각곡선 즉시 반영하기</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
