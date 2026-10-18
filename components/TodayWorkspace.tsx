'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Subject,
  Concept,
  Problem,
  Attempt,
  ProblemType,
  RetentionModelSettings,
  StudyPlanItem,
  ReviewRecommendation,
  ReviewEvent,
  ProblemReportType,
} from '../lib/types';
import { ExamRecordCard } from './ExamRecordCard';
import { ForgettingCurveChart } from './ForgettingCurveChart';
import { TodayStudyList } from './TodayStudyList';
import { ConceptRail, SortMode } from './ConceptRail';
import { StatusStrip } from './StatusStrip';
import { TodayReviewPanel } from './TodayReviewPanel';
import { ArchiveRecordDetail } from './ArchiveRecordDetail';
import { BookOpen, Plus, Sparkles } from 'lucide-react';
import { OnboardingFlow } from './OnboardingFlow';

export interface TodayWorkspaceProps {
  activeSubject?: Subject | null;
  onOpenScheduleModal: () => void;
  onOpenScopeModal: () => void;
  onOpenAddSubject?: () => void;
  onLoadDemoData?: () => void;
  primaryCta?: { kind: 'start-item' | 'resume-mock' | 'start-review'; itemId?: string } | null;
  onPrimaryAction?: () => void;
  todayDigest: {
    items: StudyPlanItem[];
    pendingCount: number;
    estimateText: string | null;
  };
  todayDayLabel?: string;
  hasActiveSession: boolean;
  onStartPlanItem: (item: StudyPlanItem) => void;
  onResumeMock: () => void;
  onOpenAllStudyPlan: () => void;

  // Concepts & Retention curve
  subjectConcepts: Concept[];
  selectedConcept?: Concept | null;
  comparedConcepts: Concept[];
  isComparisonMode: boolean;
  onToggleComparisonMode: () => void;
  selectedEventId?: string | null;
  onSelectEvent: (eventId: string | null) => void;
  settings: RetentionModelSettings;
  examDDay: number;

  // Auxiliary details
  sortMode: SortMode;
  onChangeSortMode: (mode: SortMode) => void;
  selectedConceptId: string;
  onSelectConcept: (id: string) => void;
  comparedConceptIds: string[];
  onToggleCompareConcept: (id: string) => void;

  // Practice & Archive
  subjectProblems: Problem[];
  selectedProblemType: ProblemType;
  onSelectProblemType: (type: ProblemType) => void;
  onStartSession: (problemId?: string) => void;
  onPostponeDay: () => void;
  onOpenSourceModal: (sourceRef: string) => void;
  onOpenProblemGenerator: (conceptId?: string) => void;
  onOpenProblemReview: () => void;
  activeSubjectProblemDraftsCount: number;
  selectedConceptRecommendation?: ReviewRecommendation | null;

