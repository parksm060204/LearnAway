'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import { buildSeoulIsoTimestamp, calculateDDay } from '../lib/dateUtils';
import { Plus, Check } from 'lucide-react';
import { TimeDialPicker } from './TimeDialPicker';
import { Button, Input } from './ui/WorkspacePrimitives';
import { ModalShell } from './ui/ModalShell';

interface AddSubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSubject: (subject: Subject) => void;
}

/** New subject ids are UUIDs; legacy string ids remain valid in the schema. */
function createSubjectId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `subj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AddSubjectModal({ isOpen, onClose, onAddSubject }: AddSubjectModalProps) {
  const [name, setName] = useState('');
  const [semester] = useState('2026-2');
  const [examDate, setExamDate] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState('');
  const [domain, setDomain] = useState<'math_stats' | 'computer_science'>('math_stats');

  if (!isOpen) return null;

  // Real-time D-day calculation for preview
  const previewIso = examDate ? buildSeoulIsoTimestamp(examDate, startTime || '10:00') || undefined : undefined;
  const ddayResult = calculateDDay(previewIso);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('과목 이름을 입력해 주세요.');
      return;
    }

    const autoCode = `${new Date().getFullYear()}-${domain === 'math_stats' ? 'MATH' : 'CS'}-${Math.floor(Math.random() * 90 + 10)}`;

    const newSubject: Subject = {
      id: createSubjectId(),
      ownerId: 'local-user',
      name: name.trim(),
      code: autoCode,
      semester: semester.trim() || '2026-2',
      examAt: previewIso,
      examEndTime: endTime || undefined,
      location: location.trim() || undefined,
      timezone: 'Asia/Seoul',
      scope: scope.trim() || '출제 범위 미설정',
      chapters: scope.trim() ? [scope.trim()] : [],
      lastEvaluatedAt: new Date().toISOString(),
      engineName: 'LEARN-MY-WAY-EBBINGHAUS-DECAY-v4',
      domain,
      isDemo: false,
    };

    onAddSubject(newSubject);
    onClose();

    // Reset form
    setName('');
    setExamDate('');
    setLocation('');
    setScope('');
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="새 과목 폴더 생성 및 시험일 설정"
      icon={<Plus className="w-4 h-4 text-[#c52828]" />}
      maxWidthClass="max-w-lg"
    >
      {/* Form Body */}
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans">
          {/* Live D-day preview banner */}
          <div className="p-3.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
            <div className="text-xs text-[#57544e] font-medium">
              실시간 D-Day 산출 미리보기 (Asia/Seoul 기준)
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={`text-xl font-academic-serif font-bold ${
                  ddayResult.isNotSet || ddayResult.isOverdue
                    ? 'text-[#827d73]'
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
                <span className="text-xs font-academic-mono text-[#57544e]">
                  {examDate} {startTime} ~ {endTime}
                </span>
              ) : (
                <span className="text-xs text-[#827d73]">(시험일을 설정하지 않으면 &apos;시험일 설정&apos;으로 유지됩니다)</span>
              )}
            </div>
          </div>

          {/* Subject Name */}
          <div>
            <label htmlFor="add-subject-name" className="block text-xs font-semibold text-[#57544e] mb-1.5">
              과목명 <span className="text-[#c52828]">*</span>
            </label>
            <Input
              id="add-subject-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 수치해석학 및 프로그래밍"
              required
              className="bg-white font-medium"
            />
          </div>

          {/* Domain Category */}
          <div>
            <span className="block text-xs font-semibold text-[#57544e] mb-1.5">
              시험 계열 (문제 유형 및 도메인 분류)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDomain('math_stats')}
                className={`p-2.5 rounded-xs border text-left flex items-center justify-between gap-2 transition-colors ${
                  domain === 'math_stats'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e] hover:bg-white'
                }`}
              >
                <span>수학 / 수리통계 계열</span>
                <span className="text-[11px] font-academic-mono text-[#827d73]">증명·유도</span>
              </button>

              <button
                type="button"
                onClick={() => setDomain('computer_science')}
                className={`p-2.5 rounded-xs border text-left flex items-center justify-between gap-2 transition-colors ${
                  domain === 'computer_science'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e] hover:bg-white'
                }`}
              >
                <span>컴퓨터공학 / 코딩 계열</span>
                <span className="text-[11px] font-academic-mono text-[#827d73]">구현·알고리즘</span>
              </button>
            </div>
          </div>

          {/* Exam Date & Time (Optional) */}
          <div className="space-y-3">
            <div>
              <label htmlFor="add-subject-exam-date" className="block text-xs font-semibold text-[#57544e] mb-1.5">
                시험일 (선택)
              </label>
              <Input
                id="add-subject-exam-date"
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <TimeDialPicker
                  label="시작 시각"
                  value={startTime}
                  onChange={setStartTime}
                  disabled={!examDate}
                />
              </div>

              <div>
                <TimeDialPicker
                  label="종료 시각"
                  value={endTime}
                  onChange={setEndTime}
                  disabled={!examDate}
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div>
            <label htmlFor="add-subject-location" className="block text-xs font-semibold text-[#57544e] mb-1.5">
              시험 장소 / 고사장 (선택)
            </label>
            <Input
              id="add-subject-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="예: 공학관 301호 (실습실) 또는 301관 402호"
              className="bg-white"
            />
          </div>

          {/* Scope */}
          <div>
            <label htmlFor="add-subject-scope" className="block text-xs font-semibold text-[#57544e] mb-1.5">
              시험 출제 범위 요약 (선택)
            </label>
            <Input
              id="add-subject-scope"
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="예: 제1장 ~ 제5장 [비선형방정식의 해, 오차론, 수치적분]"
              className="bg-white"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f1ede4]">
            <Button variant="secondary" size="md" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" variant="primary" size="md">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>과목 생성 및 선택</span>
            </Button>
          </div>
      </form>
    </ModalShell>
  );
}
