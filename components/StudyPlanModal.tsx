'use client';

import React, { useState } from 'react';
import {
  Subject,
  Concept,
  ProblemType,
  StudyPlanSettings,
  StudyPlanItem,
  DailyStudyPlan,
  StudyPlanSummary,
  STUDY_PLAN_ITEM_KIND_LABELS,
  WeekdayStudyTime,
} from '../lib/types';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Layers,
  SkipForward,
  X,
} from 'lucide-react';
import { calculateDDay } from '../lib/dateUtils';

interface StudyPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  activeSubject: Subject;
  concepts: Concept[];
  studyPlanSummary: StudyPlanSummary;
  settings: StudyPlanSettings;
  onUpdateSettings: (newSettings: StudyPlanSettings) => void;
  onStartItem: (item: StudyPlanItem) => void;
  onPostponeItem: (item: StudyPlanItem) => void;
  onSkipItem: (item: StudyPlanItem) => void;
  onRecalculatePlan: () => void;
}

export function StudyPlanModal({
  isOpen,
  onClose,
  subjects,
  activeSubject,
  concepts,
  studyPlanSummary,
  settings,
  onUpdateSettings,
  onStartItem,
  onPostponeItem,
  onSkipItem,
  onRecalculatePlan,
}: StudyPlanModalProps) {
  // Navigation tabs: 'plan' (View Plan) | 'settings' (Edit Settings)
  const [activeTab, setActiveTab] = useState<'plan' | 'settings'>('plan');

  // Filter: 'all' or specific subjectId
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all');

  // Pagination for 7-day display window
  const [dayWindowOffset, setDayWindowOffset] = useState<number>(0);

  // Settings edit state
  const [editingSettings, setEditingSettings] = useState<StudyPlanSettings>(() => structuredClone(settings));
  const [selectedConfigSubjectId, setSelectedConfigSubjectId] = useState<string>(activeSubject.id);

  if (!isOpen) return null;

  // Filter days and items
  const filteredDays: DailyStudyPlan[] = studyPlanSummary.days.map((day) => {
    if (filterSubjectId === 'all') return day;
    const filteredItems = day.items.filter((i) => i.subjectId === filterSubjectId);
    const assigned = filteredItems.reduce((acc, i) => acc + i.estimatedMinutes, 0);
    return {
      ...day,
      items: filteredItems,
      assignedMinutes: assigned,
    };
  });

  const visibleDays = filteredDays.slice(dayWindowOffset, dayWindowOffset + 7);

  // Filter unassigned items
  const unassignedItems = (studyPlanSummary.days[0]?.unassignedItems || []).filter((item) =>
    filterSubjectId === 'all' ? true : item.subjectId === filterSubjectId
  );

  const activeConfigSubject = subjects.find((s) => s.id === selectedConfigSubjectId) || activeSubject;
  const activeSubjectConcepts = concepts.filter((c) => c.subjectId === activeConfigSubject.id);

  const currentSubjectConfig = editingSettings.subjectConfigs[activeConfigSubject.id] || {
    subjectId: activeConfigSubject.id,
    selectedConceptIds: activeSubjectConcepts.map((c) => c.id),
    selectedProblemTypes: [
      activeConfigSubject.domain === 'math_stats' ? 'essay_descriptive' : 'impl_descriptive',
    ],
    includeMockExam: true,
    mockExamTargetMinutes: 45,
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(editingSettings);
    setActiveTab('plan');
    onRecalculatePlan();
  };

  const handleToggleConceptScope = (conceptId: string) => {
    const prevList = currentSubjectConfig.selectedConceptIds || [];
    const exists = prevList.includes(conceptId);
    const nextList = exists ? prevList.filter((id) => id !== conceptId) : [...prevList, conceptId];

    setEditingSettings({
      ...editingSettings,
      subjectConfigs: {
        ...editingSettings.subjectConfigs,
        [activeConfigSubject.id]: {
          ...currentSubjectConfig,
          selectedConceptIds: nextList,
        },
      },
    });
  };

  const handleSelectAllConcepts = () => {
    setEditingSettings({
      ...editingSettings,
      subjectConfigs: {
        ...editingSettings.subjectConfigs,
        [activeConfigSubject.id]: {
          ...currentSubjectConfig,
          selectedConceptIds: activeSubjectConcepts.map((c) => c.id),
        },
      },
    });
  };

  const handleToggleProblemType = (type: ProblemType) => {
    const prevTypes = currentSubjectConfig.selectedProblemTypes || [];
    const exists = prevTypes.includes(type);
    let nextTypes = exists ? prevTypes.filter((t) => t !== type) : [...prevTypes, type];
    if (nextTypes.length === 0) {
      nextTypes = [type]; // Keep at least one type
    }

    setEditingSettings({
      ...editingSettings,
      subjectConfigs: {
        ...editingSettings.subjectConfigs,
        [activeConfigSubject.id]: {
          ...currentSubjectConfig,
          selectedProblemTypes: nextTypes,
        },
      },
    });
  };

  const mathTypes: { type: ProblemType; label: string }[] = [
    { type: 'essay_descriptive', label: '1. 대학 논술·서술형' },
    { type: 'calc_derivation', label: '2. 계산 유도형' },
    { type: 'proof_counterexample', label: '3. 증명 및 반례' },
    { type: 'error_spotting', label: '4. 오류 검증형' },
  ];

  const csTypes: { type: ProblemType; label: string }[] = [
    { type: 'impl_descriptive', label: '1. 구현 및 서술형' },
    { type: 'algorithm_optimization', label: '2. 알고리즘 최적화 설명' },
    { type: 'complexity_proof', label: '3. 시간/공간 복잡도 증명' },
    { type: 'debug_counterexample', label: '4. 디버깅 및 반례 분석' },
  ];

  const domainProblemTypes = activeConfigSubject.domain === 'math_stats' ? mathTypes : csTypes;

  const koreanDayNames = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-5xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-[#c52828]" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-academic-serif text-base sm:text-lg font-bold tracking-tight">
                  시험일까지의 학습 계획 (Learn my way STUDY PLAN)
                </h2>
                <span className="text-[10px] font-academic-mono bg-[#2a2825] text-[#ded6c8] px-2 py-0.5 rounded-xs border border-[#45423d]">
                  STAGE 9 DETERMINISTIC ENGINE
                </span>
              </div>
              <p className="text-[11px] text-[#ded6c8] font-academic-mono">
                시험 일정 · 시험 범위 · 복습 우선순위 · 하루 가용 시간 통합 계획
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#ded6c8] hover:text-white p-1 rounded-xs transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Control Bar: Tabs & Subject Filter */}
        <div className="bg-[#faf8f4] border-b border-[#e2ded6] px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-[#ede8de] p-0.5 rounded-xs">
            <button
              onClick={() => setActiveTab('plan')}
              className={`px-3 py-1 font-semibold rounded-xs transition-colors ${
                activeTab === 'plan'
                  ? 'bg-white text-[#191817] shadow-2xs'
                  : 'text-[#827d73] hover:text-[#191817]'
              }`}
            >
              날짜별 학습 계획
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1 font-semibold rounded-xs flex items-center gap-1 transition-colors ${
                activeTab === 'settings'
                  ? 'bg-white text-[#191817] shadow-2xs'
                  : 'text-[#827d73] hover:text-[#191817]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>계획 설정 (시간·범위)</span>
            </button>
          </div>

          {/* Subject Filter (Applies to Plan View) */}
          {activeTab === 'plan' && (
            <div className="flex items-center gap-2">
              <span className="text-[#827d73] font-academic-mono text-[11px]">과목 필터:</span>
              <select
                value={filterSubjectId}
                onChange={(e) => setFilterSubjectId(e.target.value)}
                className="bg-white border border-[#ded6c8] rounded-xs px-2.5 py-1 text-xs font-medium text-[#191817] focus:outline-none focus:border-[#c52828]"
              >
                <option value="all">전체 과목 (통합 예산)</option>
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} ({calculateDDay(sub.examAt).displayBadge})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs font-sans">
          {activeTab === 'plan' ? (
            <>
              {/* Summary Dashboard Banner */}
              <div className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-3.5 grid sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] font-academic-mono text-[#827d73]">오늘 학습 시간 (통합)</div>
                  <div className="text-base font-bold text-[#191817] flex items-baseline gap-1.5">
                    <span>{studyPlanSummary.todayAssignedMinutes}분 배정</span>
                    <span className="text-xs font-normal text-[#827d73]">
                      / {studyPlanSummary.todayAvailableMinutes}분 가용
                    </span>
                  </div>
                  <div className="w-full bg-[#ede8de] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#c52828] h-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          (studyPlanSummary.todayAssignedMinutes /
                            Math.max(1, studyPlanSummary.todayAvailableMinutes)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-academic-mono text-[#827d73]">오늘 항목 상태</div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="text-emerald-700">✓ 완료 {studyPlanSummary.todayCompletedCount}</span>
                    <span className="text-[#c8c2b5]">|</span>
                    <span className="text-[#191817]">대기 {studyPlanSummary.todayPendingCount}</span>
                  </div>
                  <div className="text-[10.5px] text-[#827d73]">
                    미배정(예산 초과): {studyPlanSummary.todayUnassignedCount}건
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-academic-mono text-[#827d73]">과목별 시험 D-Day</div>
                  <div className="flex flex-wrap gap-1.5">
                    {subjects.map((sub) => {
                      const dday = calculateDDay(sub.examAt);
                      return (
                        <span
                          key={sub.id}
                          className="text-[10px] font-academic-mono px-1.5 py-0.5 rounded-2xs bg-white border border-[#ded6c8] text-[#191817] font-semibold"
                        >
                          {sub.name.slice(0, 5)}...: <strong className="text-[#c52828]">{dday.displayBadge}</strong>
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-academic-mono text-[#827d73]">시험일까지 예상 시간 부족</div>
                  <div className="text-sm font-bold">
                    {studyPlanSummary.totalShortageMinutes > 0 ? (
                      <span className="text-[#c52828] flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>약 {studyPlanSummary.totalShortageMinutes}분 부족</span>
                      </span>
                    ) : (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>예산 내 학습 완료 가능</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-[#827d73]">
                    ※ 사용자 시간 예산을 임의로 증액하지 않습니다.
                  </div>
                </div>
              </div>

              {/* 7-Day Window Navigation */}
              <div className="flex items-center justify-between border-b border-[#f1ede4] pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-[#191817] font-academic-serif">
                    학습 일정표 ({visibleDays[0]?.date} ~ {visibleDays[visibleDays.length - 1]?.date})
                  </span>
                  <span className="text-[11px] font-academic-mono text-[#827d73]">
                    [현재 기록 기준 예상 계획]
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDayWindowOffset(Math.max(0, dayWindowOffset - 7))}
                    disabled={dayWindowOffset === 0}
                    className="p-1 border border-[#ded6c8] rounded-xs text-[#57544e] hover:bg-[#faf8f4] disabled:opacity-40"
                    title="이전 7일"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDayWindowOffset(dayWindowOffset + 7)}
                    disabled={dayWindowOffset + 7 >= filteredDays.length}
                    className="p-1 border border-[#ded6c8] rounded-xs text-[#57544e] hover:bg-[#faf8f4] disabled:opacity-40"
                    title="다음 7일"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Days List */}
              <div className="space-y-4">
                {visibleDays.map((day) => {
                  const isToday = day.date === studyPlanSummary.todayDate;
                  return (
                    <div
                      key={day.date}
                      className={`border rounded-xs p-3.5 transition-all ${
                        isToday
                          ? 'border-[#c52828] bg-white shadow-xs'
                          : day.isRestDay
                          ? 'border-[#e2ded6] bg-[#faf8f4]/60 opacity-80'
                          : 'border-[#ded6c8] bg-white'
                      }`}
                    >
                      {/* Day Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#f1ede4]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-academic-mono text-xs font-bold px-2 py-0.5 rounded-2xs ${
                              isToday
                                ? 'bg-[#c52828] text-white'
                                : 'bg-[#ede8de] text-[#191817]'
                            }`}
                          >
                            {day.dayLabel}
                          </span>
                          {isToday && (
                            <span className="text-[10.5px] font-bold text-[#c52828] font-academic-mono">
                              TODAY
                            </span>
                          )}
                          {day.isRestDay && (
                            <span className="text-[10px] font-academic-mono bg-stone-100 text-stone-600 border border-stone-300 px-1.5 py-0.2 rounded-2xs font-semibold">
                              휴식일 (가용 0분)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 font-academic-mono text-[11px] text-[#57544e]">
                          <Clock className="w-3.5 h-3.5 text-[#827d73]" />
                          <span>
                            가용 {day.availableMinutes}분 중 <strong>{day.assignedMinutes}분</strong> 배정
                          </span>
                        </div>
                      </div>

                      {/* Items for this day */}
                      {day.items.length === 0 ? (
                        <div className="text-center py-4 text-[#827d73] text-[11.5px] bg-[#faf8f4] border border-dashed border-[#ded6c8] rounded-xs">
                          {day.isRestDay
                            ? '지정된 휴식일입니다. 재충전 후 다음 학습을 준비하세요.'
                            : '배정된 학습 항목이 없습니다.'}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {day.items.map((item) => {
                            const isCompleted = item.status === 'completed';

                            return (
                              <div
                                key={item.id}
                                className={`p-2.5 rounded-xs border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all ${
                                  isCompleted
                                    ? 'bg-emerald-50/60 border-emerald-200'
                                    : item.needsProblemGeneration
                                    ? 'bg-amber-50/60 border-amber-200'
                                    : 'bg-white border-[#ded6c8] hover:border-[#191817]'
                                }`}
                              >
                                <div className="space-y-1 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`text-[10px] font-academic-mono font-bold px-1.5 py-0.2 rounded-2xs ${
                                        item.kind === 'initial_study'
                                          ? 'bg-blue-100 text-blue-900 border border-blue-300'
                                          : item.kind === 'vulnerability_fix'
                                          ? 'bg-rose-100 text-rose-900 border border-rose-300'
                                          : item.kind === 'mixed_mock_exam'
                                          ? 'bg-purple-100 text-purple-900 border border-purple-300'
                                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                                      }`}
                                    >
                                      {STUDY_PLAN_ITEM_KIND_LABELS[item.kind]}
                                    </span>

                                    <span className="font-academic-mono text-[10px] text-[#827d73]">
                                      {item.subjectName}
                                    </span>

                                    <strong className="text-xs text-[#191817]">
                                      {item.snapshotTitle}
                                    </strong>

                                    {item.isOutdatedProblem && (
                                      <span className="text-[10px] font-academic-mono bg-yellow-100 text-yellow-900 border border-yellow-300 px-1 rounded-2xs">
                                        원문 개정(재확인 필요)
                                      </span>
                                    )}

                                    {item.needsProblemGeneration && (
                                      <span className="text-[10px] font-academic-mono bg-red-100 text-red-900 border border-red-300 px-1 rounded-2xs font-bold">
                                        문제 생성 필요
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-[#57544e]">
                                    {item.snapshotDetail}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                                    <span className="font-academic-mono text-[#827d73] flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      <span>
                                        {item.estimatedMinutes}분
                                        {item.isEstimatedTime && ' (제품 추정 시간)'}
                                      </span>
                                    </span>
                                    <span className="text-[#c8c2b5]">·</span>
                                    <span className="text-[#191817] bg-[#faf8f4] border border-[#ede8de] px-1.5 py-0.2 rounded-2xs">
                                      💡 <strong>추천 이유:</strong> {item.priorityReason}
                                    </span>
                                  </div>

                                  {item.warningNote && (
                                    <div className="text-[10.5px] text-amber-900 bg-amber-50 p-1 border border-amber-200 rounded-2xs flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 text-amber-700" />
                                      <span>{item.warningNote}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Item Actions */}
                                <div className="flex items-center gap-1.5 shrink-0 pt-1 sm:pt-0">
                                  {isCompleted ? (
                                    <div className="flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2 py-1 rounded-xs font-semibold text-[11px]">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>학습 완료</span>
                                    </div>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => onStartItem(item)}
                                        className="bg-[#191817] hover:bg-[#c52828] text-white px-3 py-1.5 rounded-xs font-semibold text-xs flex items-center gap-1 transition-colors shadow-2xs"
                                        title={
                                          item.needsProblemGeneration
                                            ? '문제 생성 및 검토 화면 열기'
                                            : '학습 및 풀이 시작'
                                        }
                                      >
                                        <Play className="w-3 h-3 fill-white" />
                                        <span>
                                          {item.needsProblemGeneration
                                            ? '문제 출제'
                                            : item.kind === 'initial_study'
                                            ? '개념 정독'
                                            : item.kind === 'mixed_mock_exam'
                                            ? '모의시험'
                                            : '풀이 시작'}
                                        </span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => onPostponeItem(item)}
                                        className="p-1.5 text-[#827d73] hover:text-[#191817] hover:bg-[#faf8f4] border border-[#ded6c8] rounded-xs transition-colors"
                                        title="내일로 미루기 (점수 불변, 일정만 재배치)"
                                      >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => onSkipItem(item)}
                                        className="p-1.5 text-[#827d73] hover:text-[#c52828] hover:bg-[#fef2f2] border border-[#ded6c8] rounded-xs transition-colors"
                                        title="이번 계획에서 건너뛰기 (시험 범위는 유지)"
                                      >
                                        <SkipForward className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Unassigned Items Section */}
              {unassignedItems.length > 0 && (
                <div className="border border-amber-200 bg-amber-50/40 rounded-xs p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      <span>예산 초과 미배정 항목 ({unassignedItems.length}건)</span>
                    </div>
                    <span className="text-[11px] text-[#827d73]">
                      하루 시간 예산 한도로 인해 아직 날짜에 배정되지 못한 항목입니다.
                    </span>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    {unassignedItems.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white p-2 border border-amber-200 rounded-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#191817] truncate">{item.snapshotTitle}</span>
                          <span className="font-academic-mono text-[10px] text-[#827d73]">{item.estimatedMinutes}분</span>
                        </div>
                        <p className="text-[11px] text-[#57544e] line-clamp-1">{item.priorityReason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scope Remaining By Subject */}
              <div className="border border-[#ded6c8] bg-[#faf8f4] rounded-xs p-3.5 space-y-2">
                <div className="font-bold text-xs text-[#191817] font-academic-serif">
                  시험 범위 잔여 개념 및 학습 진행도
                </div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  {studyPlanSummary.scopeRemainingBySubject.map((sr) => (
                    <div key={sr.subjectId} className="bg-white p-2.5 border border-[#ede8de] rounded-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <strong>{sr.subjectName}</strong>
                        <span className="font-academic-mono text-[11px] text-[#827d73]">
                          범위 {sr.totalScopeConcepts}개 개념
                        </span>
                      </div>
                      <div className="text-[11px] text-[#57544e]">
                        학습 완료: {sr.studiedConceptsCount}개 · 미학습 잔여:{' '}
                        <strong className="text-[#c52828]">{sr.unstudiedConceptsCount}개</strong>
                      </div>
                      {sr.unstudiedConceptTitles.length > 0 && (
                        <div className="text-[10px] text-[#827d73] bg-[#faf8f4] p-1.5 rounded-2xs border border-[#f1ede4]">
                          잔여 미학습: {sr.unstudiedConceptTitles.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Settings Form View */
            <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl mx-auto">
              {/* 1. Global Daily Minutes */}
              <div className="border border-[#ded6c8] bg-white p-4 rounded-xs space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#191817] border-b border-[#f1ede4] pb-2 font-academic-serif">
                  <Clock className="w-4 h-4 text-[#c52828]" />
                  <span>1. 하루 기본 학습 시간 (전 과목 합산)</span>
                </div>
                <p className="text-[11.5px] text-[#827d73]">
                  전 과목을 하나의 시간 예산 안에서 배치합니다. 과목마다 60분을 중복 배정하지 않습니다.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={10}
                    max={600}
                    step={5}
                    value={editingSettings.defaultDailyMinutes}
                    onChange={(e) =>
                      setEditingSettings({
                        ...editingSettings,
                        defaultDailyMinutes: Number(e.target.value) || 60,
                      })
                    }
                    className="w-28 p-2 border border-[#ded6c8] rounded-xs text-sm font-bold font-academic-mono"
                    required
                  />
                  <span className="text-xs text-[#57544e]">분 / 일 (기본 60분)</span>
                </div>
              </div>

              {/* 2. Weekday Overrides & Rest Days */}
              <div className="border border-[#ded6c8] bg-white p-4 rounded-xs space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#191817] border-b border-[#f1ede4] pb-2 font-academic-serif">
                  <Calendar className="w-4 h-4 text-[#c52828]" />
                  <span>2. 요일별 학습 시간 및 휴식일 지정</span>
                </div>
                <p className="text-[11.5px] text-[#827d73]">
                  기본 시간을 상속받되, 요일별로 시간을 다르게 하거나 휴식일(0분)을 설정할 수 있습니다.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                    const cfg: WeekdayStudyTime = editingSettings.weekdaySettings[dow] || {
                      dayOfWeek: dow,
                      minutes: editingSettings.defaultDailyMinutes,
                      isRestDay: false,
                    };

                    return (
                      <div
                        key={dow}
                        className={`p-2 border rounded-xs text-center space-y-1.5 ${
                          cfg.isRestDay ? 'bg-[#faf8f4] border-[#ded6c8]' : 'bg-white border-[#ded6c8]'
                        }`}
                      >
                        <div className="font-bold text-xs text-[#191817]">
                          {koreanDayNames[dow]}요일
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={600}
                          step={5}
                          disabled={cfg.isRestDay}
                          value={cfg.minutes}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            setEditingSettings({
                              ...editingSettings,
                              weekdaySettings: {
                                ...editingSettings.weekdaySettings,
                                [dow]: { ...cfg, minutes: val },
                              },
                            });
                          }}
                          className="w-full p-1 border border-[#ded6c8] rounded-xs text-center font-academic-mono text-xs font-semibold disabled:bg-stone-100 disabled:text-stone-400"
                        />
                        <label className="flex items-center justify-center gap-1 text-[10.5px] cursor-pointer text-[#57544e]">
                          <input
                            type="checkbox"
                            checked={cfg.isRestDay}
                            onChange={(e) => {
                              const isChecked = e.target.checked;
                              setEditingSettings({
                                ...editingSettings,
                                weekdaySettings: {
                                  ...editingSettings.weekdaySettings,
                                  [dow]: {
                                    ...cfg,
                                    isRestDay: isChecked,
                                    minutes: isChecked ? 0 : editingSettings.defaultDailyMinutes,
                                  },
                                },
                              });
                            }}
                          />
                          <span>휴식일</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Subject-Specific Scope & Mock Exam Config */}
              <div className="border border-[#ded6c8] bg-white p-4 rounded-xs space-y-4">
                <div className="flex items-center justify-between border-b border-[#f1ede4] pb-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#191817] font-academic-serif">
                    <Layers className="w-4 h-4 text-[#c52828]" />
                    <span>3. 과목별 시험 범위 및 출제 유형 설정</span>
                  </div>

                  {/* Subject Tab Selector */}
                  <div className="flex gap-1">
                    {subjects.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedConfigSubjectId(sub.id)}
                        className={`px-2.5 py-1 text-xs rounded-xs font-medium border ${
                          sub.id === selectedConfigSubjectId
                            ? 'bg-[#191817] text-white border-[#191817]'
                            : 'bg-[#faf8f4] text-[#57544e] border-[#ded6c8]'
                        }`}
                      >
                        {sub.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scope Concept Selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-xs text-[#191817]">
                      시험 범위 개념 선택 ({currentSubjectConfig.selectedConceptIds?.length || 0} /{' '}
                      {activeSubjectConcepts.length}개):
                    </label>
                    <button
                      type="button"
                      onClick={handleSelectAllConcepts}
                      className="text-[#c52828] hover:underline text-[11px] font-semibold"
                    >
                      전체 개념 선택
                    </button>
                  </div>
                  <p className="text-[11px] text-[#827d73]">
                    ※ 자유 텍스트만으로 범위를 자동 확정하지 않으며, 계획에 포함할 개념을 명시적으로 체크합니다.
                  </p>

                  <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4]">
                    {activeSubjectConcepts.map((c) => {
                      const isChecked = currentSubjectConfig.selectedConceptIds?.includes(c.id);
                      const isUnstudied =
                        c.status === 'unstudied' || (!c.isLearned && (!c.events || c.events.length === 0));

                      return (
                        <label
                          key={c.id}
                          className={`flex items-start gap-2 p-2 rounded-xs border text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? 'bg-white border-[#191817]'
                              : 'bg-white/50 border-[#ede8de] opacity-75'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleConceptScope(c.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-[#191817] flex items-center justify-between">
                              <span>{c.title}</span>
                              <span
                                className={`text-[10px] font-academic-mono px-1 rounded-2xs ${
                                  isUnstudied
                                    ? 'bg-slate-100 text-slate-700'
                                    : 'bg-emerald-50 text-emerald-800'
                                }`}
                              >
                                {isUnstudied ? '미학습' : `${c.currentScore.toFixed(0)}점`}
                              </span>
                            </div>
                            <div className="text-[10.5px] text-[#827d73]">{c.chapterRef}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Problem Types Selection */}
                <div className="space-y-2">
                  <label className="font-semibold text-xs text-[#191817]">
                    문제 출제 유형 (복수 선택 가능):
                  </label>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {domainProblemTypes.map((pt) => {
                      const isChecked = currentSubjectConfig.selectedProblemTypes?.includes(pt.type);
                      return (
                        <label
                          key={pt.type}
                          className={`flex items-center gap-2 p-2 rounded-xs border text-xs cursor-pointer ${
                            isChecked ? 'bg-[#faf8f4] border-[#191817] font-semibold' : 'bg-white border-[#ded6c8]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleProblemType(pt.type)}
                          />
                          <span>{pt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Mock Exam Target Settings */}
                <div className="space-y-2 border-t border-[#f1ede4] pt-3">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#191817]">
                    <input
                      type="checkbox"
                      checked={currentSubjectConfig.includeMockExam}
                      onChange={(e) =>
                        setEditingSettings({
                          ...editingSettings,
                          subjectConfigs: {
                            ...editingSettings.subjectConfigs,
                            [activeConfigSubject.id]: {
                              ...currentSubjectConfig,
                              includeMockExam: e.target.checked,
                            },
                          },
                        })
                      }
                    />
                    <span>혼합 모의시험 일정 포함</span>
                  </label>

                  {currentSubjectConfig.includeMockExam && (
                    <div className="flex items-center gap-3 pl-6">
                      <span className="text-[11.5px] text-[#57544e]">모의시험 목표 시간:</span>
                      <input
                        type="number"
                        min={15}
                        max={180}
                        step={5}
                        value={currentSubjectConfig.mockExamTargetMinutes}
                        onChange={(e) =>
                          setEditingSettings({
                            ...editingSettings,
                            subjectConfigs: {
                              ...editingSettings.subjectConfigs,
                              [activeConfigSubject.id]: {
                                ...currentSubjectConfig,
                                mockExamTargetMinutes: Number(e.target.value) || 45,
                              },
                            },
                          })
                        }
                        className="w-24 p-1.5 border border-[#ded6c8] rounded-xs font-academic-mono text-xs font-bold"
                      />
                      <span className="text-xs text-[#57544e]">분 (하루 예산 내 포함)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('plan')}
                  className="px-4 py-2 border border-[#ded6c8] rounded-xs text-[#57544e] hover:bg-[#faf8f4]"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-[#c52828] hover:bg-[#a82020] text-white px-5 py-2 rounded-xs font-bold shadow-2xs transition-colors"
                >
                  설정 저장 및 학습 계획 재계산
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
