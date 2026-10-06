'use client';

import React, { useState } from 'react';
import { Subject } from '../lib/types';
import {
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
  BarChart3,
  LogOut,
} from 'lucide-react';

export type DashboardTab = 'today' | 'materials' | 'problems' | 'history' | 'settings';

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
  onOpenStudyPlan?: () => void;
  onOpenLearningAnalytics?: () => void;
  onOpenProblemSession: () => void;
  onOpenMockExam: () => void;
  onOpenSettings: () => void;
  onScrollToTodayReview: () => void;
  activeTab?: DashboardTab;
  onSelectTab?: (tab: DashboardTab) => void;
  userEmail?: string | null;
  onLogout?: () => void;
  isLoggingOut?: boolean;
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
  onOpenLearningAnalytics,
  onOpenProblemSession,
  onOpenMockExam,
  onOpenSettings,
  onScrollToTodayReview,
  activeTab = 'today',
  onSelectTab,
  userEmail,
  onLogout,
  isLoggingOut = false,
}: TopUtilityBarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'materials' | 'problems' | null>(null);

  const closeMenus = () => {
    setOpenMenu(null);
    setIsDropdownOpen(false);
  };

  return (
    <header className="w-full bg-[#ffffff] border-b border-[#e2ded6] sticky top-0 z-40 shadow-xs">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-13 flex items-center justify-between">
        {/* Left: Brand + Subject Selector */}
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-[#c52828] inline-block shrink-0" aria-hidden="true" />
            <span className="font-extrabold tracking-wider text-base font-academic-mono text-[#191817]">
              Learn my way
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

        {/* Right Desktop Nav: five main menus */}
        <nav className="hidden lg:flex items-center gap-1 text-xs">
          <button
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('today');
              else onScrollToTodayReview();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xs transition-colors font-bold ${
              activeTab === 'today'
                ? 'bg-[#191817] text-white shadow-xs'
                : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
            }`}
            title="오늘의 학습 요약으로 이동"
          >
            <CalendarCheck className={`w-3.5 h-3.5 ${activeTab === 'today' ? 'text-white' : 'text-[#c52828]'}`} />
            <span>오늘 학습</span>
          </button>

          {/* 자료: 등록 · 보관함 · 개념 검토 (재연결은 보관함 안) */}
          <div className="relative flex items-center">
            <button
              onClick={() => {
                closeMenus();
                if (onSelectTab) onSelectTab('materials');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xs transition-colors font-bold ${
                activeTab === 'materials'
                  ? 'bg-[#191817] text-white shadow-xs'
                  : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
              }`}
              title="과목별 학습 자료 관리"
            >
              <FolderOpen className={`w-3.5 h-3.5 ${activeTab === 'materials' ? 'text-white' : 'text-[#c52828]'}`} />
              <span>자료</span>
              {draftCount > 0 && (
                <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-800 border border-amber-300 px-1 rounded-full font-bold">
                  {draftCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'materials' ? null : 'materials')}
              className={`p-1 rounded-xs transition-colors ${
                activeTab === 'materials' ? 'text-white hover:bg-white/20' : 'text-[#827d73] hover:text-[#191817]'
              }`}
              aria-label="자료 바로가기 메뉴"
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {openMenu === 'materials' && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                <button
                  onClick={() => {
                    closeMenus();
                    onOpenUpload();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                >
                  <Upload className="w-4 h-4 text-[#827d73]" />
                  <span>자료 등록 (PDF / 전사본)</span>
                </button>
                {onOpenMaterialsList && (
                  <button
                    onClick={() => {
                      closeMenus();
                      if (onSelectTab) onSelectTab('materials');
                      else onOpenMaterialsList();
                    }}
                    className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                  >
                    <FolderOpen className="w-4 h-4 text-[#c52828]" />
                    <span>자료 보관함 열기</span>
                  </button>
                )}
                {onOpenConceptReview && (
                  <button
                    onClick={() => {
                      closeMenus();
                      onOpenConceptReview();
                    }}
                    className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                    title="AI 개념 추출 및 검토"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>개념 검토 및 승인</span>
                    </div>
                    {draftCount > 0 && (
                      <span className="text-[10px] font-academic-mono bg-amber-100 text-amber-800 border border-amber-300 px-1 rounded-full font-bold">
                        {draftCount}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 문제은행: 출제 · 검토 · 풀기 · 모의시험 */}
          <div className="relative flex items-center">
            <button
              onClick={() => {
                closeMenus();
                if (onSelectTab) onSelectTab('problems');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xs transition-colors font-bold ${
                activeTab === 'problems'
                  ? 'bg-[#191817] text-white shadow-xs'
                  : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
              }`}
              title="문제은행 작업 공간"
            >
              <FileQuestion className={`w-3.5 h-3.5 ${activeTab === 'problems' ? 'text-white' : 'text-blue-600'}`} />
              <span>문제은행</span>
              {problemDraftCount > 0 && (
                <span className="text-[10px] font-academic-mono bg-blue-100 text-blue-800 border border-blue-300 px-1 rounded-full font-bold">
                  {problemDraftCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'problems' ? null : 'problems')}
              className={`p-1 rounded-xs transition-colors ${
                activeTab === 'problems' ? 'text-white hover:bg-white/20' : 'text-[#827d73] hover:text-[#191817]'
              }`}
              aria-label="문제은행 바로가기 메뉴"
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {openMenu === 'problems' && (
              <div className="absolute left-0 top-full mt-1 w-60 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                {onOpenProblemGenerator && (
                  <button
                    onClick={() => {
                      closeMenus();
                      onOpenProblemGenerator();
                    }}
                    className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                    title="AI 고난도 문제 출제"
                  >
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>AI 문제 출제</span>
                  </button>
                )}
                {onOpenProblemReview && (
                  <button
                    onClick={() => {
                      closeMenus();
                      if (onSelectTab) onSelectTab('problems');
                      else onOpenProblemReview();
                    }}
                    className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                    title="AI 시험 문제 검토, 승인 및 신고 관리"
                  >
                    <div className="flex items-center gap-2">
                      <FileQuestion className="w-4 h-4 text-blue-600" />
                      <span>문제 검토·검색·승인</span>
                    </div>
                    <div className="flex items-center gap-1.5">
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
                    </div>
                  </button>
                )}
                <button
                  onClick={() => {
                    closeMenus();
                    onOpenProblemSession();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                >
                  <PenTool className="w-4 h-4 text-[#827d73]" />
                  <span>문제 풀기 (서술·논술형)</span>
                </button>
                <button
                  onClick={() => {
                    closeMenus();
                    onOpenMockExam();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
                  title="혼합형 모의시험 응시 및 AI 평가"
                >
                  <Award className="w-4 h-4 text-purple-600" />
                  <span>모의시험</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('history');
              else onOpenLearningAnalytics?.();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xs transition-colors font-bold ${
              activeTab === 'history'
                ? 'bg-[#191817] text-white shadow-xs'
                : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
            }`}
            title="과거 답안·평가와 오답·취약 개념 분석"
          >
            <BarChart3 className={`w-3.5 h-3.5 ${activeTab === 'history' ? 'text-white' : 'text-indigo-600'}`} />
            <span>학습 기록</span>
          </button>

          <button
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('settings');
              else onOpenSettings();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xs transition-colors font-bold ml-1 ${
              activeTab === 'settings'
                ? 'bg-[#191817] text-white shadow-xs'
                : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
            }`}
            title="설정 (API 연결 · 저장 정책 · 데이터 관리)"
            aria-label="설정"
          >
            <Settings className={`w-3.5 h-3.5 ${activeTab === 'settings' ? 'text-white' : 'text-[#827d73]'}`} />
            <span>설정</span>
          </button>

          {onLogout && (
            <div className="flex items-center gap-2 ml-1 pl-2 border-l border-[#e2ded6]">
              {userEmail && (
                <span
                  className="hidden xl:inline max-w-[160px] truncate text-[11px] font-academic-mono text-[#827d73]"
                  title={userEmail}
                >
                  {userEmail}
                </span>
              )}
              <button
                onClick={onLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xs text-[#57544e] hover:text-[#c52828] hover:bg-[#fef2f2] border border-transparent hover:border-[#fecaca] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                title="로그아웃"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
              </button>
            </div>
          )}
        </nav>

        {/* Mobile menu toggle */}
        <div className="flex lg:hidden items-center gap-1">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            aria-label="모바일 메뉴 열기"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Horizontal Sub-Navigation Tab Bar (375px~ responsive) */}
      <div className="lg:hidden w-full bg-[#faf8f4] border-b border-[#e2ded6] px-2 py-1.5 flex items-center justify-between gap-1 overflow-x-auto text-xs font-semibold">
        <button
          type="button"
          onClick={() => {
            if (onSelectTab) onSelectTab('today');
            else onScrollToTodayReview();
          }}
          className={`px-2.5 py-1 rounded-xs shrink-0 flex items-center gap-1 transition-colors ${
            activeTab === 'today' ? 'bg-[#191817] text-white' : 'text-[#57544e] bg-white border border-[#e2ded6]'
          }`}
        >
          <CalendarCheck className="w-3 h-3 text-[#c52828]" />
          <span>오늘 학습</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onSelectTab) onSelectTab('materials');
          }}
          className={`px-2.5 py-1 rounded-xs shrink-0 flex items-center gap-1 transition-colors ${
            activeTab === 'materials' ? 'bg-[#191817] text-white' : 'text-[#57544e] bg-white border border-[#e2ded6]'
          }`}
        >
          <FolderOpen className="w-3 h-3 text-[#c52828]" />
          <span>자료</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onSelectTab) onSelectTab('problems');
          }}
          className={`px-2.5 py-1 rounded-xs shrink-0 flex items-center gap-1 transition-colors ${
            activeTab === 'problems' ? 'bg-[#191817] text-white' : 'text-[#57544e] bg-white border border-[#e2ded6]'
          }`}
        >
          <FileQuestion className="w-3 h-3 text-blue-600" />
          <span>문제은행</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onSelectTab) onSelectTab('history');
          }}
          className={`px-2.5 py-1 rounded-xs shrink-0 flex items-center gap-1 transition-colors ${
            activeTab === 'history' ? 'bg-[#191817] text-white' : 'text-[#57544e] bg-white border border-[#e2ded6]'
          }`}
        >
          <BarChart3 className="w-3 h-3 text-indigo-600" />
          <span>학습 기록</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onSelectTab) onSelectTab('settings');
          }}
          className={`px-2.5 py-1 rounded-xs shrink-0 flex items-center gap-1 transition-colors ${
            activeTab === 'settings' ? 'bg-[#191817] text-white' : 'text-[#57544e] bg-white border border-[#e2ded6]'
          }`}
        >
          <Settings className="w-3 h-3 text-[#827d73]" />
          <span>설정</span>
        </button>
      </div>

      {/* Mobile Drawer: same five main menus */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-[#e2ded6] bg-white px-4 py-3 space-y-2">
          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('today');
              else onScrollToTodayReview();
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2 py-2 px-3 text-xs font-bold rounded-xs transition-colors ${
              activeTab === 'today' ? 'bg-[#191817] text-white' : 'text-[#191817] bg-[#faf8f4] hover:bg-[#f1ede4]'
            }`}
          >
            <CalendarCheck className={`w-4 h-4 ${activeTab === 'today' ? 'text-white' : 'text-[#c52828]'}`} />
            <span>오늘 학습</span>
          </button>

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

          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('materials');
              else onOpenMaterialsList?.();
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2 py-2 px-3 text-xs rounded-xs transition-colors ${
              activeTab === 'materials' ? 'bg-[#191817] text-white font-bold' : 'text-[#191817] hover:bg-[#faf8f4]'
            }`}
          >
            <FolderOpen className={`w-4 h-4 ${activeTab === 'materials' ? 'text-white' : 'text-[#c52828]'}`} />
            <span>자료 관리 작업공간</span>
          </button>

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

          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('problems');
              else onOpenProblemReview?.();
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between py-2 px-3 text-xs rounded-xs transition-colors ${
              activeTab === 'problems' ? 'bg-[#191817] text-white font-bold' : 'text-[#191817] hover:bg-[#faf8f4]'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileQuestion className={`w-4 h-4 ${activeTab === 'problems' ? 'text-white' : 'text-blue-600'}`} />
              <span>문제은행 작업공간</span>
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

          {onOpenProblemGenerator && (
            <button
              onClick={() => {
                onOpenProblemGenerator();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>AI 문제 출제</span>
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
            <Award className="w-4 h-4 text-purple-600" />
            <span>모의시험</span>
          </button>

          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('history');
              else onOpenLearningAnalytics?.();
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2 py-2 px-3 text-xs rounded-xs transition-colors ${
              activeTab === 'history' ? 'bg-[#191817] text-white font-bold' : 'text-[#191817] hover:bg-[#faf8f4]'
            }`}
          >
            <BarChart3 className={`w-4 h-4 ${activeTab === 'history' ? 'text-white' : 'text-indigo-600'}`} />
            <span>학습 기록 및 분석</span>
          </button>

          <button
            onClick={() => {
              if (onSelectTab) onSelectTab('settings');
              else onOpenSettings();
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2 py-2 px-3 text-xs rounded-xs transition-colors ${
              activeTab === 'settings' ? 'bg-[#191817] text-white font-bold' : 'text-[#191817] hover:bg-[#faf8f4]'
            }`}
          >
            <Settings className={`w-4 h-4 ${activeTab === 'settings' ? 'text-white' : 'text-[#827d73]'}`} />
            <span>설정 (API 연결·저장 정책·데이터 관리)</span>
          </button>

          {onLogout && (
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLogout();
              }}
              disabled={isLoggingOut}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#c52828] hover:bg-[#fef2f2] rounded-xs disabled:opacity-60"
            >
              <LogOut className="w-4 h-4" />
              <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
}
