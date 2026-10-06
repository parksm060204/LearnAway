'use client';

import React, { useState, useMemo } from 'react';
import {
  Subject,
  Problem,
  ProblemDraft,
  Concept,
  Material,
  ProblemQualityStatus,
  PROBLEM_DIFFICULTY_LABELS,
} from '../lib/types';
import { AcademicMathView } from './AcademicMathView';
import { ProblemQualityReviewTab } from './ProblemQualityReviewTab';
import {
  FileQuestion,
  Sparkles,
  Plus,
  Play,
  Award,
  Search,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  CheckCheck,
  ShieldAlert,
} from 'lucide-react';

export interface ProblemsWorkspaceProps {
  activeSubject: Subject;
  problems: Problem[];
  drafts: ProblemDraft[];
  materials?: Material[];
  concepts: Concept[];
  onOpenGenerator: () => void;
  onStartProblemSession: (problemId?: string) => void;
  onStartMockExam: () => void;
  hasActiveMockSession?: boolean;
  onResumeMockExam?: () => void;
  onUpdateDraft: (draft: ProblemDraft) => void;
  onApproveDraft: (draftId: string) => void;
  onBatchApproveDrafts: (draftIds: string[]) => void;
  onDeleteDraft: (draftId: string) => void;
  onUpdateProblemQualityStatus?: (problemId: string, status: ProblemQualityStatus, note?: string) => void;
  onDismissReport?: (problemId: string, reportId: string, reason: string) => { success: boolean; error?: string };
  onReviseProblem?: (problemId: string, updates: Partial<Problem>, reason: string) => { success: boolean; error?: string };
  onReapproveProblem?: (problemId: string, note?: string) => { success: boolean; error?: string };
  onSuspendProblem?: (problemId: string, reason?: string) => void;
}

