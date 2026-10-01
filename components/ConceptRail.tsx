'use client';

import React from 'react';
import { Concept } from '../lib/types';
import { CONCEPT_STATUS_METADATA } from '../lib/retentionModel';
import { formatSeoulDate, getSeoulCalendarDiff } from '../lib/dateUtils';
import { ArrowUpDown, CheckSquare, Square } from 'lucide-react';

export type SortMode = 'vulnerability' | 'recent_study' | 'chapter_order';

interface ConceptRailProps {
  concepts: Concept[];
  selectedConceptId: string;
  onSelectConcept: (conceptId: string) => void;
  sortMode: SortMode;
  onChangeSortMode: (mode: SortMode) => void;
  isComparisonMode?: boolean;
  comparedConceptIds?: string[];
  onToggleCompareConcept?: (conceptId: string) => void;
}

export function ConceptRail({
  concepts,
  selectedConceptId,
  onSelectConcept,
  sortMode,
  onChangeSortMode,
  isComparisonMode = false,
  comparedConceptIds = [],
  onToggleCompareConcept,
}: ConceptRailProps) {
  // Sort concepts dynamically based on sortMode
  const sortedConcepts = [...concepts].sort((a, b) => {
    if (sortMode === 'vulnerability') {
      // Lower score first (vulnerable first)
      return a.currentScore - b.currentScore;
    }
    if (sortMode === 'recent_study') {
      // More recent attempt/first learned first (higher dayOffset)
      const dayA = a.lastAttemptDayOffset ?? a.firstLearnedDayOffset ?? -999;
      const dayB = b.lastAttemptDayOffset ?? b.firstLearnedDayOffset ?? -999;
      return dayB - dayA;
    }
    // 'chapter_order'
    return a.order - b.order;
  });

  return (
    <section className="w-full bg-white border border-[#e2ded6] rounded-xs p-3.5 sm:p-4 shadow-2xs space-y-3">
      {/* Rail Header with Table number and Sort buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-[#f1ede4]">
        <div className="flex items-center gap-2">
          <span className="font-academic-mono text-xs font-bold text-[#827d73]">TABLE 1.0</span>
          <h2 className="text-xs sm:text-sm font-bold text-[#191817] font-academic-serif">
            과정 등록 개념 및 망각 지수 대조 레일
          </h2>
          <span className="text-xs text-[#827d73] font-academic-mono">
            (총 {concepts.length}개 핵심 토픽 추적 중)
          </span>
        </div>

        {/* Sort Buttons */}
        <div className="flex items-center gap-1.5 text-xs self-end sm:self-auto">
          <div className="flex items-center gap-1 text-[#827d73] text-[11px] font-academic-mono mr-1">
            <ArrowUpDown className="w-3 h-3" />
            <span>SORT:</span>
          </div>

          <button
            onClick={() => onChangeSortMode('vulnerability')}
            className={`px-2.5 py-1 text-xs rounded-xs font-medium transition-all ${
              sortMode === 'vulnerability'
                ? 'border border-[#c52828] text-[#c52828] bg-[#fef2f2] font-semibold'
                : 'border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4]'
            }`}
          >
            취약도순 (위험우선)
          </button>

          <button
            onClick={() => onChangeSortMode('recent_study')}
            className={`px-2.5 py-1 text-xs rounded-xs font-medium transition-all ${
              sortMode === 'recent_study'
                ? 'border border-[#c52828] text-[#c52828] bg-[#fef2f2] font-semibold'
                : 'border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4]'
            }`}
          >
            최근학습순
          </button>

          <button
            onClick={() => onChangeSortMode('chapter_order')}
            className={`px-2.5 py-1 text-xs rounded-xs font-medium transition-all ${
              sortMode === 'chapter_order'
                ? 'border border-[#c52828] text-[#c52828] bg-[#fef2f2] font-semibold'
                : 'border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4]'
            }`}
          >
            교재단원순
          </button>
        </div>
      </div>

      {/* Cards Rail (Desktop: Grid 5 cols, Tablet: Scroll / wrap, Mobile: Horizontal scroll) */}
      <div className="overflow-x-auto pb-1.5 pt-0.5 -mx-1 px-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 min-w-[320px] sm:min-w-0">
          {sortedConcepts.map((concept, index) => {
            const isSelected = concept.id === selectedConceptId;
            const isCompared = comparedConceptIds.includes(concept.id);
            const statusMeta = CONCEPT_STATUS_METADATA[concept.status];
            const displayIndex = String(index + 1).padStart(2, '0');

            return (
              <div
                key={concept.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isComparisonMode && onToggleCompareConcept) {
                    onToggleCompareConcept(concept.id);
                  } else {
                    onSelectConcept(concept.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (isComparisonMode && onToggleCompareConcept) {
                      onToggleCompareConcept(concept.id);
                    } else {
                      onSelectConcept(concept.id);
                    }
                  }
                }}
                className={`relative text-left p-3 rounded-xs border transition-all cursor-pointer flex flex-col justify-between select-none ${
                  isSelected && !isComparisonMode
                    ? 'border-[#c52828] bg-[#fdfcfb] shadow-xs ring-1 ring-[#c52828]'
                    : isCompared && isComparisonMode
                    ? 'border-[#2563eb] bg-[#eff6ff] shadow-xs ring-1 ring-[#2563eb]'
                    : 'border-[#ded6c8] bg-[#faf8f4] hover:bg-white hover:border-[#b8b0a2]'
                }`}
              >
                {/* Red top border accent when selected */}
                {isSelected && !isComparisonMode && (
                  <span className="absolute top-0 left-0 right-0 h-0.75 bg-[#c52828] rounded-t-xs" />
                )}

                <div>
                  {/* Top Status and Score */}
                  <div className="flex items-center justify-between gap-1 text-[11px] font-academic-mono mb-1.5">
                    <div className="flex items-center gap-1">
                      {isComparisonMode && (
                        <span className="text-[#827d73]">
                          {isCompared ? (
                            <CheckSquare className="w-3.5 h-3.5 text-[#2563eb]" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-[#827d73]" />
                          )}
                        </span>
                      )}
                      <span className={`font-semibold ${statusMeta.textClass}`}>
                        [{displayIndex}] {statusMeta.label}
                      </span>
                    </div>

                    <span
                      className={`font-bold text-xs ${
                        concept.status === 'unstudied'
                          ? 'text-[#827d73]'
                          : concept.currentScore < 50
                          ? 'text-[#c52828]'
                          : concept.currentScore < 70
                          ? 'text-amber-700'
                          : 'text-[#191817]'
                      }`}
                    >
                      {concept.status === 'unstudied' ? 'SCORE --' : `SCORE ${Math.round(concept.currentScore)}`}
                    </span>
                  </div>

                  {/* Origin Badge */}
                  <div className="mb-1">
                    {concept.isDemo ? (
                      <span className="text-[9.5px] font-academic-mono bg-[#f4f1ea] text-[#827d73] px-1 py-0.2 rounded border border-[#ded6c8]">
                        데모 개념
                      </span>
                    ) : (
                      <span className="text-[9.5px] font-academic-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-200 font-semibold">
                        자료 추출 승인
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-xs sm:text-[13px] font-bold text-[#191817] leading-snug line-clamp-2 min-h-[36px] font-academic-serif">
                    {concept.title}
                  </h3>
                </div>

                {/* Metadata footer */}
                <div className="mt-2.5 pt-2 border-t border-[#ede8de] space-y-0.5 text-[10px] sm:text-[11px] font-academic-mono text-[#57544e]">
                  <div className="flex justify-between items-center">
                    <span className="text-[#827d73]">최초 학습:</span>
                    <span className="text-[#191817]">
                      {concept.status === 'unstudied'
                        ? '미학습 대기'
                        : concept.firstLearnedAt
                        ? formatSeoulDate(concept.firstLearnedAt)
                        : `${concept.firstLearnedDayOffset ?? 0}일`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#827d73]">최근 풀이:</span>
                    <span className="text-[#191817]">
                      {concept.lastAttemptAt
                        ? getSeoulCalendarDiff(concept.lastAttemptAt, new Date()) === 0
                          ? '오늘'
                          : `${getSeoulCalendarDiff(concept.lastAttemptAt, new Date())}일 전`
                        : concept.lastAttemptDayOffset !== undefined
                        ? concept.lastAttemptDayOffset === 0
                          ? '오늘'
                          : `${concept.lastAttemptDayOffset}일 전`
                        : '미실시'}
                    </span>
                  </div>
                  {concept.postponeDays && concept.postponeDays > 0 ? (
                    <div className="flex justify-between items-center text-blue-700">
                      <span>일정 연기:</span>
                      <span className="font-semibold">+{concept.postponeDays}일 미룸</span>
                    </div>
                  ) : null}
                  <div className="truncate text-[#827d73] pt-0.5" title={concept.chapterRef}>
                    <span className="text-[#827d73]">REF:</span> {concept.chapterRef}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
