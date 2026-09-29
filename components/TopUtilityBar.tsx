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
  Plus,
  FolderOpen,
  Sparkles,
  FileQuestion,
  ShieldAlert,
} from 'lucide-react';

interface TopUtilityBarProps {
  subjects: Subject[];
  activeSubject: Subject;
  onSelectSubject: (subjectId: string) => void;
  onOpenAddSubject: () => void;
  onOpenUpload: () => void;
  onOpenMaterialsList?: () => void;
  onOpenConceptReview?: () => void;
  draftCount?: number;
  onOpenProblemGenerator?: () => void;
  onOpenProblemReview?: () => void;
  problemDraftCount?: number;
  problemReportedCount?: number;
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
  onOpenAddSubject,
  onOpenUpload,
  onOpenMaterialsList,
  onOpenConceptReview,
  draftCount = 0,
  onOpenProblemGenerator,
  onOpenProblemReview,
  problemDraftCount = 0,
  problemReportedCount = 0,
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
              {activeSubject.isDemo && (
                <span className="text-[10px] font-academic-mono bg-[#f4f1ea] text-[#827d73] px-1.5 py-0.5 rounded-xs border border-[#ded6c8]">
                  데모
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-[#827d73]" />
            </button>

            {isDropdownOpen && (
              <div className="absolute left-0 mt-1 w-80 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                <div className="px-3 py-1.5 text-[11px] font-academic-mono text-[#827d73] border-b border-[#f1ede4] bg-[#faf8f4] flex justify-between items-center">
                  <span>과목 폴더 선택</span>
                  <span>{subjects.length}개 보관</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
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
                        <div className="font-medium flex items-center gap-1.5">
                          <span>{sub.name}</span>
                          {sub.isDemo && (
                            <span className="text-[9.5px] font-academic-mono text-[#827d73] border border-[#ded6c8] px-1 rounded-2xs">
                              데모
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#827d73] font-academic-mono">
                          {sub.code} · {sub.domain === 'math_stats' ? '수학/수리통계' : '컴퓨터공학/코딩'}
                        </div>
                      </div>
                      {sub.id === activeSubject.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#c52828]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Create New Subject Button */}
                <div className="p-1.5 border-t border-[#f1ede4] bg-[#faf8f4]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onOpenAddSubject();
                    }}
                    className="w-full py-1.5 px-2.5 text-xs font-bold text-[#191817] hover:text-[#c52828] hover:bg-white border border-[#ded6c8] rounded-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#c52828]" />
                    <span>+ 새 과목 폴더 추가</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1 text-xs">
          <button
            onClick={onOpenAddSubject}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[#c52828] hover:bg-[#fef2f2] border border-[#fecaca] font-semibold transition-colors mr-1"
          >
            <Plus className="w-3.5 h-3.5 text-[#c52828]" />
            <span>과목 추가</span>
          </button>

          <button
            onClick={onOpenUpload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-[#827d73]" />
            <span>자료 등록</span>
          </button>

          {onOpenMaterialsList && (
            <button
              onClick={onOpenMaterialsList}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#c52828]" />
              <span>자료 보관함</span>
            </button>
          )}

          {onOpenConceptReview && (
            <button
              onClick={onOpenConceptReview}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
              title="AI 개념 추출 및 검토"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>개념 검토</span>
              {draftCount > 0 && (
                <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-800 border border-amber-300 px-1 rounded-full font-bold">
                  {draftCount}
                </span>
              )}
            </button>
          )}

          {onOpenProblemReview && (
            <button
              onClick={onOpenProblemReview}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
              title="AI 시험 문제 검토, 승인 및 신고 관리"
            >
              <FileQuestion className="w-3.5 h-3.5 text-blue-600" />
              <span>문제 검토</span>
              {problemDraftCount > 0 && (
                <span
                  className="text-[10px] font-academic-mono bg-blue-100 text-blue-800 border border-blue-300 px-1.5 py-0.2 rounded-full font-bold"
                  title={`초안 ${problemDraftCount}건`}
                >
                  {problemDraftCount}
                </span>
              )}
              {problemReportedCount > 0 && (
                <span
                  className="text-[10px] font-academic-mono bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.2 rounded-full font-bold flex items-center gap-0.5"
                  title={`신고/검토 필요 문제 ${problemReportedCount}건`}
                >
                  <ShieldAlert className="w-2.5 h-2.5 text-red-600" />
                  {problemReportedCount}
                </span>
              )}
            </button>
          )}

          {onOpenProblemGenerator && (
            <button
              onClick={onOpenProblemGenerator}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[#191817] hover:bg-[#faf8f4] border border-[#ded6c8] font-semibold transition-colors mr-1"
              title="AI 고난도 문제 출제"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>문제 출제</span>
            </button>
          )}

          <button
            onClick={onOpenProblemSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent hover:border-[#e2ded6] transition-colors"
          >
            <PenTool className="w-3.5 h-3.5 text-[#827d73]" />
            <span>문제 풀기</span>
          </button>

          <button
            onClick={onOpenMockExam}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-[#827d73] hover:text-[#57544e] hover:bg-[#faf8f4] border border-transparent transition-colors"
          >
            <Award className="w-3.5 h-3.5 text-[#827d73]" />
            <span>모의시험</span>
            <span className="text-[10px] font-academic-mono bg-[#f4f1ea] px-1 rounded-2xs text-[#827d73]">
              준비 중
            </span>
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
            <span>자료 등록 (PDF / 전사본)</span>
          </button>

          {onOpenMaterialsList && (
            <button
              onClick={() => {
                onOpenMaterialsList();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <FolderOpen className="w-4 h-4 text-[#c52828]" />
              <span>과목 자료 보관함</span>
            </button>
          )}

          {onOpenConceptReview && (
            <button
              onClick={() => {
                onOpenConceptReview();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <span>개념 검토 및 승인</span>
              </div>
              {draftCount > 0 && (
                <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-bold">
                  {draftCount}
                </span>
              )}
            </button>
          )}

          {onOpenProblemReview && (
            <button
              onClick={() => {
                onOpenProblemReview();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <div className="flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-blue-600" />
                <span>문제 검토 및 승인</span>
              </div>
              <div className="flex items-center gap-1.5">
                {problemDraftCount > 0 && (
                  <span className="text-[10px] font-academic-mono bg-blue-100 text-blue-800 border border-blue-300 px-1.5 py-0.5 rounded-full font-bold">
                    초안 {problemDraftCount}
                  </span>
                )}
                {problemReportedCount > 0 && (
                  <span className="text-[10px] font-academic-mono bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                    <ShieldAlert className="w-2.5 h-2.5 text-red-600" />
                    신고 {problemReportedCount}
                  </span>
                )}
              </div>
            </button>
          )}

          {onOpenProblemGenerator && (
            <button
              onClick={() => {
                onOpenProblemGenerator();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>AI 고난도 시험 문제 출제</span>
            </button>
          )}

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