export function ProblemsWorkspace({
  activeSubject,
  problems = [],
  drafts = [],
  materials = [],
  concepts = [],
  onOpenGenerator,
  onStartProblemSession,
  onStartMockExam,
  hasActiveMockSession = false,
  onResumeMockExam,
  onApproveDraft,
  onBatchApproveDrafts,
  onDeleteDraft,
  onUpdateProblemQualityStatus,
  onDismissReport,
  onReviseProblem,
  onReapproveProblem,
  onSuspendProblem,
}: ProblemsWorkspaceProps) {
  const [subTab, setSubTab] = useState<'approved' | 'drafts' | 'quality_reports'>('approved');

  // Filters for approved problems
  const [conceptFilter, setConceptFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null);

  // Drafts state
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [draftFilterTab, setDraftFilterTab] = useState<'all' | 'pending' | 'needs_review'>('all');

  const subjectProblems = useMemo(() => {
    return problems.filter((p) => p.subjectId === activeSubject.id);
  }, [problems, activeSubject.id]);

  const subjectDrafts = useMemo(() => {
    return drafts.filter((d) => d.subjectId === activeSubject.id);
  }, [drafts, activeSubject.id]);

  const subjectQualityCount = useMemo(() => {
    return subjectProblems.filter(
      (p) =>
        p.qualityStatus === 'reported' ||
        p.qualityStatus === 'under_review' ||
        p.qualityStatus === 'review_after_edit'
    ).length;
  }, [subjectProblems]);

  // Filter approved problems
  const filteredApprovedProblems = useMemo(() => {
    return subjectProblems.filter((p) => {
      // Filter out suspended problems from general practice view
      if (p.qualityStatus === 'suspended') return false;

      if (conceptFilter !== 'all') {
        const matchesConcept = p.conceptIds?.includes(conceptFilter);
        if (!matchesConcept) return false;
      }

      if (typeFilter !== 'all' && p.type !== typeFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchPrompt = p.promptText.toLowerCase().includes(q);
        if (!matchTitle && !matchPrompt) return false;
      }

      return true;
    });
  }, [subjectProblems, conceptFilter, typeFilter, searchQuery]);

  // Filter drafts
  const filteredDrafts = useMemo(() => {
    return subjectDrafts.filter((d) => {
      if (draftFilterTab === 'pending') return !d.isApproved;
      if (draftFilterTab === 'needs_review') return d.status === 'needs_review';
      return true;
    });
  }, [subjectDrafts, draftFilterTab]);

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <div className="bg-white border border-[#e2ded6] rounded-xs p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileQuestion className="w-5 h-5 text-blue-600" />
              <h2 className="text-base sm:text-lg font-bold font-academic-serif text-[#191817]">
                {activeSubject.name} 문제은행
              </h2>
              <span className="text-xs font-academic-mono px-2 py-0.5 bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] rounded-xs font-medium">
                {activeSubject.code}
              </span>
            </div>
            <p className="text-xs text-[#827d73] font-academic-mono">
              승인된 문제 {subjectProblems.length}건 · 미승인 초안 {subjectDrafts.filter((d) => !d.isApproved).length}건 · 품질/신고 검토 {subjectQualityCount}건
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenGenerator}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#191817] hover:bg-[#33302b] rounded-xs flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>AI 고난도 출제</span>
            </button>

            <button
              type="button"
              onClick={() => onStartProblemSession()}
              className="px-3 py-1.5 text-xs font-semibold text-[#191817] bg-[#faf8f4] hover:bg-[#f1ede4] border border-[#ded6c8] rounded-xs flex items-center gap-1.5 transition-colors"
              title="서술·증명형 문제 풀기"
            >
              <Play className="w-3.5 h-3.5 text-[#c52828]" />
              <span>문제 풀기</span>
            </button>

            <button
              type="button"
              onClick={onStartMockExam}
              className="px-3 py-1.5 text-xs font-semibold text-purple-950 bg-purple-50 hover:bg-purple-100 border border-purple-300 rounded-xs flex items-center gap-1.5 transition-colors"
              title="혼합형 모의시험 응시"
            >
              <Award className="w-3.5 h-3.5 text-purple-600" />
              <span>모의시험</span>
            </button>
          </div>
        </div>

        {/* In-progress Mock Exam Alert Banner */}
        {hasActiveMockSession && onResumeMockExam && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-700 shrink-0" />
              <span className="text-xs text-purple-900 font-semibold">
                이 과목에 진행 중인 모의시험 세션이 있습니다. 작성한 답안과 남은 시간이 안전하게 보존되어 있습니다.
              </span>
            </div>
            <button
              type="button"
              onClick={onResumeMockExam}
              className="px-3 py-1 text-xs font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-xs shadow-2xs shrink-0 transition-colors"
            >
              이어서 풀기
            </button>
          </div>
        )}
      </div>

      {/* Main Sub-Tabs */}
      <div className="bg-white border border-[#e2ded6] rounded-xs px-4 pt-3 border-b-0 shadow-2xs">
        <div className="flex items-center gap-4 text-xs font-medium border-b border-[#e2ded6]">
          <button
            type="button"
            onClick={() => setSubTab('approved')}
            className={`pb-2.5 flex items-center gap-1.5 transition-colors border-b-2 ${
              subTab === 'approved'
                ? 'border-[#c52828] text-[#191817] font-bold'
                : 'border-transparent text-[#57544e] hover:text-[#191817]'
            }`}
          >
            <span>승인된 시험 문제</span>
            <span className="px-1.5 py-0.2 text-[10px] font-academic-mono bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] rounded-full">
              {subjectProblems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('drafts')}
            className={`pb-2.5 flex items-center gap-1.5 transition-colors border-b-2 ${
              subTab === 'drafts'
                ? 'border-[#c52828] text-[#191817] font-bold'
                : 'border-transparent text-[#57544e] hover:text-[#191817]'
            }`}
          >
            <span>AI 출제 초안 검토</span>
            {subjectDrafts.filter((d) => !d.isApproved).length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-academic-mono bg-blue-100 text-blue-800 border border-blue-300 rounded-full font-bold">
                {subjectDrafts.filter((d) => !d.isApproved).length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubTab('quality_reports')}
            className={`pb-2.5 flex items-center gap-1.5 transition-colors border-b-2 ${
              subTab === 'quality_reports'
                ? 'border-[#c52828] text-[#191817] font-bold'
                : 'border-transparent text-[#57544e] hover:text-[#191817]'
            }`}
          >
            <span>문제 품질 및 신고 관리</span>
            {subjectQualityCount > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-academic-mono bg-red-100 text-red-800 border border-red-300 rounded-full font-bold flex items-center gap-0.5">
                <ShieldAlert className="w-2.5 h-2.5 text-red-600" />
                {subjectQualityCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Sub-Tab 1: Approved Problems */}
      {subTab === 'approved' && (
        <div className="space-y-3">
          {/* Filters Bar */}
          <div className="bg-white border border-[#e2ded6] rounded-xs p-3 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* Concept Selector */}
              <select
                value={conceptFilter}
                onChange={(e) => setConceptFilter(e.target.value)}
                className="px-2.5 py-1 text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
              >
                <option value="all">전체 개념 ({concepts.length})</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              {/* Problem Type Selector */}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-2.5 py-1 text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
              >
                <option value="all">전체 문제 유형</option>
                <option value="essay_descriptive">논술·서술형</option>
                <option value="calc_derivation">계산 유도형</option>
                <option value="proof_counterexample">증명·반례</option>
                <option value="error_spotting">오류 검증형</option>
                <option value="impl_descriptive">구현 서술형</option>
                <option value="algorithm_optimization">알고리즘 최적화</option>
                <option value="complexity_proof">복잡도 증명</option>
                <option value="debug_counterexample">디버깅·반례</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-[#827d73] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="문제 제목 또는 지문 검색..."
                className="w-full pl-8 pr-3 py-1 text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817] placeholder-[#827d73] focus:outline-hidden focus:border-[#191817] focus:bg-white"
              />
            </div>
          </div>

          {/* Problems List */}
          {filteredApprovedProblems.length === 0 ? (
            <div className="bg-white border border-[#e2ded6] rounded-xs p-12 text-center shadow-2xs">
              <div className="w-12 h-12 bg-[#faf8f4] border border-[#ded6c8] rounded-full flex items-center justify-center text-[#827d73] mx-auto mb-3">
                <FileQuestion className="w-6 h-6 stroke-1 text-[#827d73]" />
              </div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-1">
                {searchQuery || conceptFilter !== 'all' || typeFilter !== 'all'
                  ? '조건에 맞는 시험 문제가 없습니다.'
                  : '승인된 시험 문제가 없습니다.'}
              </h3>
              <p className="text-xs text-[#57544e] max-w-md mx-auto mb-4 leading-relaxed">
                {searchQuery || conceptFilter !== 'all' || typeFilter !== 'all'
                  ? '필터 설정을 변경하거나 검색어를 비워보세요.'
                  : 'AI 고난도 출제를 통해 대학 시험 수준의 논술·증명 문제를 생성하고 검토해 보세요.'}
              </p>
              <button
                type="button"
                onClick={onOpenGenerator}
                className="px-4 py-2 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs inline-flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>AI 문제 출제하기</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApprovedProblems.map((prob) => {
                const isExpanded = expandedProblemId === prob.id;

                return (
                  <div
                    key={prob.id}
                    className="bg-white border border-[#e2ded6] hover:border-[#c8c2b5] rounded-xs p-4 sm:p-5 transition-all shadow-2xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="font-academic-serif font-bold text-sm sm:text-base text-[#191817]">
                            {prob.title}
                          </span>
                          <span className="text-[10px] font-academic-mono bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] px-1.5 py-0.5 rounded-2xs font-semibold">
                            {prob.categoryLabel}
                          </span>
                          <span className="text-[10px] font-academic-mono bg-[#ded6c8]/60 text-[#57544e] px-1.5 py-0.5 rounded-2xs">
                            v{prob.version || 1}
                          </span>
                          <span className="text-[10px] font-academic-mono bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded-2xs">
                            {prob.difficulty ? PROBLEM_DIFFICULTY_LABELS[prob.difficulty] || prob.difficulty : '기본 난이도'}
                          </span>

                          {prob.isOutdated && (
                            <span className="text-[10px] font-academic-mono bg-amber-50 border border-amber-300 text-amber-800 px-1.5 py-0.5 rounded-2xs font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                              출처 검토 필요
                            </span>
                          )}
                        </div>

                        {/* Connected Concepts */}
                        <div className="flex flex-wrap gap-1 mb-2">
                          {prob.conceptIds?.map((cId) => {
                            const c = concepts.find((x) => x.id === cId);
                            return (
                              <span
                                key={cId}
                                className="text-[10px] font-academic-mono bg-[#f4f1ea] text-[#57544e] border border-[#ded6c8] px-1.5 py-0.2 rounded-2xs"
                              >
                                #{c ? c.title : cId}
                              </span>
                            );
                          })}
                          <span className="text-[11px] font-academic-mono text-[#827d73] self-center ml-1">
                            표준 소요: {prob.timeStandardMinutes}분
                          </span>
                        </div>

                        {/* Prompt preview or full text */}
                        <div className="text-xs text-[#57544e] bg-[#faf8f4] border border-[#e2ded6] p-3 rounded-xs mb-3">
                          <div className={isExpanded ? '' : 'line-clamp-2'}>
                            <AcademicMathView content={prob.promptText} />
                          </div>
                        </div>

                        {/* Expanded Rubrics & Details */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-[#f1ede4] space-y-3 text-xs">
                            {prob.rubric && prob.rubric.length > 0 && (
                              <div>
                                <h4 className="font-academic-mono font-bold text-[11px] text-[#191817] mb-1.5">
                                  채점 루브릭 (총 {prob.rubric.reduce((acc, r) => acc + r.maxScore, 0)}점)
                                </h4>
                                <div className="space-y-1.5">
                                  {prob.rubric.map((r) => (
                                    <div
                                      key={r.id}
                                      className="p-2 bg-white border border-[#ded6c8] rounded-xs text-[11px] flex items-start justify-between gap-2"
                                    >
                                      <div>
                                        <div className="font-semibold text-[#191817]">{r.label}</div>
                                        <div className="text-[#827d73] mt-0.5">{r.description}</div>
                                      </div>
                                      <span className="font-academic-mono font-bold text-[#c52828] shrink-0">
                                        배점: {r.maxScore}점
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {prob.modelAnswer && (
                              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xs">
                                <h4 className="font-academic-mono font-bold text-[11px] text-emerald-950 mb-1">
                                  모범 답안 스냅샷
                                </h4>
                                <div className="text-[11px] text-[#191817]">
                                  <AcademicMathView content={prob.modelAnswer} />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right Action Buttons */}
                      <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onStartProblemSession(prob.id)}
                          className="px-3 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 shadow-xs transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 text-[#c52828]" />
                          <span>이 문제 풀기</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setExpandedProblemId(isExpanded ? null : prob.id)}
                          className="px-2.5 py-1 text-xs text-[#57544e] hover:text-[#191817] bg-[#faf8f4] border border-[#ded6c8] rounded-xs flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5" />
                              <span>접기</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5" />
                              <span>상세 보기</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Drafts Review */}
      {subTab === 'drafts' && (
        <div className="space-y-3">
          {/* Draft Action bar */}
          <div className="bg-white border border-[#e2ded6] rounded-xs p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftFilterTab('all')}
                className={`px-2.5 py-1 text-xs rounded-xs font-academic-mono ${
                  draftFilterTab === 'all'
                    ? 'bg-[#191817] text-white font-bold'
                    : 'text-[#57544e] hover:bg-[#faf8f4]'
                }`}
              >
                전체 초안 ({subjectDrafts.length})
              </button>
              <button
                type="button"
                onClick={() => setDraftFilterTab('pending')}
                className={`px-2.5 py-1 text-xs rounded-xs font-academic-mono ${
                  draftFilterTab === 'pending'
                    ? 'bg-[#191817] text-white font-bold'
                    : 'text-[#57544e] hover:bg-[#faf8f4]'
                }`}
              >
                미승인 대기 ({subjectDrafts.filter((d) => !d.isApproved).length})
              </button>
            </div>

            {selectedDraftIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#827d73]">
                  {selectedDraftIds.size}건 선택됨
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onBatchApproveDrafts(Array.from(selectedDraftIds));
                    setSelectedDraftIds(new Set());
                  }}
                  className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xs flex items-center gap-1 shadow-2xs"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>일괄 승인</span>
                </button>
              </div>
            )}
          </div>

          {filteredDrafts.length === 0 ? (
            <div className="bg-white border border-[#e2ded6] rounded-xs p-12 text-center shadow-2xs">
              <Sparkles className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-1">
                검토 대기 중인 초안이 없습니다.
              </h3>
              <p className="text-xs text-[#57544e] max-w-md mx-auto mb-4">
                새로운 AI 문제를 출제하여 초안을 생성해 보세요.
              </p>
              <button
                type="button"
                onClick={onOpenGenerator}
                className="px-4 py-2 bg-[#191817] text-white text-xs font-bold rounded-xs inline-flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-[#c52828]" />
                <span>문제 출제하기</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className="bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="checkbox"
                        checked={selectedDraftIds.has(draft.id)}
                        onChange={(e) => {
                          const next = new Set(selectedDraftIds);
                          if (e.target.checked) next.add(draft.id);
                          else next.delete(draft.id);
                          setSelectedDraftIds(next);
                        }}
                        className="rounded-xs border-[#ded6c8]"
                      />
                      <span className="font-bold text-sm font-academic-serif text-[#191817]">
                        {draft.title}
                      </span>
                      <span className="text-[10px] font-academic-mono bg-[#faf8f4] border border-[#ded6c8] px-1.5 py-0.5 rounded-2xs">
                        {draft.categoryLabel}
                      </span>
                      {draft.isApproved ? (
                        <span className="text-[10px] font-academic-mono bg-emerald-50 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded-2xs font-semibold">
                          승인 완료
                        </span>
                      ) : (
                        <span className="text-[10px] font-academic-mono bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded-2xs">
                          검토 대기
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!draft.isApproved && (
                        <button
                          type="button"
                          onClick={() => onApproveDraft(draft.id)}
                          className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xs flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>승인</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteDraft(draft.id)}
                        className="p-1 text-[#827d73] hover:text-red-600 rounded-xs"
                        title="초안 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-[#57544e] bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs mb-3">
                    <AcademicMathView content={draft.promptText} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 3: Problem Quality & Reports Tab */}
      {subTab === 'quality_reports' && (
        <div className="bg-white border border-[#e2ded6] rounded-xs p-5 shadow-2xs">
          <ProblemQualityReviewTab
            activeSubject={activeSubject}
            problems={subjectProblems}
            materials={materials}
            onUpdateQualityStatus={onUpdateProblemQualityStatus}
            onDismissReport={onDismissReport}
            onReviseProblem={onReviseProblem}
            onReapproveProblem={onReapproveProblem}
            onSuspendProblem={onSuspendProblem}
          />
        </div>
      )}
    </div>
  );
}
