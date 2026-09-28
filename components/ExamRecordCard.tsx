'use client';

import React from 'react';
import { Subject } from '../lib/types';
import { calculateDDay, formatExamDate } from '../lib/dateUtils';
import { Edit3, Sliders, Plus, Calendar, MapPin, Layers, FolderOpen } from 'lucide-react';

interface ExamRecordCardProps {
  subject: Subject;
  materialCount?: number;
  onOpenScheduleModal: () => void;
  onOpenScopeModal: () => void;
  onOpenUploadModal: () => void;
  onOpenMaterialsListModal?: () => void;
}

export function ExamRecordCard({
  subject,
  materialCount = 0,
  onOpenScheduleModal,
  onOpenScopeModal,
  onOpenUploadModal,
  onOpenMaterialsListModal,
}: ExamRecordCardProps) {
  const dday = calculateDDay(subject.examAt);

  return (
    <div className="w-full bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left Column: Exam metadata */}
        <div className="space-y-2.5 flex-1">
          {/* Title and Code Badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-academic-mono text-xs font-bold text-[#827d73] uppercase tracking-wider">
              EXAMINATION RECORD
            </span>
            <span className="text-[#c8c2b5]">|</span>
            <h1 className="text-base sm:text-lg font-bold text-[#191817] font-academic-serif tracking-tight">
              {subject.name}
            </h1>
            <span className="text-[11px] font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#57544e] px-2 py-0.5 rounded-xs">
              코드 {subject.code}
            </span>
            {subject.isDemo && (
              <span className="text-[10px] font-academic-mono bg-[#fef3c7] border border-[#fde68a] text-[#92400e] px-1.5 py-0.5 rounded-xs font-semibold">
                데모 데이터
              </span>
            )}
          </div>

          {/* Details Row: Date, Location */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#57544e]">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#827d73] shrink-0" />
              <span className="font-academic-mono font-medium text-[#827d73]">DATE</span>
              <span className="font-medium text-[#191817]">
                {formatExamDate(subject.examAt || '', subject.examEndTime)}
              </span>
            </div>

            <span className="hidden sm:inline text-[#e2ded6]">/</span>

            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#827d73] shrink-0" />
              <span className="font-academic-mono font-medium text-[#827d73]">LOC</span>
              <span className="font-medium text-[#191817]">{subject.location || '미정'}</span>
            </div>
          </div>

          {/* Scope Row */}
          <div className="flex items-start gap-1.5 text-xs text-[#57544e]">
            <Layers className="w-3.5 h-3.5 text-[#827d73] shrink-0 mt-0.5" />
            <span className="font-academic-mono font-medium text-[#827d73] shrink-0">SCOPE</span>
            <span className="font-medium text-[#191817] leading-relaxed">
              {subject.scope || '출제 범위 미설정'}
            </span>
          </div>
        </div>

        {/* Right Column: D-Day Badge + Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#f1ede4]">
          {/* D-Day Box */}
          <button
            type="button"
            onClick={onOpenScheduleModal}
            className={`border rounded-xs px-3.5 py-1.5 min-w-[130px] flex flex-col items-center justify-center text-center transition-all hover:ring-1 hover:ring-[#c52828] cursor-pointer ${
              dday.isNotSet
                ? 'border-[#c8c2b5] bg-[#faf8f4]'
                : dday.isOverdue
                ? 'border-[#827d73] bg-[#faf8f4]'
                : dday.isToday
                ? 'border-[#c52828] bg-[#fef2f2]'
                : 'border-[#c52828] bg-[#fefefe]'
            }`}
            title="클릭하여 시험일정 편집"
          >
            <span className="text-[10px] font-academic-mono tracking-widest text-[#827d73] uppercase font-semibold">
              {dday.isNotSet ? 'STATUS' : 'REMAINING'}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-xl sm:text-2xl font-bold font-academic-serif tracking-tight ${
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
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenScheduleModal}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] rounded-xs shadow-2xs hover:border-[#191817] transition-all"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#827d73]" />
              <span>시험일정 변경</span>
            </button>

            <button
              onClick={onOpenScopeModal}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] rounded-xs shadow-2xs hover:border-[#191817] transition-all"
            >
              <Sliders className="w-3.5 h-3.5 text-[#827d73]" />
              <span>출제범위 관리</span>
            </button>

            {onOpenMaterialsListModal && (
              <button
                onClick={onOpenMaterialsListModal}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#191817] bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] rounded-xs shadow-2xs hover:border-[#191817] transition-all"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#c52828]" />
                <span>자료 보관함</span>
                <span className="text-[10px] font-academic-mono bg-[#f4f1ea] px-1.5 py-0.2 rounded text-[#57544e]">
                  {materialCount}
                </span>
              </button>
            )}

            <button
              onClick={onOpenUploadModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#191817] hover:bg-[#33302b] rounded-xs shadow-xs transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>자료 등록</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
