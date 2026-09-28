'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import {
  BookOpen,
  Upload,
  PenTool,
  Award,
  CalendarCheck,
  Settings,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react';

interface TopUtilityBarProps {
  subjects: Subject[];
  activeSubject: Subject;
  onSelectSubject: (subjectId: string) => void;
  onOpenUpload: () => void;
  onOpenProblemSession: () => void;
  onOpenMockExam: () => void;
  onOpenSettings: () => void;
  onScrollToTodayReview: () => void;
  activeView: 'dashboard' | 'session' | 'materials';
}

export function TopUtilityBar({
  subjects,
  activeSubject,
  onSelectSubject,
  onOpenUpload,
  onOpenProblemSession,
  onOpenMockExam,
  onOpenSettings,
  onScrollToTodayReview,
  activeView,
}: TopUtilityBarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header className="w-full bg-[#ffffff] border-b border-[#e2ded6] sticky top-0 z-40 shadow-xs">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-13 flex items-center justify-between">
        {/* Left: Brand + Subject Selector */}
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-[#c52828] inline-block shrink-0" aria-hidden="true" />
            <span className="font-extrabold tracking-wider text-base font-academic-mono text-[#191817]">
              REDCALL
            </span>
            <span className="text-[11px] font-academic-mono tracking-wider px-1.5 py-0.5 border border-[#c8c2b5] bg-[#faf8f4] text-[#57544e] rounded-xs font-medium">
              ACADEMIC V2.4
            </span>
          </div>

          <span className="hidden sm:inline text-[#c8c2b5]">|</span>

          {/* Subject Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#191817] hover:text-[#c52828] transition-colors py-1 px-2 rounded-xs border border-transparent hover:border-[#e2ded6] hover:bg-[#faf8f4]"
              aria-expanded={isDropdownOpen}
              aria-label="과목 선택 드롭다운"
            >
              <span className="text-[#827d73] font-academic-mono text-xs">REF:{activeSubject.code.replace('§', '')}</span>
              <span className="truncate max-w-[140px] sm:max-w-[220px]">{activeSubject.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#827d73]" />
            </button>

            {isDropdownOpen && (
              <div className="absolute left-0 mt-1 w-72 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                <div className="px-3 py-1.5 text-[11px] font-academic-mono text-[#827d73] border-b border-[#f1ede4] bg-[#faf8f4]">
                  과목 전환 (과목별 데이터 격리)
                </div>
                {subjects.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => {
                      onSelectSubject(sub.id);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[#faf8f4] transition-colors ${
                      sub.id === activeSubject.id
                        ? 'font-bold text-[#c52828] bg-[#fef2f2]'
                        : 'text-[#191817]'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{sub.name}</div>
                      <div className="text-[11px] text-[#827d73] font-academic-mono">
                        {sub.code} · {sub.domain === 'math_stats' ? '수리통계/대학수학' : '컴퓨터공학/알고리즘'}
                      </div>
                    </div>
                    {sub.id === activeSubject.id && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#c52828]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1 text-xs">
          <button
            onClick={onOpenUpload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-[#827d73]" />
            <span>자료 업로드</span>
          </button>

          <button
            onClick={onOpenProblemSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
          >
            <PenTool className="w-3.5 h-3.5 text-[#827d73]" />
            <span>문제 풀기</span>
          </button>

          <button
            onClick={onOpenMockExam}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
          >
            <Award className="w-3.5 h-3.5 text-[#827d73]" />
            <span>모의시험</span>
          </button>

          <button
            onClick={onScrollToTodayReview}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#191817] bg-[#faf8f4] hover:bg-[#f1ede4] border border-[#e2ded6] font-semibold transition-colors"
          >
            <CalendarCheck className="w-3.5 h-3.5 text-[#c52828]" />
            <span>오늘의 복습 패널</span>
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 text-[#827d73] hover:text-[#191817] hover:bg-[#faf8f4] rounded-xs transition-colors ml-1"
            title="모델 및 시연 파라미터 설정"
            aria-label="설정"
          >
            <Settings className="w-4 h-4" />
          </button>
        </nav>

        {/* Mobile menu toggle */}
        <div className="flex lg:hidden items-center gap-1">
          <button
            onClick={onScrollToTodayReview}
            className="text-xs bg-[#faf8f4] border border-[#e2ded6] px-2 py-1 rounded-xs font-semibold text-[#c52828]"
          >
            복습
          </button>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            aria-label="모바일 메뉴 열기"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-[#e2ded6] bg-white px-4 py-3 space-y-2">
          <button
            onClick={() => {
              onOpenUpload();
              setIsMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
          >
            <Upload className="w-4 h-4 text-[#827d73]" />
            <span>자료 업로드 (PDF / 전사본)</span>
          </button>

          <button
            onClick={() => {
              onOpenProblemSession();
              setIsMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
          >
            <PenTool className="w-4 h-4 text-[#827d73]" />
            <span>문제 풀기 (서술·논술형)</span>
          </button>

          <button
            onClick={() => {
              onOpenMockExam();
              setIsMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
          >
            <Award className="w-4 h-4 text-[#827d73]" />
            <span>모의시험 안내</span>
          </button>

          <button
            onClick={() => {
              onOpenSettings();
              setIsMobileMenuOpen(false);
            }}
            className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
          >
            <Settings className="w-4 h-4 text-[#827d73]" />
            <span>시연 파라미터 및 모델 설정</span>
          </button>
        </div>
      )}
    </header>
  );
}
