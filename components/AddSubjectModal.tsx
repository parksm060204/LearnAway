'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import { calculateDDay } from '../lib/dateUtils';
import { X, Plus, Check } from 'lucide-react';

interface AddSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSubject: (subject: Subject) => void;
}

export function AddSubjectModal({ isOpen, onClose, onAddSubject }: AddSubjectModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [semester] = useState('2026-2');
  const [examDate, setExamDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState('');
  const [domain, setDomain] = useState<'math_stats' | 'computer_science'>('math_stats');

  if (!isOpen) return null;

  // Real-time D-day calculation for preview
  const previewIso = examDate ? `${examDate}T${startTime}:00+09:00` : undefined;
  const ddayResult = calculateDDay(previewIso);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('과목 이름을 입력해 주세요.');
      return;
    }

    const cleanCode = code.trim() || `§${new Date().getFullYear()}-${domain === 'math_stats' ? 'MATH' : 'CS'}-${Math.floor(Math.random() * 90 + 10)}`;

    const newSubject: Subject = {
      id: `subj-${Date.now()}`,
      ownerId: 'local-user',
      name: name.trim(),
      code: cleanCode.startsWith('§') ? cleanCode : `§${cleanCode}`,
      semester: semester.trim() || '2026-2',
      examAt: previewIso,
      examEndTime: endTime || undefined,
      location: location.trim() || undefined,
      timezone: 'Asia/Seoul',
      scope: scope.trim() || '출제 범위 미설정',
      chapters: scope.trim() ? [scope.trim()] : [],
      lastEvaluatedAt: new Date().toISOString(),
      engineName: 'REDCALL-EBBINGHAUS-DECAY-v4',
      domain,
      isDemo: false,
    };

    onAddSubject(newSubject);
    onClose();

    // Reset form
    setName('');
    setCode('');
    setExamDate('');
    setLocation('');
    setScope('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-lg bg-white border border-[#c8c2b5] rounded-xs shadow-xl my-auto overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">새 과목 폴더 생성 및 시험일 설정</h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans">
          {/* Live D-day preview banner */}
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
            <div className="text-[11px] font-academic-mono text-[#827d73]">
              실시간 D-Day 산출 미리보기 (Asia/Seoul 기준):
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-xl font-academic-serif font-bold ${
                  ddayResult.isNotSet
                    ? 'text-[#827d73]'
                    : ddayResult.isOverdue
                    ? 'text-[#827d73]'
                    : ddayResult.isToday
                    ? 'text-[#c52828]'
                    : 'text-[#c52828]'
                }`}
              >
                {ddayResult.displayBadge}
              </span>
              {ddayResult.hoursDisplay && !ddayResult.isOverdue && (
                <span className="text-xs font-academic-mono text-[#827d73]">
                  ({ddayResult.hoursDisplay} 잔여)
                </span>
              )}
              {examDate ? (
                <span className="text-[11px] text-[#57544e]">
                  {examDate} {startTime} ~ {endTime}
                </span>
              ) : (
                <span className="text-[11px] text-[#827d73]">(시험일을 설정하지 않으면 &apos;시험일 설정&apos;으로 유지됩니다)</span>
              )}
            </div>
          </div>

          {/* Subject Name and Code */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                과목명 <span className="text-[#c52828]">*</span>:
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 수치해석학 및 프로그래밍"
                required
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817] font-medium"
              />
            </div>

            <div>
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                과목 코드:
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="예: §2026-MATH-03"
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817] font-academic-mono"
              />
            </div>
          </div>

          {/* Domain Category */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              시험 계열 (문제 유형 및 도메인 분류):
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDomain('math_stats')}
                className={`p-2 rounded-xs border text-left flex items-center justify-between ${
                  domain === 'math_stats'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <span>수학 / 수리통계 계열</span>
                <span className="text-[10px] font-academic-mono text-[#827d73]">증명·유도</span>
              </button>

              <button
                type="button"
                onClick={() => setDomain('computer_science')}
                className={`p-2 rounded-xs border text-left flex items-center justify-between ${
                  domain === 'computer_science'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <span>컴퓨터공학 / 코딩 계열</span>
                <span className="text-[10px] font-academic-mono text-[#827d73]">구현·알고리즘</span>
              </button>
            </div>
          </div>

          {/* Exam Date & Time (Optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                시험일 (선택):
              </label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
              />
            </div>

            <div>
              <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                시작 시각:
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={!examDate}
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817] disabled:opacity-50"
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
                disabled={!examDate}
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817] disabled:opacity-50"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              시험 장소 / 고사장 (선택):
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="예: 공학관 301호 (실습실) 또는 301관 402호"
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
          </div>

          {/* Scope */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
              시험 출제 범위 요약 (선택):
            </label>
            <input
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="예: 제1장 ~ 제5장 [비선형방정식의 해, 오차론, 수치적분]"
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
            />
          </div>

          {/* Footer buttons */}
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
              <span>과목 생성 및 선택</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
