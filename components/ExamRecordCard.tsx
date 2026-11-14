'use client';

import React from 'react';
import { Subject } from '../lib/types';
import { calculateDDay, formatExamDate } from '../lib/dateUtils';
import { Edit3, Sliders, Calendar, MapPin, Layers, Play } from 'lucide-react';
import { Badge, Button, SectionCard } from './ui/WorkspacePrimitives';

interface ExamRecordCardProps {
  subject: Subject;
  /** @deprecated kept for compatibility; no longer rendered */
  materialCount?: number;
  onOpenScheduleModal: () => void;
  onOpenScopeModal: () => void;
  /** @deprecated kept for compatibility; upload moved to the 자료 menu */
  onOpenUploadModal?: () => void;
  /** @deprecated kept for compatibility; list moved to the 자료 menu */
  onOpenMaterialsListModal?: () => void;
  /** @deprecated kept for compatibility; plans open from 오늘 복습 */
  onOpenStudyPlanModal?: () => void;
  /** Primary call-to-action: '오늘 복습 시작' or '이어서 풀기'. */
  onPrimaryAction?: () => void;
  primaryLabel?: string;
  /** Shown only when real data exists (e.g. '예상 40분'). */
  estimatedMinutesText?: string | null;
}

export function ExamRecordCard({
  subject,
  onOpenScheduleModal,
  onOpenScopeModal,
  onPrimaryAction,
  primaryLabel,
  estimatedMinutesText,
}: ExamRecordCardProps) {
  const dday = calculateDDay(subject.examAt);

  return (
    <SectionCard padding="md">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left Column: Exam metadata */}
        <div className="space-y-2 flex-1 min-w-0">
          {/* Title and Code Badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#827d73] tracking-wide">
              과목 요약
            </span>
            <span className="text-[#c8c2b5]" aria-hidden="true">|</span>
            <h1 className="text-base sm:text-lg font-bold text-[#191817] font-academic-serif tracking-tight break-keep">
              {subject.name}
            </h1>
            {subject.isDemo && (
              <Badge variant="warning" mono>
                데모 데이터
              </Badge>
            )}
          </div>

          {/* Details Row: Date, Location */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-[13px] text-[#57544e]">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#827d73] shrink-0" />
              <span className="text-[#827d73]">시험일</span>
              <span className="font-medium text-[#191817]">
                {formatExamDate(subject.examAt || '', subject.examEndTime)}
              </span>
            </div>

            <span className="hidden sm:inline text-[#e2ded6]" aria-hidden="true">/</span>

            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#827d73] shrink-0" />
              <span className="text-[#827d73]">장소</span>
              <span className="font-medium text-[#191817]">{subject.location || '미정'}</span>
            </div>
          </div>

          {/* Scope Row */}
          <div className="flex items-start gap-1.5 text-xs sm:text-[13px] text-[#57544e]">
            <Layers className="w-3.5 h-3.5 text-[#827d73] shrink-0 mt-0.5" />
            <span className="text-[#827d73] shrink-0">출제 범위</span>
            <span className="font-medium text-[#191817] leading-relaxed break-keep">
              {subject.scope || '출제 범위 미설정'}
            </span>
          </div>
        </div>

        {/* Right Column: D-Day Badge + Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-[#f1ede4]">
          {/* D-Day Box */}
          <button
            type="button"
            onClick={onOpenScheduleModal}
            className={`border rounded-xs px-3.5 py-1.5 min-w-[120px] flex flex-col items-center justify-center text-center transition-colors hover:border-[#c52828] cursor-pointer ${
              dday.isNotSet
                ? 'border-[#c8c2b5] bg-[#faf8f4]'
                : dday.isOverdue
                ? 'border-[#827d73] bg-[#faf8f4]'
                : dday.isToday
                ? 'border-[#c52828] bg-[#fef2f2]'
                : 'border-[#c52828] bg-white'
            }`}
            title="클릭하여 시험일정 편집"
          >
            <span className="text-[11px] text-[#827d73] font-medium">
              {dday.isNotSet ? '상태' : '남은 기간'}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-lg sm:text-xl font-bold font-academic-serif tracking-tight ${
                  dday.isNotSet ? 'text-[#57544e]' : 'text-[#c52828]'
                }`}
              >
                {dday.displayBadge}
              </span>
              {dday.hoursDisplay && !dday.isOverdue && !dday.isNotSet && (
                <span className="text-xs font-academic-mono text-[#827d73]">
                  ({dday.hoursDisplay})
                </span>
              )}
            </div>
          </button>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {onPrimaryAction && primaryLabel && (
              <Button
                variant="accent"
                size="md"
                onClick={onPrimaryAction}
                title={estimatedMinutesText ? `오늘 학습 시작 (${estimatedMinutesText})` : '오늘 학습 시작'}
              >
                <Play className="w-3.5 h-3.5" />
                <span>{primaryLabel}</span>
                {estimatedMinutesText && (
                  <span className="text-[11px] font-academic-mono font-medium opacity-90">
                    · {estimatedMinutesText}
                  </span>
                )}
              </Button>
            )}

            <Button variant="secondary" size="md" onClick={onOpenScheduleModal}>
              <Edit3 className="w-3.5 h-3.5 text-[#827d73]" />
              <span>시험일정 변경</span>
            </Button>

            <Button variant="secondary" size="md" onClick={onOpenScopeModal}>
              <Sliders className="w-3.5 h-3.5 text-[#827d73]" />
              <span>출제범위 관리</span>
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
