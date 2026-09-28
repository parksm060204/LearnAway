'use client';

import React from 'react';
import { Concept, Problem, ProblemType, Subject } from '../lib/types';
import { Target, Clock, Play, Calendar, BookOpen, AlertCircle } from 'lucide-react';

interface TodayReviewPanelProps {
  subject: Subject;
  concept: Concept;
  problems: Problem[];
  selectedProblemType: ProblemType;
  onSelectProblemType: (type: ProblemType) => void;
  onStartSession: () => void;
  onPostponeDay: () => void;
  onOpenSourceModal: (ref: string) => void;
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
}: TodayReviewPanelProps) {
  // Find problem matching selected category
  const activeProblem =
    problems.find((p) => p.type === selectedProblemType) || problems[0];

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

  return (
    <div
      id="today-review-panel"
      className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs space-y-4"
    >
      {/* Panel Top: Protocol header and Estimated time */}
      <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
        <div className="flex items-center gap-1.5 text-xs font-academic-mono font-bold text-[#c52828]">
          <Target className="w-4 h-4 text-[#c52828]" />
          <span>TODAY PROTOCOL 1/3</span>
          <span className="text-[9.5px] font-normal font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#827d73] px-1 py-0.5 rounded-2xs">
            0단계 레이아웃 프리뷰
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs font-academic-mono text-[#57544e]">
          <Clock className="w-3.5 h-3.5 text-[#827d73]" />
          <span>EST: {activeProblem?.timeStandardMinutes || 15} MIN</span>
        </div>
      </div>

      {/* Target Topic */}
      <div className="space-y-0.5">
        <span className="text-[11px] font-academic-mono text-[#827d73] uppercase tracking-wider">
          TARGET TOPIC
        </span>
        <h2 className="text-base sm:text-lg font-bold text-[#191817] font-academic-serif leading-tight">
          {concept.title}
        </h2>
      </div>

      {/* Task Category Grid */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-academic-mono text-[#827d73]">
          <span className="uppercase tracking-wider">TASK CATEGORY</span>
          <span className="text-[#c52828] font-semibold">대학 논술형 기본</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {categories.map((cat) => {
            const isSelected = cat.type === selectedProblemType;
            return (
              <button
                key={cat.type}
                onClick={() => onSelectProblemType(cat.type)}
                className={`py-2 px-2.5 text-left text-xs rounded-xs border transition-all ${
                  isSelected
                    ? 'bg-[#191817] text-white border-[#191817] font-semibold shadow-xs'
                    : 'bg-[#faf8f4] text-[#57544e] border-[#ded6c8] hover:bg-white hover:text-[#191817]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Meta Specs List */}
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
            EXERCISE PROMPT §01
          </div>
          <p className="text-sm sm:text-[15px] text-[#191817] leading-[1.7] korean-prose line-clamp-4">
            &ldquo;{activeProblem.promptText}&rdquo;
          </p>
        </div>
      )}

      {/* CTA Button */}
      <button
        onClick={onStartSession}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#c52828] hover:bg-[#a82020] text-white text-xs sm:text-sm font-bold rounded-xs shadow-xs transition-all active:scale-[0.99]"
      >
        <Play className="w-3.5 h-3.5 fill-white" />
        <span>START SESSION NOW ({activeProblem ? '3 ITEMS' : 'START'}) →</span>
      </button>

      {/* Secondary Actions */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={onPostponeDay}
          className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#57544e] hover:text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#ded6c8] rounded-xs transition-colors"
          title="복습 일정을 1일 뒤로 연기합니다"
        >
          <Calendar className="w-3.5 h-3.5 text-[#827d73]" />
          <span>+1D 일정 연기</span>
        </button>

        <button
          onClick={() => onOpenSourceModal(concept.chapterRef)}
          className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs text-[#57544e] hover:text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#ded6c8] rounded-xs transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#827d73]" />
          <span>원문 교재 PDF 보기</span>
        </button>
      </div>
    </div>
  );
}