  // Archive details
  selectedEvent?: ReviewEvent | null;
  attempts: Attempt[];
  allProblems: Problem[];
  onReportProblem?: (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => { success: boolean; error?: string };
  onOpenLogicStrengthen?: (attempt: Attempt) => void;
  onOpenUpload: () => void;
}

export function TodayWorkspace({
  activeSubject,
  onOpenScheduleModal,
  onOpenScopeModal,
  onOpenAddSubject,
  onLoadDemoData,
  primaryCta,
  onPrimaryAction,
  todayDigest,
  todayDayLabel,
  hasActiveSession,
  onStartPlanItem,
  onResumeMock,
  onOpenAllStudyPlan,
  subjectConcepts,
  selectedConcept,
  comparedConcepts,
  isComparisonMode,
  onToggleComparisonMode,
  selectedEventId,
  onSelectEvent,
  settings,
  examDDay,
  sortMode,
  onChangeSortMode,
  selectedConceptId,
  onSelectConcept,
  comparedConceptIds,
  onToggleCompareConcept,
  subjectProblems,
  selectedProblemType,
  onSelectProblemType,
  onStartSession,
  onPostponeDay,
  onOpenSourceModal,
  onOpenProblemGenerator,
  onOpenProblemReview,
  activeSubjectProblemDraftsCount,
  selectedConceptRecommendation,
  selectedEvent,
  attempts,
  allProblems,
  onReportProblem,
  onOpenLogicStrengthen,
  onOpenUpload,
}: TodayWorkspaceProps) {
  const [isConceptRailOpen, setIsConceptRailOpen] = useState(false);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [isArchiveManuallyToggled, setIsArchiveManuallyToggled] = useState<boolean | null>(null);
  const isArchiveOpen = isArchiveManuallyToggled !== null ? isArchiveManuallyToggled : Boolean(selectedEventId);
  const archiveDetailRef = useRef<HTMLDivElement | null>(null);

  // When selectedEvent changes (e.g. user clicked a curve event point), auto-scroll into view
  useEffect(() => {
    if (selectedEventId) {
      archiveDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedEventId]);

  if (!activeSubject) {
    return (
      <div className="w-full space-y-4">
        <OnboardingFlow
          onOpenAddSubject={onOpenAddSubject ?? onOpenScheduleModal}
          onLoadDemoData={onLoadDemoData}
        />
      </div>
    );
  }

  const hasExamDate = Boolean(activeSubject.examAt && !isNaN(new Date(activeSubject.examAt).getTime()));

  return (
    <div className="w-full space-y-4">
      {/* ① Section 1: Subject Exam Record & D-Day Card with Primary CTA Button */}
      <ExamRecordCard
        subject={activeSubject}
        onOpenScheduleModal={onOpenScheduleModal}
        onOpenScopeModal={onOpenScopeModal}
        onPrimaryAction={primaryCta && onPrimaryAction ? onPrimaryAction : undefined}
        primaryLabel={primaryCta ? (primaryCta.kind === 'resume-mock' ? '이어서 풀기' : '오늘 복습 시작') : undefined}
        estimatedMinutesText={todayDigest.estimateText}
      />

      {/* Empty State when no concepts exist */}
      {subjectConcepts.length === 0 ? (
        <div className="bg-white border border-[#e2ded6] rounded-xs p-8 sm:p-10 text-center shadow-2xs space-y-5">
          <div className="w-12 h-12 bg-[#faf8f4] border border-[#ded6c8] rounded-full flex items-center justify-center text-[#827d73] mx-auto">
            <BookOpen className="w-6 h-6 stroke-1 text-[#827d73]" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-academic-serif font-bold text-base text-[#191817]">
              &lsquo;{activeSubject.name}&rsquo; 과목에 등록된 학습 개념이 없습니다.
            </h3>
            <p className="text-xs text-[#57544e] max-w-lg mx-auto leading-relaxed">
              강의 자료(PDF 교재 또는 녹음 전사본)를 등록하고 AI 개념 분석을 실행하면, 
              시험 범위 내 핵심 개념이 자동으로 추출되고 망각곡선 복습 추천이 시작됩니다.
            </p>
          </div>

          {/* 3-Step Guided Roadmap */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left pt-1">
            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
              <span className="text-[10px] font-academic-mono text-[#c52828] font-bold">STEP 01</span>
              <p className="text-xs font-bold text-[#191817]">강의자료 등록</p>
              <p className="text-[11px] text-[#827d73] leading-tight">PDF 교재 또는 강의 녹음 전사본 업로드</p>
            </div>
            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
              <span className="text-[10px] font-academic-mono text-amber-700 font-bold">STEP 02</span>
              <p className="text-xs font-bold text-[#191817]">AI 개념 분석</p>
              <p className="text-[11px] text-[#827d73] leading-tight">정리, 공식, 알고리즘 자동 추출 및 승인</p>
            </div>
            <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
              <span className="text-[10px] font-academic-mono text-blue-700 font-bold">STEP 03</span>
              <p className="text-xs font-bold text-[#191817]">문제 풀이 & 복습</p>
              <p className="text-[11px] text-[#827d73] leading-tight">대학 시험 수준 문제 풀이 및 망각곡선 추적</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={onOpenUpload}
              className="px-5 py-2.5 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs inline-flex items-center gap-2 shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-[#c52828]" />
              <span>강의 자료 등록하기 (PDF / Markdown)</span>
            </button>
            {onLoadDemoData && (
              <button
                type="button"
                onClick={onLoadDemoData}
                className="px-4 py-2.5 bg-white hover:bg-[#faf8f4] text-[#57544e] border border-[#ded6c8] text-xs font-bold rounded-xs inline-flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>체험용 샘플 데이터 불러오기</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ② Section 2: Forgetting Curve (Center, Full Width) */}
          {selectedConcept ? (
            <ForgettingCurveChart
              concept={selectedConcept}
              comparedConcepts={comparedConcepts}
              isComparisonMode={isComparisonMode}
              onToggleComparisonMode={onToggleComparisonMode}
              selectedEventId={selectedEventId ?? null}
              onSelectEvent={(evId) => {
                onSelectEvent(evId);
                setIsArchiveManuallyToggled(true);
              }}
              settings={settings}
              examDayOffset={examDDay}
              hasExamDate={hasExamDate}
            />
          ) : (
            <div className="bg-white border border-[#e2ded6] rounded-xs p-6 text-center text-xs text-[#827d73]">
              개념을 선택하면 망각곡선 그래프가 표시됩니다.
            </div>
          )}

          {/* ③ Section 3: Today Study List (Top 3~5 items + plan link) */}
          <TodayStudyList
            dayLabel={todayDayLabel}
            items={todayDigest.items}
            pendingCount={todayDigest.pendingCount}
            estimatedMinutesText={todayDigest.estimateText}
            hasActiveSession={hasActiveSession}
            onStartItem={onStartPlanItem}
            onResumeMock={onResumeMock}
            onOpenAll={onOpenAllStudyPlan}
          />

          {/* ④ Section 4: Auxiliary Information (Folded/Collapsible by default) */}
          <div className="space-y-3 pt-1">
            {/* Auxiliary 1: Concept Rail & Status Summary (Collapsible) */}
            <details
              open={isConceptRailOpen}
              onToggle={(e) => setIsConceptRailOpen((e.target as HTMLDetailsElement).open)}
              className="bg-white border border-[#e2ded6] rounded-xs shadow-2xs overflow-hidden"
            >
              <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-xs font-bold text-[#191817] hover:bg-[#faf8f4] transition-colors">
                <div className="flex items-center gap-2">
                  <span>전체 개념 목록 및 복습 순위 ({subjectConcepts.length}개)</span>
                  {selectedConcept && (
                    <span className="text-[11px] font-academic-mono text-[#827d73] font-normal">
                      · 현재 선택: {selectedConcept.title}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-academic-mono font-medium text-[#827d73]">
                  {isConceptRailOpen ? '접기' : '펼치기'}
                </span>
              </summary>
              <div className="p-4 pt-1 space-y-3 border-t border-[#f1ede4]">
                <StatusStrip subject={activeSubject} concepts={subjectConcepts} />
                <ConceptRail
                  concepts={subjectConcepts}
                  selectedConceptId={selectedConceptId}
                  onSelectConcept={onSelectConcept}
                  sortMode={sortMode}
                  onChangeSortMode={onChangeSortMode}
                  isComparisonMode={isComparisonMode}
                  comparedConceptIds={comparedConceptIds}
                  onToggleCompareConcept={onToggleCompareConcept}
                />
              </div>
            </details>

            {/* Auxiliary 2: Selected-concept practice detail (Collapsible) */}
            {selectedConcept && (
              <details
                open={isPracticeOpen}
                onToggle={(e) => setIsPracticeOpen((e.target as HTMLDetailsElement).open)}
                className="bg-white border border-[#e2ded6] rounded-xs shadow-2xs overflow-hidden"
              >
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-xs font-bold text-[#191817] hover:bg-[#faf8f4] transition-colors">
                  <span>선택한 개념 연습 문제 출제 및 풀기 · {selectedConcept.title}</span>
                  <span className="text-[11px] font-academic-mono font-medium text-[#827d73]">
                    {isPracticeOpen ? '접기' : '펼치기'}
                  </span>
                </summary>
                <div className="p-4 pt-1 max-w-3xl border-t border-[#f1ede4]">
                  <TodayReviewPanel
                    subject={activeSubject}
                    concept={selectedConcept}
                    problems={subjectProblems}
                    selectedProblemType={selectedProblemType}
                    onSelectProblemType={onSelectProblemType}
                    onStartSession={onStartSession}
                    onPostponeDay={onPostponeDay}
                    onOpenSourceModal={onOpenSourceModal}
                    onOpenProblemGenerator={onOpenProblemGenerator}
                    onOpenProblemReview={onOpenProblemReview}
                    problemDraftCount={activeSubjectProblemDraftsCount}
                    recommendation={selectedConceptRecommendation}
                    totalConceptsCount={subjectConcepts.length}
                  />
                </div>
              </details>
            )}

            {/* Auxiliary 3: Learning record detail (Collapsible, opens on curve click) */}
            {selectedConcept && (
              <details
                open={isArchiveOpen}
                onToggle={(e) => setIsArchiveManuallyToggled((e.target as HTMLDetailsElement).open)}
                className="bg-white border border-[#e2ded6] rounded-xs shadow-2xs overflow-hidden"
              >
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-xs font-bold text-[#191817] hover:bg-[#faf8f4] transition-colors">
                  <span>과거 학습 기록 상세 스냅샷 · {selectedConcept.title}</span>
                  <span className="text-[11px] font-academic-mono font-medium text-[#827d73]">
                    {isArchiveOpen ? '접기' : '펼치기'}
                  </span>
                </summary>
                <div ref={archiveDetailRef} id="archive-record-detail" className="p-4 pt-1 border-t border-[#f1ede4]">
                  <ArchiveRecordDetail
                    concept={selectedConcept}
                    event={selectedEvent ?? null}
                    attempts={attempts}
                    problems={allProblems}
                    onOpenSourceModal={onOpenSourceModal}
                    onReportProblem={onReportProblem}
                    onOpenLogicStrengthen={onOpenLogicStrengthen}
                  />
                </div>
              </details>
            )}
          </div>
        </>
      )}
    </div>
  );
}
