'use client';

import React, { useState, useMemo } from 'react';
import {
  Subject,
  Problem,
  ProblemDraft,
  Concept,
  Material,
  ProblemQualityStatus,
  UnsavedProblemRevision,
  ACADEMIC_DIFFICULTY_LEVELS,
  toAcademicDifficultyLevel,
} from '../lib/types';
import { AcademicMathView } from './AcademicMathView';
import { ProblemQualityReviewTab } from './ProblemQualityReviewTab';
import type {
  ProblemConflictResolutionAction,
  ResolveProblemRevisionConflictResult,
} from '../lib/problemRevisionSync';
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
import {
  Badge,
  Button,
  EmptyState,
  Input,
  SectionCard,
  Select,
  WorkspaceHeader,
} from './ui/WorkspacePrimitives';

export interface ProblemsWorkspaceProps {
  activeSubject?: Subject | null;
  problems: Problem[];
  drafts: ProblemDraft[];
  materials?: Material[];
  concepts: Concept[];
  onOpenGenerator: () => void;
  onOpenAddSubject?: () => void;
  onOpenUpload?: () => void;
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
  onReviseProblem?: (
    problemId: string,
    updates: Partial<Problem>,
    reason: string
  ) => {
    success: boolean;
    persisted?: boolean;
    partialFailure?: boolean;
    problemPersisted?: boolean;
    revisionPersisted?: boolean;
    error?: string;
  };
  onReapproveProblem?: (problemId: string, note?: string) => { success: boolean; error?: string };
  onSuspendProblem?: (problemId: string, reason?: string) => void;
  unsavedProblemRevisions?: Record<string, UnsavedProblemRevision>;
  onRetryVerifyProblemRevision?: (problemId: string) => Promise<void>;
  onResolveProblemRevisionConflict?: (
    problemId: string,
    action: ProblemConflictResolutionAction,
    expected?: { revisionId?: string; generation?: number; serverProblem?: Problem | null }
  ) => ResolveProblemRevisionConflictResult;
  onRetrySaveProblemRevision?: (problemId: string, expectedVersion?: number) => Promise<void>;
}

