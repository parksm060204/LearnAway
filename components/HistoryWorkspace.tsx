'use client';

import React, { useState, useMemo } from 'react';
import {
  Subject,
  Concept,
  Problem,
  Attempt,
  MockExamSession,
  PersonalizationSettings,
  PersonalizationCorrectionState,
  ProblemReportType,
  ReviewEvent,
} from '../lib/types';
import { ArchiveRecordDetail } from './ArchiveRecordDetail';
import {
  BarChart3,
  Search,
} from 'lucide-react';
import { formatSeoulDate } from '../lib/dateUtils';

export interface HistoryWorkspaceProps {
  activeSubject: Subject;
  subjects: Subject[];
  concepts: Concept[];
  problems: Problem[];
  attempts: Attempt[];
  mockExams: MockExamSession[];
  personalizationSettings: PersonalizationSettings;
  correctionState?: PersonalizationCorrectionState;
  onUpdatePersonalizationSettings?: (settings: PersonalizationSettings) => void;
  onResetPersonalizationSettings?: () => void;
  onRecalculateCorrection?: () => void;
  onOpenLogicStrengthen?: (attempt: Attempt) => void;
  onOpenSourceModal?: (sourceRef: string) => void;
  onReportProblem?: (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => { success: boolean; error?: string };
  initialSelectedAttemptId?: string | null;
}

export function HistoryWorkspace({
  activeSubject,
  concepts,
  problems,
  attempts,
  onOpenLogicStrengthen,
  onOpenSourceModal,
  onReportProblem,
  initialSelectedAttemptId,
}: HistoryWorkspaceProps) {
  const [periodFilter, setPeriodFilter] = useState<'7days' | '30days' | 'all'>('30days');
  const [conceptFilter, setConceptFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(initialSelectedAttemptId || null);
  const [referenceTime] = useState(() => Date.now());

  // Subject attempts
  const subjectAttempts = useMemo(() => {
    return attempts.filter((a) => a.subjectId === activeSubject.id);
  }, [attempts, activeSubject.id]);

  // Filtered by period, concept, search
  const filteredAttempts = useMemo(() => {
    const ms7Days = 7 * 24 * 60 * 60 * 1000;
    const ms30Days = 30 * 24 * 60 * 60 * 1000;

    return subjectAttempts
      .filter((att) => {
        const attTime = new Date(att.at).getTime();
        if (periodFilter === '7days' && referenceTime - attTime > ms7Days) return false;
        if (periodFilter === '30days' && referenceTime - attTime > ms30Days) return false;

        if (conceptFilter !== 'all') {
          const matchConcept = att.conceptId === conceptFilter || att.conceptIds?.includes(conceptFilter);
          if (!matchConcept) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchNotes = att.reasoningNotes?.toLowerCase().includes(q);
          const matchAnswer = att.answer?.toLowerCase().includes(q);
          const prob = problems.find((p) => p.id === att.problemId);
          const matchProblem = prob?.title?.toLowerCase().includes(q);
          if (!matchNotes && !matchAnswer && !matchProblem) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [subjectAttempts, periodFilter, conceptFilter, searchQuery, problems, referenceTime]);

  // Set default selected attempt if none is selected
  const activeSelectedAttempt = useMemo(() => {
    if (selectedAttemptId) {
      const found = subjectAttempts.find((a) => a.id === selectedAttemptId);
      if (found) return found;
    }
    return filteredAttempts[0] || null;
  }, [selectedAttemptId, subjectAttempts, filteredAttempts]);

  // Find concept and problem for active selected attempt
  const activeConcept = useMemo(() => {
    if (!activeSelectedAttempt) return null;
    return concepts.find((c) => c.id === activeSelectedAttempt.conceptId) || null;
  }, [activeSelectedAttempt, concepts]);

  const activeProblem = useMemo(() => {
    if (!activeSelectedAttempt) return null;
    return problems.find((p) => p.id === activeSelectedAttempt.problemId) || null;
  }, [activeSelectedAttempt, problems]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = subjectAttempts.length;
    if (total === 0) return { total: 0, avgScore: 0, passRate: 0, weakConcepts: [] };

    const sumScore = subjectAttempts.reduce((acc, a) => acc + (a.calculatedScore || 0), 0);
    const avgScore = Math.round(sumScore / total);
    const passCount = subjectAttempts.filter((a) => (a.calculatedScore || 0) >= 70).length;
    const passRate = Math.round((passCount / total) * 100);

    // Concept score map
    const conceptScores: Record<string, { total: number; sum: number }> = {};
    for (const a of subjectAttempts) {
      if (!conceptScores[a.conceptId]) conceptScores[a.conceptId] = { total: 0, sum: 0 };
      conceptScores[a.conceptId].total += 1;
      conceptScores[a.conceptId].sum += a.calculatedScore || 0;
    }

    const weak = Object.entries(conceptScores)
      .map(([id, data]) => {
        const c = concepts.find((x) => x.id === id);
        return {
          id,
          title: c?.title || id,
          avg: Math.round(data.sum / data.total),
          count: data.total,
        };
      })
      .filter((w) => w.avg < 70)
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 3);

    return { total, avgScore, passRate, weakConcepts: weak };
  }, [subjectAttempts, concepts]);

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <div className="bg-white border border-[#e2ded6] rounded-xs p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base sm:text-lg font-bold font-academic-serif text-[#191817]">
                {activeSubject.name} 학습 기록 및 분석
              </h2>
              <span className="text-xs font-academic-mono px-2 py-0.5 bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] rounded-xs font-medium">
                {activeSubject.code}
              </span>
            </div>
            <p className="text-xs text-[#827d73] font-academic-mono">
              누적 풀이 {stats.total}회 · 평균 점수 {stats.avgScore}점 · 합격선 달성률 {stats.passRate}%
            </p>
          </div>

          {/* Period Tabs */}
          <div className="flex items-center gap-1 bg-[#faf8f4] border border-[#ded6c8] p-1 rounded-xs">
            <button
              type="button"
              onClick={() => setPeriodFilter('7days')}
              className={`px-3 py-1 text-xs font-academic-mono rounded-xs transition-colors ${
                periodFilter === '7days' ? 'bg-[#191817] text-white font-bold' : 'text-[#57544e] hover:text-[#191817]'
              }`}
            >
              최근 7일
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('30days')}
              className={`px-3 py-1 text-xs font-academic-mono rounded-xs transition-colors ${
                periodFilter === '30days' ? 'bg-[#191817] text-white font-bold' : 'text-[#57544e] hover:text-[#191817]'
              }`}
            >
              최근 30일
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('all')}
              className={`px-3 py-1 text-xs font-academic-mono rounded-xs transition-colors ${
                periodFilter === 'all' ? 'bg-[#191817] text-white font-bold' : 'text-[#57544e] hover:text-[#191817]'
              }`}
            >
              전체 기간
            </button>
          </div>
        </div>

        {/* Aggregate KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#f1ede4]">
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
            <div className="text-[11px] font-academic-mono text-[#827d73] mb-1">누적 풀이 횟수</div>
            <div className="text-lg font-bold font-academic-mono text-[#191817]">{stats.total}회</div>
          </div>
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
            <div className="text-[11px] font-academic-mono text-[#827d73] mb-1">평균 루브릭 점수</div>
            <div className="text-lg font-bold font-academic-mono text-[#191817]">{stats.avgScore}점</div>
          </div>
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
            <div className="text-[11px] font-academic-mono text-[#827d73] mb-1">70점 이상 달성률</div>
            <div className="text-lg font-bold font-academic-mono text-emerald-700">{stats.passRate}%</div>
          </div>
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
            <div className="text-[11px] font-academic-mono text-[#827d73] mb-1">취약 개념 (보완 요망)</div>
            <div className="text-xs font-semibold text-[#c52828] truncate">
              {stats.weakConcepts.length > 0 ? stats.weakConcepts.map((w) => w.title).join(', ') : '취약 개념 없음'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {subjectAttempts.length === 0 ? (
        <div className="bg-white border border-[#e2ded6] rounded-xs p-12 text-center shadow-2xs">
          <div className="w-12 h-12 bg-[#faf8f4] border border-[#ded6c8] rounded-full flex items-center justify-center text-[#827d73] mx-auto mb-3">
            <BarChart3 className="w-6 h-6 stroke-1 text-[#827d73]" />
          </div>
          <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-1">
            아직 완료된 학습 기록이 없습니다.
          </h3>
          <p className="text-xs text-[#57544e] max-w-md mx-auto mb-4 leading-relaxed">
            오늘 학습에서 오늘의 복습을 시작하거나, 문제은행에서 서술·논술형 문제를 풀면 채점 스냅샷과 평가 결과가 이곳에 영구 보존됩니다.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column: Attempt History List (5 cols) */}
          <div className="lg:col-span-5 bg-white border border-[#e2ded6] rounded-xs p-4 shadow-2xs space-y-3">
            {/* Filter and search */}
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <select
                value={conceptFilter}
                onChange={(e) => setConceptFilter(e.target.value)}
                className="w-full sm:w-1/2 px-2.5 py-1 text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
              >
                <option value="all">전체 개념 ({concepts.length})</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-1/2">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#827d73]" />
                <input
                  type="text"
                  placeholder="문제·답안 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1 text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
                />
              </div>
            </div>

            {/* List */}
            <div className="max-h-[640px] overflow-y-auto space-y-2 pr-1">
              {filteredAttempts.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#827d73]">
                  선택한 필터 조건에 맞는 풀이 기록이 없습니다.
                </div>
              ) : (
                filteredAttempts.map((att) => {
                  const prob = problems.find((p) => p.id === att.problemId);
                  const conc = concepts.find((c) => c.id === att.conceptId);
                  const isSelected = activeSelectedAttempt?.id === att.id;

                  return (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setSelectedAttemptId(att.id)}
                      className={`w-full text-left p-3 rounded-xs border transition-all ${
                        isSelected
                          ? 'bg-[#fef2f2] border-[#c52828] shadow-2xs'
                          : 'bg-[#faf8f4] hover:bg-white border-[#ded6c8]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-academic-mono text-[#827d73]">
                          {formatSeoulDate(att.at)}
                        </span>
                        <span
                          className={`text-xs font-academic-mono font-bold px-1.5 py-0.2 rounded-2xs ${
                            (att.calculatedScore || 0) >= 80
                              ? 'bg-emerald-100 text-emerald-800'
                              : (att.calculatedScore || 0) >= 60
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {att.calculatedScore ?? '-'}점
                        </span>
                      </div>

                      <div className="font-semibold text-xs text-[#191817] truncate mb-1">
                        {prob?.title || att.problemTitleSnapshot || '문제 제목 미확인'}
                      </div>

                      <div className="flex items-center gap-1.5 text-[10px] font-academic-mono text-[#827d73]">
                        <span className="truncate">#{conc?.title || att.conceptId}</span>
                        {att.mockExamSessionId && (
                          <span className="text-purple-700 bg-purple-50 px-1 rounded-2xs border border-purple-200">
                            모의시험
                          </span>
                        )}
                        {att.attemptOrigin === 'rechallenge' && (
                          <span className="text-blue-700 bg-blue-50 px-1 rounded-2xs border border-blue-200">
                            재도전
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Detailed Snapshot Viewer (7 cols) */}
          <div className="lg:col-span-7 bg-white border border-[#e2ded6] rounded-xs p-5 shadow-2xs">
            {activeSelectedAttempt && activeConcept ? (
              <div>
                <div className="border-b border-[#f1ede4] pb-3 mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-academic-serif font-bold text-sm sm:text-base text-[#191817]">
                      풀이 및 채점 스냅샷 상세
                    </h3>
                    <div className="text-[11px] font-academic-mono text-[#827d73]">
                      기록 ID: {activeSelectedAttempt.id} · 일시: {formatSeoulDate(activeSelectedAttempt.at)}
                    </div>
                  </div>
                </div>

                {(() => {
                  const matchingEvent = activeConcept.events?.find(
                    (e) => e.attemptId === activeSelectedAttempt.id
                  );
                  const eventToPass: ReviewEvent = matchingEvent || {
                    id: `rev-${activeSelectedAttempt.id}`,
                    conceptId: activeConcept.id,
                    at: activeSelectedAttempt.at,
                    dayOffset: 0,
                    kind: 'attempt',
                    title: activeProblem?.title || activeConcept.title,
                    resultScore: activeSelectedAttempt.calculatedScore || 0,
                    sourceRef: activeProblem?.sourceRefs || activeConcept.chapterRef || '',
                    attemptId: activeSelectedAttempt.id,
                    rubricScores: activeSelectedAttempt.rubricResults,
                    evaluationSummary: activeSelectedAttempt.evaluatorFeedback,
                  };

                  return (
                    <ArchiveRecordDetail
                      concept={activeConcept}
                      event={eventToPass}
                      attempts={subjectAttempts}
                      problems={problems}
                      onOpenSourceModal={onOpenSourceModal || (() => {})}
                      onReportProblem={onReportProblem}
                      onOpenLogicStrengthen={onOpenLogicStrengthen}
                    />
                  );
                })()}
              </div>
            ) : (
              <div className="py-20 text-center text-xs text-[#827d73]">
                왼쪽 목록에서 확인하려는 풀이 기록을 선택하세요.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
