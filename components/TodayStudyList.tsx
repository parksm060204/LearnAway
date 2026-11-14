'use client';

import React from 'react';
import { Play, CalendarCheck, ArrowRight, Award } from 'lucide-react';
import type { StudyPlanItem } from '../lib/types';
import { Badge, Button, SectionCard } from './ui/WorkspacePrimitives';

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
    <SectionCard padding="md" id="today-review-panel" aria-label="오늘 복습" className="scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-[#c52828] shrink-0" />
          <h2 className="text-sm sm:text-base font-bold text-[#191817] font-academic-serif">오늘 복습</h2>
          {dayLabel && (
            <span className="text-xs font-academic-mono text-[#827d73]">{dayLabel}</span>
          )}
          {estimatedMinutesText && (
            <Badge variant="neutral" mono>
              {estimatedMinutesText}
            </Badge>
          )}
        </div>
        {pendingCount > items.length && (
          <Button variant="ghost" size="sm" onClick={onOpenAll}>
            <span>전체 보기 ({pendingCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {hasActiveSession && (
        <button
          type="button"
          onClick={onResumeMock}
          className="w-full mb-3 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#fef2f2] hover:bg-[#fee2e2] border border-[#fecaca] rounded-xs text-left transition-colors"
        >
          <span className="flex items-center gap-2 text-xs sm:text-[13px] font-bold text-[#c52828]">
            <Award className="w-4 h-4 shrink-0" />
            <span>진행 중인 모의시험 이어서 풀기</span>
          </span>
          <Play className="w-4 h-4 text-[#c52828] shrink-0" />
        </button>
      )}

      {items.length === 0 ? (
        <p className="text-xs sm:text-[13px] text-[#57544e] bg-[#faf8f4] border border-dashed border-[#ded6c8] rounded-xs px-4 py-5 text-center leading-relaxed break-keep">
          오늘 배정된 복습이 없습니다. 복습이 필요한 개념이 생기면 여기에 표시됩니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3.5 py-2.5 bg-[#faf8f4] hover:bg-white border border-[#e2ded6] hover:border-[#c8c2b5] rounded-xs transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs sm:text-[13px] font-bold text-[#191817] truncate">
                    {itemTitle(item)}
                  </span>
                  {typeof item.round === 'number' && (
                    <Badge variant="neutral" mono>
                      {item.round}회차
                    </Badge>
                  )}
                </div>
                {item.priorityReason && (
                  <p className="text-xs text-[#57544e] truncate mt-0.5" title={item.priorityReason}>
                    {item.priorityReason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                {item.estimatedMinutes > 0 && (
                  <span className="text-xs font-academic-mono text-[#827d73]">약 {item.estimatedMinutes}분</span>
                )}
                <Button variant="primary" size="sm" onClick={() => onStartItem(item)}>
                  <Play className="w-3.5 h-3.5" />
                  <span>시작</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
