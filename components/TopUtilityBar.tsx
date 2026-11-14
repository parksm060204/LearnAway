'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  User,
} from 'lucide-react';
import { useTrialCredits } from '../lib/trialCreditsClient';
import { Badge } from './ui/WorkspacePrimitives';

export type DashboardTab = 'today' | 'materials' | 'problems' | 'history' | 'settings' | 'session' | 'exam';

interface TopUtilityBarProps {
  subjects: Subject[];
  activeSubject?: Subject | null;
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
  onOpenAiMetrics?: () => void;
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
  onOpenAiMetrics,
  onScrollToTodayReview,
  activeTab = 'today',
  onSelectTab,
  userEmail,
  onLogout,
  isLoggingOut = false,
}: TopUtilityBarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'materials' | 'problems' | 'account' | null>(null);
  const trialCredits = useTrialCredits();

  const headerRef = useRef<HTMLElement | null>(null);
  const subjectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const materialsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const problemsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setIsDropdownOpen(false);
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        closeMenus();
        setIsMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isDropdownOpen) {
        setIsDropdownOpen(false);
        subjectTriggerRef.current?.focus();
      } else if (openMenu === 'materials') {
        setOpenMenu(null);
        materialsTriggerRef.current?.focus();
      } else if (openMenu === 'problems') {
        setOpenMenu(null);
        problemsTriggerRef.current?.focus();
      } else if (openMenu === 'account') {
        setOpenMenu(null);
        accountTriggerRef.current?.focus();
      } else if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        mobileMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen, openMenu, isMobileMenuOpen, closeMenus]);

  const aiBadgeVariant = trialCredits.hasPersonalKey
    ? 'success'
    : trialCredits.balance > 0
    ? 'warning'
    : 'danger';

  const aiBadgeLabel = trialCredits.loading
    ? 'AI 확인 중'
    : trialCredits.hasPersonalKey
    ? '내 API 연결됨'
    : trialCredits.balance > 0
    ? trialCredits.granted === 1
      ? `체험 ${trialCredits.balance}/1`
      : `체험 ${trialCredits.balance}/${trialCredits.granted}`
    : 'API 연결 필요';

  const navTabClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xs text-xs font-semibold whitespace-nowrap transition-colors ${
      isActive
        ? 'bg-[#191817] text-white shadow-2xs'
        : 'text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-transparent'
    }`;

  return (
    <header
      ref={headerRef}
      className="w-full bg-white border-b border-[#e2ded6] sticky top-0 z-40 shadow-2xs"
    >
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
        {/* Left Zone: Brand + Subject Selector */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('today');
              else onScrollToTodayReview();
            }}
            className="flex items-center gap-2 cursor-pointer text-left hover:opacity-80 transition-opacity shrink-0 whitespace-nowrap"
            title="홈(오늘 학습)으로 이동"
            aria-label="홈으로 이동"
          >
            <span className="w-2.5 h-2.5 bg-[#c52828] inline-block shrink-0" aria-hidden="true" />
            <span className="font-extrabold tracking-wide text-sm sm:text-base font-academic-mono text-[#191817] whitespace-nowrap">
              Learn my way
            </span>
          </button>

          <span className="hidden sm:inline text-[#c8c2b5] shrink-0" aria-hidden="true">
            |
          </span>

          {/* Subject Dropdown */}
          <div className="relative min-w-0">
            <button
              ref={subjectTriggerRef}
              type="button"
              onClick={() => {
                setOpenMenu(null);
                setIsDropdownOpen((prev) => !prev);
              }}
              className="flex items-center gap-1.5 text-xs sm:text-[13px] font-semibold text-[#191817] hover:text-[#c52828] transition-colors py-1.5 px-2.5 rounded-xs border border-[#e2ded6] sm:border-transparent hover:border-[#e2ded6] hover:bg-[#faf8f4] max-w-[180px] sm:max-w-[230px]"
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
              aria-label="과목 선택 드롭다운"
            >
              {activeSubject ? (
                <>
                  <span className="truncate">{activeSubject.name}</span>
                  {activeSubject.isDemo && (
                    <Badge variant="neutral" mono className="shrink-0">
                      데모
                    </Badge>
                  )}
                </>
              ) : (
                <span className="text-[#c52828] font-bold whitespace-nowrap">+ 과목 등록 필요</span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-[#827d73] shrink-0" />
            </button>

            {isDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                <div className="px-3 py-2 text-xs text-[#57544e] border-b border-[#f1ede4] bg-[#faf8f4] flex justify-between items-center">
                  <span className="font-semibold">과목 폴더 선택</span>
                  <span className="font-academic-mono text-[#827d73]">{subjects.length}개</span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {subjects.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#827d73] leading-relaxed">
                      등록된 과목이 없습니다.<br />아래 버튼을 눌러 새 과목을 추가하세요.
                    </div>
                  ) : (
                    subjects.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          onSelectSubject(sub.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between gap-2 hover:bg-[#faf8f4] transition-colors ${
                          sub.id === activeSubject?.id
                            ? 'font-bold text-[#c52828] bg-[#fef2f2]'
                            : 'text-[#191817]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-1.5">
                            <span className="truncate">{sub.name}</span>
                            {sub.isDemo && (
                              <Badge variant="neutral" mono>
                                데모
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-[#827d73] mt-0.5">
                            {sub.domain === 'math_stats' ? '수학 / 수리통계' : '컴퓨터공학 / 코딩'}
                          </div>
                        </div>
                        {sub.id === activeSubject?.id && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#c52828] shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                <div className="p-2 border-t border-[#f1ede4] bg-[#faf8f4]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onOpenAddSubject();
                    }}
                    className="w-full py-2 px-3 text-xs font-semibold text-[#191817] hover:text-[#c52828] bg-white border border-[#c8c2b5] rounded-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#c52828]" />
                    <span>새 과목 폴더 추가</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Zone: 5 Primary Workspace Tabs (Desktop) */}
        <nav className="hidden lg:flex items-center gap-1" aria-label="주 작업 공간">
          <button
            type="button"
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('today');
              else onScrollToTodayReview();
            }}
            aria-current={activeTab === 'today' ? 'page' : undefined}
            className={navTabClass(activeTab === 'today')}
          >
            <CalendarCheck className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'today' ? 'text-white' : 'text-[#c52828]'}`} />
            <span>오늘 학습</span>
          </button>

          {/* 자료 + 바로가기 메뉴 */}
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => {
                closeMenus();
                if (onSelectTab) onSelectTab('materials');
              }}
              aria-current={activeTab === 'materials' ? 'page' : undefined}
              className={navTabClass(activeTab === 'materials')}
            >
              <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'materials' ? 'text-white' : 'text-[#57544e]'}`} />
              <span>자료</span>
              {draftCount > 0 && (
                <Badge variant={activeTab === 'materials' ? 'accent' : 'warning'} mono>
                  {draftCount}
                </Badge>
              )}
            </button>
            <button
              ref={materialsTriggerRef}
              type="button"
              onClick={() => {
                setIsDropdownOpen(false);
                setOpenMenu(openMenu === 'materials' ? null : 'materials');
              }}
              aria-haspopup="true"
              aria-expanded={openMenu === 'materials'}
              className="p-1.5 rounded-xs text-[#827d73] hover:text-[#191817] hover:bg-[#faf8f4] transition-colors"
              aria-label="자료 바로가기 메뉴"
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {openMenu === 'materials' && (
              <div className="absolute left-0 top-full mt-1.5 w-56 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    closeMenus();
                    onOpenUpload();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                >
                  <Upload className="w-4 h-4 text-[#827d73]" />
                  <span>자료 등록 (PDF / 전사본)</span>
                </button>
                {onOpenMaterialsList && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      if (onSelectTab) onSelectTab('materials');
                      else onOpenMaterialsList();
                    }}
                    className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                  >
                    <FolderOpen className="w-4 h-4 text-[#c52828]" />
                    <span>자료 보관함 열기</span>
                  </button>
                )}
                {onOpenConceptReview && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      onOpenConceptReview();
                    }}
                    className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#c52828]" />
                      <span>개념 검토 및 승인</span>
                    </span>
                    {draftCount > 0 && (
                      <Badge variant="warning" mono>
                        {draftCount}
                      </Badge>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 문제은행 + 바로가기 메뉴 */}
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => {
                closeMenus();
                if (onSelectTab) onSelectTab('problems');
              }}
              aria-current={activeTab === 'problems' ? 'page' : undefined}
              className={navTabClass(activeTab === 'problems')}
            >
              <FileQuestion className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'problems' ? 'text-white' : 'text-[#57544e]'}`} />
              <span>문제은행</span>
              {problemDraftCount > 0 && (
                <Badge variant="info" mono>
                  {problemDraftCount}
                </Badge>
              )}
            </button>
            <button
              ref={problemsTriggerRef}
              type="button"
              onClick={() => {
                setIsDropdownOpen(false);
                setOpenMenu(openMenu === 'problems' ? null : 'problems');
              }}
              aria-haspopup="true"
              aria-expanded={openMenu === 'problems'}
              className="p-1.5 rounded-xs text-[#827d73] hover:text-[#191817] hover:bg-[#faf8f4] transition-colors"
              aria-label="문제은행 바로가기 메뉴"
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {openMenu === 'problems' && (
              <div className="absolute left-0 top-full mt-1.5 w-60 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                {onOpenProblemGenerator && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      onOpenProblemGenerator();
                    }}
                    className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                  >
                    <Sparkles className="w-4 h-4 text-[#c52828]" />
                    <span>AI 문제 출제</span>
                  </button>
                )}
                {onOpenProblemReview && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      if (onSelectTab) onSelectTab('problems');
                      else onOpenProblemReview();
                    }}
                    className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                  >
                    <span className="flex items-center gap-2">
                      <FileQuestion className="w-4 h-4 text-[#57544e]" />
                      <span>문제 검토·검색·승인</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {problemDraftCount > 0 && (
                        <Badge variant="info" mono>
                          {problemDraftCount}
                        </Badge>
                      )}
                      {problemReportedCount > 0 && (
                        <Badge variant="danger" mono>
                          <ShieldAlert className="w-2.5 h-2.5" />
                          {problemReportedCount}
                        </Badge>
                      )}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeMenus();
                    onOpenProblemSession();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                >
                  <PenTool className="w-4 h-4 text-[#57544e]" />
                  <span>문제 풀기 (서술·논술형)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenus();
                    onOpenMockExam();
                  }}
                  className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                >
                  <Award className="w-4 h-4 text-[#57544e]" />
                  <span>모의시험</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('history');
              else onOpenLearningAnalytics?.();
            }}
            aria-current={activeTab === 'history' ? 'page' : undefined}
            className={navTabClass(activeTab === 'history')}
          >
            <BarChart3 className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'history' ? 'text-white' : 'text-[#57544e]'}`} />
            <span>학습 기록</span>
          </button>

          <button
            type="button"
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('settings');
              else onOpenSettings();
            }}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            className={navTabClass(activeTab === 'settings')}
          >
            <Settings className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'settings' ? 'text-white' : 'text-[#57544e]'}`} />
            <span>설정</span>
          </button>
        </nav>

        {/* Right Zone: AI Credit Status + Account/Tools Menu (Desktop) */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              closeMenus();
              if (onSelectTab) onSelectTab('settings');
              else onOpenSettings();
            }}
            className="whitespace-nowrap rounded-xs"
            title={
              trialCredits.hasPersonalKey
                ? '내 API 키 사용 중 · 체험 크레딧 차감 없음 (설정 열기)'
                : trialCredits.balance > 0
                ? `남은 AI 체험: ${trialCredits.balance}/${trialCredits.granted}회 (설정 열기)`
                : 'AI 체험 크레딧 소진 · 내 API 연결 필요 (설정 열기)'
            }
            aria-label="AI 연결 및 체험 크레딧 상태"
          >
            <Badge variant={aiBadgeVariant} mono>
              <Sparkles className="w-3 h-3" />
              <span>{aiBadgeLabel}</span>
            </Badge>
          </button>

          {(onLogout || onOpenAiMetrics || userEmail) && (
            <div className="relative">
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={() => {
                  setIsDropdownOpen(false);
                  setOpenMenu(openMenu === 'account' ? null : 'account');
                }}
                aria-haspopup="true"
                aria-expanded={openMenu === 'account'}
                aria-label="계정 및 도구 메뉴"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xs text-xs font-medium text-[#57544e] hover:text-[#191817] hover:bg-[#faf8f4] border border-[#e2ded6] whitespace-nowrap transition-colors"
              >
                <User className="w-3.5 h-3.5 text-[#827d73]" />
                <span className="max-w-[110px] truncate">{userEmail ? userEmail.split('@')[0] : '계정'}</span>
                <ChevronDown className="w-3 h-3 text-[#827d73]" />
              </button>

              {openMenu === 'account' && (
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-[#c8c2b5] shadow-lg rounded-xs z-50 py-1 font-sans">
                  {userEmail && (
                    <div className="px-3 py-2 border-b border-[#f1ede4] bg-[#faf8f4]">
                      <div className="text-[11px] text-[#827d73]">로그인 계정</div>
                      <div className="text-xs font-medium text-[#191817] truncate" title={userEmail}>
                        {userEmail}
                      </div>
                    </div>
                  )}

                  {onOpenAiMetrics && (
                    <button
                      type="button"
                      onClick={() => {
                        closeMenus();
                        onOpenAiMetrics();
                      }}
                      className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                    >
                      <span className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#57544e]" />
                        <span>AI 운영/비용 지표</span>
                      </span>
                      <Badge variant="neutral">관리자</Badge>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      if (onSelectTab) onSelectTab('settings');
                      else onOpenSettings();
                    }}
                    className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] whitespace-nowrap"
                  >
                    <Settings className="w-4 h-4 text-[#57544e]" />
                    <span>환경 설정</span>
                  </button>

                  {onLogout && (
                    <button
                      type="button"
                      onClick={() => {
                        closeMenus();
                        onLogout();
                      }}
                      disabled={isLoggingOut}
                      className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#c52828] hover:bg-[#fef2f2] border-t border-[#f1ede4] whitespace-nowrap disabled:opacity-60"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile menu toggle */}
        <div className="flex lg:hidden items-center gap-1.5 shrink-0">
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? '모바일 메뉴 닫기' : '모바일 메뉴 열기'}
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Horizontal Sub-Navigation Tab Bar (375px~ responsive) */}
      <nav
        className="lg:hidden w-full bg-[#faf8f4] border-t border-[#e2ded6] px-2 py-1.5 flex items-center gap-1 overflow-x-auto text-xs font-semibold"
        aria-label="모바일 작업 공간 탭"
      >
        {[
          { id: 'today' as const, label: '오늘 학습', icon: CalendarCheck },
          { id: 'materials' as const, label: '자료', icon: FolderOpen, count: draftCount },
          { id: 'problems' as const, label: '문제은행', icon: FileQuestion, count: problemDraftCount },
          { id: 'history' as const, label: '학습 기록', icon: BarChart3 },
          { id: 'settings' as const, label: '설정', icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === 'today' && !onSelectTab) {
                  onScrollToTodayReview();
                } else {
                  onSelectTab?.(tab.id);
                }
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`px-2.5 py-1.5 rounded-xs shrink-0 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'bg-[#191817] text-white'
                  : 'text-[#57544e] bg-white border border-[#e2ded6]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#c52828]'}`} />
              <span>{tab.label}</span>
              {tab.count && tab.count > 0 ? (
                <span className="text-[10px] font-academic-mono px-1 rounded-xs bg-[#fef2f2] text-[#c52828] border border-[#fecaca]">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-[#e2ded6] bg-white px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => {
              if (onSelectTab) onSelectTab('settings');
              else onOpenSettings();
              setIsMobileMenuOpen(false);
            }}
            className="w-full p-2.5 rounded-xs border border-[#e2ded6] bg-[#faf8f4] text-xs flex items-center justify-between text-left"
          >
            <span className="flex items-center gap-2 font-semibold text-[#191817]">
              <Sparkles className="w-4 h-4 text-[#c52828] shrink-0" />
              <span>{aiBadgeLabel}</span>
            </span>
            <span className="text-xs underline text-[#57544e]">설정</span>
          </button>

          {onOpenAiMetrics && (
            <button
              type="button"
              onClick={() => {
                onOpenAiMetrics();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-between py-2 px-3 text-xs bg-[#faf8f4] text-[#191817] border border-[#ded6c8] rounded-xs font-semibold"
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#57544e]" />
                <span>AI 운영/비용 지표 대시보드</span>
              </span>
              <Badge variant="neutral">관리자</Badge>
            </button>
          )}

          <div className="pt-1 space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenUpload();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <Upload className="w-4 h-4 text-[#827d73]" />
              <span>자료 등록 (PDF / 전사본)</span>
            </button>

            {onOpenConceptReview && (
              <button
                type="button"
                onClick={() => {
                  onOpenConceptReview();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center justify-between py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#c52828]" />
                  <span>개념 검토 및 승인</span>
                </span>
                {draftCount > 0 && (
                  <Badge variant="warning" mono>
                    {draftCount}
                  </Badge>
                )}
              </button>
            )}

            {onOpenProblemGenerator && (
              <button
                type="button"
                onClick={() => {
                  onOpenProblemGenerator();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
              >
                <Sparkles className="w-4 h-4 text-[#c52828]" />
                <span>AI 문제 출제</span>
              </button>
            )}

            <button
              type="button"
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
              type="button"
              onClick={() => {
                onOpenMockExam();
                setIsMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#191817] hover:bg-[#faf8f4] rounded-xs"
            >
              <Award className="w-4 h-4 text-[#57544e]" />
              <span>모의시험</span>
            </button>

            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onLogout();
                }}
                disabled={isLoggingOut}
                className="w-full flex items-center gap-2 py-2 px-3 text-xs text-[#c52828] hover:bg-[#fef2f2] border-t border-[#f1ede4] mt-1 pt-2.5 rounded-xs disabled:opacity-60"
              >
                <LogOut className="w-4 h-4" />
                <span>{isLoggingOut ? '로그아웃 중...' : '로그아웃'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
