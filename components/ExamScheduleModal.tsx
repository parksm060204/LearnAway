'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import { toSeoulDateString, calculateDDay } from '../lib/dateUtils';
import { X, Calendar, Check } from 'lucide-react';

interface ExamScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  subject: Subject;
  onUpdateSubject: (updated: Subject) => void;
}

export function ExamScheduleModal({
  isOpen,
  onClose,
  subject,
  onUpdateSubject,
}: ExamScheduleModalProps) {
  // Extract initial date and time
  const currentSeoulDate = subject.examAt ? toSeoulDateString(subject.examAt) : '';
  const initialTime = subject.examAt ? new Date(subject.examAt).toTimeString().slice(0, 5) : '10:00';

  const [dateStr, setDateStr] = useState(currentSeoulDate);
  const [startTime, setStartTime] = useState(initialTime);
  const [endTime, setEndTime] = useState(subject.examEndTime || '12:00');
  const [location, setLocation] = useState(subject.location || '');

  if (!isOpen) return null;

  // Real-time preview calculation
  const previewIso = dateStr ? `${dateStr}T${startTime || '10:00'}:00+09:00` : undefined;
  const previewDDay = calculateDDay(previewIso);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedSubject: Subject = {
      ...subject,
      examAt: previewIso,
      examEndTime: dateStr ? endTime : undefined,
      location,
    };
    onUpdateSubject(updatedSubject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-[#c8c2b5] rounded-xs shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">시험 일정 및 장소 변경</h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-5 space-y-4 text-xs font-sans">
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
            <div className="text-[11px] font-academic-mono text-[#827d73]">
              실시간 D-Day 산출 미리보기 (Asia/Seoul 기준):
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-academic-serif font-bold text-[#c52828]">
                {previewDDay.displayBadge}
              </span>
              {previewDDay.hoursDisplay && (
                <span className="text-xs font-academic-mono text-[#827d73]">
                  (약 {previewDDay.hoursDisplay} 잔여)
                </span>
              )}
              <span className="text-[11px] text-[#57544e]">
                {dateStr} {startTime} ~ {endTime}
              </span>
            </div>
            <p className="text-[10.5px] text-[#827d73] pt-0.5">
              ※ 시험일을 변경해도 과거의 모든 학습 및 풀이 이력은 무결하게 보존됩니다.
            </p>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block font-academic-mono text-[11px] text-[#57544e]">
                시험 날짜 (Asia/Seoul, 선택):
              </label>
              {dateStr && (
                <button
                  type="button"
                  onClick={() => setDateStr('')}
                  className="text-[10px] text-[#c52828] hover:underline font-academic-mono"
                >
                  시험일 미설정으로 초기화
                </button>
              )}
            </div>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                시작 시각:
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
              />
            </div>
            <div>
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                종료 시각:
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
              />
            </div>
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              시험 장소 / 고사장:
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="예: 301관 402호 (대강의실)"
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>일정 저장 및 즉시 반영</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
