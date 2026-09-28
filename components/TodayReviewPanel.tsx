'use client';

import React from 'react';
import { Concept, Problem, ProblemType, Subject, ReviewRecommendation } from '../lib/types';
import {
  Target,
  Clock,
  Play,
  Calendar,
  BookOpen,
  AlertCircle,
  Sparkles,
  CheckSquare,
  HelpCircle,
  ArrowRight,
} from 'lucide-react';

interface TodayReviewPanelProps {
  subject: Subject;
  concept: Concept;
  problems: Problem[];
  selectedProblemType: ProblemType;
  onSelectProblemType: (type: ProblemType) => void;
  onStartSession: (problemId?: string) => void;
  onPostponeDay: (conceptId: string) => void;
  onOpenSourceModal: (ref: string) => void;
  onOpenProblemGenerator?: (conceptId?: string) => void;
  onOpenProblemReview?: () => void;
  problemDraftCount?: number;
  recommendation?: ReviewRecommendation | null;
  totalConceptsCount?: number;
}

export function TodayReviewPanel({
  subject,
  concept,
  problems,
  selectedProblemType,
  onSelectProblemType,
  onStartSession,
  onPostponeDay,
  onOpenSourceModal,
  onOpenProblemGenerator,
  onOpenProblemReview,
  problemDraftCount = 0,
  recommendation,
  totalConceptsCount = 1,
}: TodayReviewPanelProps) {
  // Find problems linked to this concept
  const conceptProblems = problems.filter(
    (p) => p.conceptIds?.includes(concept.id) || (p as any).conceptId === concept.id
  );
  const hasApprovedProblems = conceptProblems.length > 0;

  // Find problem matching selected category or fallback
  const activeProblem =
    (hasApprovedProblems ? conceptProblems.find((p) => p.type === selectedProblemType) : null) ||
    conceptProblems[0] ||
    problems.find((p) => p.type === selectedProblemType) ||
    problems[0];

  const isMath = subject.domain === 'math_stats';

  // 4 categories depending on subject domain
  const categories: { type: ProblemType; label: string; num: number }[] = isMath
    ? [
        { type: 'essay_descriptive', label: '1. 대학 논술·서술형', num: 1 },
        { type: 'calc_derivation', label: '2. 계산 유도형', num: 2 },
        { type: 'proof_counterexample', label: '3. 증명 및 반례', num: 3 },
        { type: 'error_spotting', label: '4. 오류 검증형', num: 4 },
      ]
    : [
        { type: 'impl_descriptive', label: '1. 구현 및 서술형', num: 1 },
        { type: 'algorithm_optimization', label: '2. 알고리즘 최적화 설명', num: 2 },
        { type: 'complexity_proof', label: '3. 시간/공간 복잡도 증명', num: 3 },
        { type: 'debug_counterexample', label: '4. 디버깅 및 반례 분석', num: 4 },
      ];

  const postponeDays = concept.postponeDays || 0;

  return (
    <div
      id="today-review-panel"
      className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Panel Top: Priority Rank and Recommendation Status */}
      <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
        <div className="flex items-center gap-1.5 text-xs font-academic-mono font-bold text-[#c52828]">
          <Target className="w-4 h-4 text-[#c52828]" />
          <span>
            우선순위 #{recommendation?.priorityRank || 1} / {totalConceptsCount}개
          </span>
          {recommendation?.isDueTodayOrOverdue ? (
            <span className="text-[10px] font-bold font-academic-mono bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded-2xs">
              오늘 복습 대상
            </span>
          ) : (
            <span className="text-[10px] font-medium font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#57544e] px-1.5 py-0.5 rounded-2xs">
              {recommendation?.daysUntilReview !== undefined && recommendation.daysUntilReview > 0
                ? `D+${recommendation.daysUntilReview} 권장`
                : '일정 대기'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs font-academic-mono text-[#57544e]">
          <Clock className="w-3.5 h-3.5 text-[#827d73]" />
          <span>EST: {activeProblem?.timeStandardMinutes || 15} MIN</span>
        </div>
      </div>

      {/* Target Topic Header */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] font-academic-mono text-[#827d73]">
          <span className="uppercase tracking-wider">TARGET TOPIC</span>
          <span className="text-[#191817] font-semibold">{concept.chapterRef || '교재 연계'}</span>
        </div>
        <h2 className="text-base sm:text-lg font-bold text-[#191817] font-academic-serif leading-tight">
          {concept.title}
        </h2>
      </div>

      {/* Recommendation Rationale Card */}
      {recommendation && concept.status !== 'unstudied' && (
        <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-academic-mono font-bold text-[#191817] text-[11.5px] flex items-center gap-1">
              <span>● 복습 권장 사유:</span>
            </span>
            <span className="font-academic-mono text-[11px] text-[#c52828] font-semibold">
              권장일: {recommendation.recommendedDateStr}
            </span>
          </div>

          <p className="text-[11.5px] text-[#57544e] leading-relaxed">
            {recommendation.priorityReason}
          </p>

          {/* Model Factors Micro-strip */}
          <div className="pt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] font-academic-mono text-[#827d73]">
            <span className="bg-white border border-[#e2ded6] px-1.5 py-0.5 rounded-2xs">
              최근 점수: {recommendation.factors.lastScore}점
            </span>
            <span className="bg-white border border-[#e2ded6] px-1.5 py-0.5 rounded-2xs">
              기억안정성 τ: {recommendation.factors.effectiveTau}일
            </span>
            {recommendation.factors.confidenceFactor < 1.0 && (
              <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-2xs">
                확신도 감쇠 x{recommendation.factors.confidenceFactor}
              </span>
            )}
            {recommendation.factors.hintPenalty < 1.0 && (
              <span className="bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-2xs">
                힌트 사용 감점 x{recommendation.factors.hintPenalty}
              </span>
            )}
            {recommendation.factors.vulnerableCriterionCount > 0 && (
              <span className="bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-2xs">
                취약 루브릭 {recommendation.factors.vulnerableCriterionCount}건
              </span>
            )}
            {postponeDays > 0 && (
              <span className="bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-2xs font-semibold">
                +{postponeDays}일 미루기 적용 중
              </span>
            )}
          </div>
        </div>
      )}

      {/* Unstudied Alert if applicable */}
      {concept.status === 'unstudied' && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 space-y-1">
          <div className="font-bold flex items-center gap-1 text-[#191817]">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
            <span>미학습 상태 (학습 대기)</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            사용자 자료에서 추출 승인된 신규 개념입니다. 학습 완료 등록 전까지는 임의의 망각곡선이나 과거 점수를 생성하지 않습니다.
          </p>
        </div>
      )}

      {/* Task Category Grid (If problems exist) */}
      {hasApprovedProblems ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-academic-mono text-[#827d73]">
            <span className="uppercase tracking-wider">TASK CATEGORY</span>
            <span className="text-[#c52828] font-semibold">
              {conceptProblems.length}개 승인 문제 준비됨
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {categories.map((cat) => {
              const isSelected = cat.type === selectedProblemType;
              const hasCatProblem = conceptProblems.some((p) => p.type === cat.type);
              return (
                <button
                  key={cat.type}
                  onClick={() => onSelectProblemType(cat.type)}
                  className={`py-2 px-2.5 text-left text-xs rounded-xs border transition-all ${
                    isSelected
                      ? 'bg-[#191817] text-white border-[#191817] font-semibold shadow-xs'
                      : hasCatProblem
                      ? 'bg-[#faf8f4] text-[#191817] border-[#ded6c8] hover:bg-white'
                      : 'bg-white text-[#827d73] border-[#ede8de] hover:bg-[#faf8f4]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{cat.label}</span>
                    {hasCatProblem && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* No approved problems for this concept fallback */
        <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xs text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-amber-900">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>이 개념의 승인된 문제가 없습니다</span>
          </div>
          <p className="text-[11.5px] text-amber-800 leading-relaxed">
            망각곡선 감쇠를 막고 실력을 점검하기 위해, AI로 대학 고난도 논술형 시험 문제를 출제해 보세요.
          </p>
          {onOpenProblemGenerator && (
            <button
              type="button"
              onClick={() => onOpenProblemGenerator(concept.id)}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xs shadow-2xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>[ {concept.title} ] 문제 출제하기 →</span>
            </button>
          )}
        </div>
      )}

      {/* Meta Specs List (if active problem exists) */}
      {activeProblem && (
        <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-academic-mono text-[#827d73] shrink-0 text-[11px]">소요 규격:</span>
            <span className="text-[#191817] text-right font-medium">{activeProblem.timeBreakdownDesc}</span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="font-academic-mono text-[#827d73] shrink-0 text-[11px]">핵심 평가:</span>
            <span className="text-[#c52828] font-bold text-right text-[11.5px]">
              {activeProblem.coreEvaluationHighlight}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="font-academic-mono text-[#827d73] shrink-0 text-[11px]">문항 구성:</span>
            <span className="text-[#191817] text-right font-medium">{activeProblem.itemCountDesc}</span>
          </div>
        </div>
      )}

      {/* Exercise Prompt Box */}
      {activeProblem && (
        <div className="border border-[#ded6c8] bg-[#fcfbf9] p-3 rounded-xs space-y-1">
          <div className="font-academic-mono text-[11px] font-bold text-[#827d73]">
            EXERCISE PROMPT § {activeProblem.title}
          </div>
          <p className="text-sm sm:text-[14px] text-[#191817] leading-[1.65] korean-prose line-clamp-3">
            &ldquo;{activeProblem.promptText}&rdquo;
          </p>
        </div>
      )}

      {/* AI Problem Generation & Review Strip (Stage 3) */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        {onOpenProblemGenerator && (
          <button
            type="button"
            onClick={() => onOpenProblemGenerator(concept.id)}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#191817] font-semibold bg-[#faf8f4] hover:bg-white border border-[#ded6c8] hover:border-[#c52828] rounded-xs transition-colors shadow-2xs"
            title="선택된 개념으로 대학 고난도 시험 문제를 출제합니다"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>AI 문제 출제</span>
          </button>
        )}

        {onOpenProblemReview && (
          <button
            type="button"
            onClick={onOpenProblemReview}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#57544e] hover:text-[#191817] bg-[#faf8f4] hover:bg-white border border-[#ded6c8] rounded-xs transition-colors"
            title="출제된 문제 초안을 검토하고 승인합니다"
          >
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
            <span>문제 검토 ({problemDraftCount}건)</span>
          </button>
        )}
      </div>

      {/* Primary CTA Button: 풀이 시작 or 문제 생성 */}
      {hasApprovedProblems ? (
        <button
          onClick={() => onStartSession(activeProblem?.id)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#c52828] hover:bg-[#a82020] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all active:scale-[0.99]"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>START SESSION NOW (100점 채점) →</span>
        </button>
      ) : (
        <button
          onClick={() => onOpenProblemGenerator?.(concept.id)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#191817] hover:bg-[#33302b] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all active:scale-[0.99]"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>새 시험 문제 생성하기 →</span>
        </button>
      )}

      {/* Secondary Actions: 하루 미루기 & 학습 자료 보기 */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={() => onPostponeDay(concept.id)}
          className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#57544e] hover:text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#ded6c8] rounded-xs transition-colors shadow-2xs"
          title="기억 점수나 풀이 기록은 변동 없이, 복습 권장 일정만 하루 연기합니다"
        >
          <Calendar className="w-3.5 h-3.5 text-[#827d73]" />
          <span>{postponeDays > 0 ? `+1일 추가 미루기 (+${postponeDays}D)` : '하루 미루기 (+1D)'}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSourceModal(concept.chapterRef)}
          className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#57544e] hover:text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#ded6c8] rounded-xs transition-colors shadow-2xs"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#827d73]" />
          <span>학습 자료 보기</span>
        </button>
      </div>

      <p className="text-[10px] text-center font-academic-mono text-[#827d73]">
        ※ 하루 미루기는 일정만 연기되며 학습 점수 및 이력은 상승하지 않습니다.
      </p>
    </div>
  );
}