export function ProblemsWorkspace({
  activeSubject,
  problems = [],
  drafts = [],
  materials = [],
  concepts = [],
  onOpenGenerator,
  onOpenAddSubject,
  onOpenUpload,
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
  unsavedProblemRevisions,
  onRetryVerifyProblemRevision,
  onResolveProblemRevisionConflict,
  onRetrySaveProblemRevision,
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
    if (!activeSubject) return [];
    return problems.filter((p) => p.subjectId === activeSubject.id);
  }, [problems, activeSubject]);

  const subjectDrafts = useMemo(() => {
    if (!activeSubject) return [];
    return drafts.filter((d) => d.subjectId === activeSubject.id);
  }, [drafts, activeSubject]);

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

  if (!activeSubject) {
    return (
      <EmptyState
        icon={<FileQuestion className="w-5 h-5 stroke-1.5 text-[#827d73]" />}
        title="선택된 과목이 없습니다."
        description="문제은행을 열고 문제를 풀거나 출제하려면 먼저 과목을 추가하거나 선택해 주세요."
        actions={
          onOpenAddSubject ? (
            <Button variant="primary" size="md" onClick={onOpenAddSubject}>
              <Plus className="w-3.5 h-3.5 text-[#c52828]" />
              <span>새 과목 추가하기</span>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Top Header */}
      <WorkspaceHeader
        icon={<FileQuestion className="w-5 h-5" />}
        title={`${activeSubject.name} 문제은행`}
        subtitle={`승인된 문제 ${subjectProblems.length}건 · 미승인 초안 ${subjectDrafts.filter((d) => !d.isApproved).length}건 · 품질/신고 검토 ${subjectQualityCount}건`}
        actions={
          <>
            <Button variant="primary" size="md" onClick={onOpenGenerator}>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>AI 고난도 출제</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => onStartProblemSession()}
              title="서술·증명형 문제 풀기"
            >
              <Play className="w-3.5 h-3.5 text-[#c52828]" />
              <span>문제 풀기</span>
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onStartMockExam}
              title="혼합형 모의시험 응시"
            >
              <Award className="w-3.5 h-3.5 text-[#57544e]" />
              <span>모의시험</span>
            </Button>
          </>
        }
      >
        {/* In-progress Mock Exam Alert Banner */}
        {hasActiveMockSession && onResumeMockExam && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-700 shrink-0" />
              <span className="text-xs text-purple-900 font-semibold break-keep">
                이 과목에 진행 중인 모의시험 세션이 있습니다. 작성한 답안과 남은 시간이 안전하게 보존되어 있습니다.
              </span>
            </div>
            <Button variant="primary" size="sm" onClick={onResumeMockExam} className="bg-purple-700 hover:bg-purple-800 shrink-0">
              이어서 풀기
            </Button>
          </div>
        )}

        {/* No Concepts Prerequisite Warning Banner */}
        {concepts.length === 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-300 rounded-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs text-amber-900 font-semibold break-keep">
                과목에 등록된 학습 개념이 없습니다. 대학 시험 문제를 AI로 출제하려면 먼저 강의자료를 등록하고 개념을 추출해 주세요.
              </span>
            </div>
            {onOpenUpload && (
              <Button variant="primary" size="sm" onClick={onOpenUpload} className="shrink-0">
                자료 등록하기
              </Button>
            )}
          </div>
        )}
      </WorkspaceHeader>

      {/* Main Sub-Tabs */}
      <SectionCard padding="none" className="px-4 pt-3 border-b-0 overflow-x-auto">
        <div className="flex items-center gap-4 text-xs font-medium border-b border-[#e2ded6] whitespace-nowrap">
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
            <Badge variant="neutral" mono>
              {subjectProblems.length}
            </Badge>
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
              <Badge variant="info" mono>
                {subjectDrafts.filter((d) => !d.isApproved).length}
              </Badge>
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
              <Badge variant="danger" mono>
                <ShieldAlert className="w-2.5 h-2.5" />
                {subjectQualityCount}
              </Badge>
            )}
          </button>
        </div>
      </SectionCard>

      {/* Sub-Tab 1: Approved Problems */}
      {subTab === 'approved' && (
        <div className="space-y-3">
          {/* Filters Bar */}
          <SectionCard padding="sm" className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={conceptFilter}
                onChange={(e) => setConceptFilter(e.target.value)}
                aria-label="개념 필터"
                className="py-1.5 min-h-[34px]"
              >
                <option value="all">전체 개념 ({concepts.length})</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>

              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="문제 유형 필터"
                className="py-1.5 min-h-[34px]"
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
              </Select>
            </div>

            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-[#827d73] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="문제 제목 또는 지문 검색..."
                aria-label="문제 제목 또는 지문 검색"
                className="pl-8 py-1.5 min-h-[34px]"
              />
            </div>
          </SectionCard>

          {/* Problems List */}
          {filteredApprovedProblems.length === 0 ? (
            <EmptyState
              icon={<FileQuestion className="w-5 h-5 stroke-1.5 text-[#827d73]" />}
              title={
                searchQuery || conceptFilter !== 'all' || typeFilter !== 'all'
                  ? '조건에 맞는 시험 문제가 없습니다.'
                  : '승인된 시험 문제가 없습니다.'
              }
              description={
                searchQuery || conceptFilter !== 'all' || typeFilter !== 'all'
                  ? '필터 설정을 변경하거나 검색어를 비워보세요.'
                  : 'AI 고난도 출제를 통해 대학 시험 수준의 논술·증명 문제를 생성하고 검토해 보세요.'
              }
              actions={
                <Button variant="primary" size="md" onClick={onOpenGenerator}>
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>AI 문제 출제하기</span>
                </Button>
              }
            />
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
                          {(() => {
                            const diffLevel = toAcademicDifficultyLevel(prob.difficultyLevel ?? prob.difficulty);
                            const diffInfo = ACADEMIC_DIFFICULTY_LEVELS[diffLevel];
                            return (
                              <span
                                className="text-[10px] font-academic-mono bg-purple-50 text-purple-800 border border-purple-200 px-1.5 py-0.5 rounded-2xs font-semibold"
                                title={diffInfo.description}
                              >
                                Level {diffInfo.level} ({diffInfo.label})
                              </span>
                            );
                          })()}
                          {prob.sourceVerificationStatus === 'verified' && !prob.needsSourceReview && !prob.isOutdated && (
                            <span className="text-[10px] font-academic-mono bg-emerald-50 border border-emerald-300 text-emerald-800 px-1.5 py-0.5 rounded-2xs font-semibold flex items-center gap-1">
                              출처 검증 완료
                            </span>
                          )}

                          {(prob.isOutdated || prob.needsSourceReview || prob.sourceVerificationStatus === 'needs_review') && (
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
            unsavedProblemRevisions={unsavedProblemRevisions}
            onRetryVerifyProblemRevision={onRetryVerifyProblemRevision}
            onResolveProblemRevisionConflict={onResolveProblemRevisionConflict}
            onRetrySaveProblemRevision={onRetrySaveProblemRevision}
          />
        </div>
      )}
    </div>
  );
}
