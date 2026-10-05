'use client';

import React from 'react';
import { Play, CalendarCheck, ArrowRight, Award } from 'lucide-react';
import type { StudyPlanItem } from '../lib/types';

interface TodayStudyListProps {
  /** Today's date label, e.g. '2026.10.05 (월)'. Falls back to '오늘'. */
  dayLabel?: string;
  /** Top pending items for today (already sorted). */
  items: StudyPlanItem[];
  /** Total pending items today, including those beyond the visible slice. */
  pendingCount: number;
  /** '예상 NN분' when real data exists, otherwise null. */
  estimatedMinutesText: string | null;
  /** True when a resumable in-progress mock exam exists. */
  hasActiveSession: boolean;
  onStartItem: (item: StudyPlanItem) => void;
  onResumeMock: () => void;
  /** Full list: opens the study plan modal. */
  onOpenAll: () => void;
}

function itemTitle(item: StudyPlanItem): string {
  return item.conceptName || item.snapshotTitle || '학습 항목';
}

export function TodayStudyList({
  dayLabel,
  items,
  pendingCount,
  estimatedMinutesText,
  hasActiveSession,
  onStartItem,
  onResumeMock,
  onOpenAll,
}: TodayStudyListProps) {
  return (
    <section
      id="today-review-panel"
      aria-label="오늘 복습"
      className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-[#c52828]" />
          <h2 className="text-sm font-bold text-[#191817] font-academic-serif">오늘 복습</h2>
          {dayLabel && (
            <span className="text-[11px] font-academic-mono text-[#827d73]">{dayLabel}</span>
          )}
          {estimatedMinutesText && (
            <span className="text-[11px] font-academic-mono bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] px-2 py-0.5 rounded">
              {estimatedMinutesText}
            </span>
          )}
        </div>
        {pendingCount > items.length && (
          <button
            type="button"
            onClick={onOpenAll}
            className="flex items-center gap-1 text-xs font-semibold text-[#57544e] hover:text-[#c52828] transition-colors"
          >
            <span>전체 보기 ({pendingCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {hasActiveSession && (
        <button
          type="button"
          onClick={onResumeMock}
          className="w-full mb-2.5 flex items-center justify-between gap-2 px-3 py-2.5 bg-[#fef2f2] hover:bg-[#fee2e2] border border-[#fecaca] rounded-xs text-left transition-colors"
        >
          <span className="flex items-center gap-2 text-xs font-bold text-[#c52828]">
            <Award className="w-4 h-4" />
            <span>진행 중인 모의시험 이어서 풀기</span>
          </span>
          <Play className="w-4 h-4 text-[#c52828] shrink-0" />
        </button>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-[#57544e] bg-[#faf8f4] border border-dashed border-[#ded6c8] rounded-xs px-3 py-4 text-center leading-relaxed">
          오늘 배정된 복습이 없습니다. 복습이 필요한 개념이 생기면 여기에 표시됩니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[#faf8f4] hover:bg-white border border-[#e2ded6] hover:border-[#191817] rounded-xs transition-all"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-[#191817] truncate">{itemTitle(item)}</span>
                  {typeof item.round === 'number' && (
                    <span className="text-[10px] font-academic-mono bg-white border border-[#ded6c8] text-[#57544e] px-1.5 py-0.2 rounded">
                      {item.round}회차
                    </span>
                  )}
                </div>
                {item.priorityReason && (
                  <p className="text-[11px] text-[#57544e] truncate mt-0.5" title={item.priorityReason}>
                    {item.priorityReason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.estimatedMinutes > 0 && (
                  <span className="text-[11px] font-academic-mono text-[#827d73]">약 {item.estimatedMinutes}분</span>
                )}
                <button
                  type="button"
                  onClick={() => onStartItem(item)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[#191817] hover:bg-[#33302b] rounded-xs transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>시작</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
