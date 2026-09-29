'use client';

import React, { useState, useMemo } from 'react';
import {
  Subject,
  Concept,
  Problem,
  ProblemDraft,
  ProblemType,
  RubricCriterion,
  PROBLEM_DIFFICULTY_LABELS,
  Material,
} from '../lib/types';
import { MathFormula } from './MathFormula';
import { computeMarkdownHash } from '../lib/markdownUtils';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  CheckCheck,
  Search,
  Eye,
  EyeOff,
  Edit3,
  Play,
  HelpCircle,
  BrainCircuit,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Info,
  Layers,
  Plus,
} from 'lucide-react';
import { ProblemQualityReviewTab } from './ProblemQualityReviewTab';
import { ProblemQualityStatus } from '../lib/types';

interface ProblemReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSubject: Subject;
  drafts: ProblemDraft[];
  problems?: Problem[];
  concepts: Concept[];
  materials?: Material[];
  onUpdateDraft: (draft: ProblemDraft) => void;
  onApproveDraft: (draftId: string) => void;
  onBatchApproveDrafts: (draftIds: string[]) => void;
  onDeleteDraft: (draftId: string) => void;
  onStartPracticeSession?: (draft: ProblemDraft) => void;
  onOpenGenerator?: () => void;
  // Stage 6 Problem Quality:
  onUpdateProblemQualityStatus?: (problemId: string, newStatus: ProblemQualityStatus, note?: string) => void;
  onDismissReport?: (problemId: string, reportId: string, dismissReason: string) => { success: boolean; error?: string };
  onReviseProblem?: (problemId: string, updates: Partial<Problem>, editReason: string) => { success: boolean; error?: string };
  onReapproveProblem?: (problemId: string, reapprovalNote?: string) => { success: boolean; error?: string };
  onSuspendProblem?: (problemId: string, suspensionReason?: string) => void;
  onOpenSourceModal?: (sourceRef: string) => void;
  initialMode?: 'drafts' | 'quality_reports';
}

export function ProblemReviewModal({
  isOpen,
  onClose,
  activeSubject,
  drafts,
  problems = [],
  concepts,
  materials,
  onUpdateDraft,
  onApproveDraft,
  onBatchApproveDrafts,
  onDeleteDraft,
  onStartPracticeSession,
  onOpenGenerator,
  onUpdateProblemQualityStatus,
  onDismissReport,
  onReviseProblem,
  onReapproveProblem,
  onSuspendProblem,
  onOpenSourceModal,
  initialMode,
}: ProblemReviewModalProps) {
  // Mode switcher: 'drafts' vs 'quality_reports'
  const [mainMode, setMainMode] = useState<'drafts' | 'quality_reports'>(initialMode || 'drafts');

  // Filter drafts belonging to the active subject
  const subjectDrafts = useMemo(() => {
    return drafts.filter((d) => d.subjectId === activeSubject.id);
  }, [drafts, activeSubject.id]);

  // Count problems with quality issues for badge
  const subjectQualityCount = useMemo(() => {
    return problems.filter(
      (p) =>
        p.subjectId === activeSubject.id &&
        (p.qualityStatus === 'reported' ||
          p.qualityStatus === 'under_review' ||
          p.qualityStatus === 'review_after_edit')
    ).length;
  }, [problems, activeSubject.id]);

  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'needs_review' | 'approved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');
  const [isModelAnswerVisible, setIsModelAnswerVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Editable draft form state
  const [editTitle, setEditTitle] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editFormula, setEditFormula] = useState('');
  const [editCodeSnippet, setEditCodeSnippet] = useState('');
  const [editDesignIntent, setEditDesignIntent] = useState('');
  const [editAppliedNote, setEditAppliedNote] = useState('');
  const [editHints, setEditHints] = useState<string[]>([]);
  const [editModelAnswer, setEditModelAnswer] = useState('');
  const [editRubric, setEditRubric] = useState<RubricCriterion[]>([]);
  const [editTimeMinutes, setEditTimeMinutes] = useState(20);

  // Filtered drafts list
  const filteredDrafts = useMemo(() => {
    return subjectDrafts.filter((d) => {
      if (filterTab === 'pending' && (d.isApproved || d.status === 'needs_review')) return false;
      if (filterTab === 'needs_review' && d.status !== 'needs_review') return false;
      if (filterTab === 'approved' && !d.isApproved) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = d.title.toLowerCase().includes(q);
        const matchesPrompt = d.promptText.toLowerCase().includes(q);
        const matchesConcept = d.conceptTitles.some((t) => t.toLowerCase().includes(q));
        return matchesTitle || matchesPrompt || matchesConcept;
      }
      return true;
    });
  }, [subjectDrafts, filterTab, searchQuery]);

  // Current active draft
  const activeDraft = useMemo(() => {
    if (selectedDraftId) {
      const found = subjectDrafts.find((d) => d.id === selectedDraftId);
      if (found) return found;
    }
    return filteredDrafts[0] || subjectDrafts[0] || null;
  }, [selectedDraftId, filteredDrafts, subjectDrafts]);

  // Sync edit state when active draft changes
  React.useEffect(() => {
    if (activeDraft) {
      setEditTitle(activeDraft.title);
      setEditPrompt(activeDraft.promptText);
      setEditFormula(activeDraft.mathFormula || '');
      setEditCodeSnippet(activeDraft.codeSnippet || '');
      setEditDesignIntent(activeDraft.designIntent || '');
      setEditAppliedNote(activeDraft.appliedConditionNote || '');
      setEditHints([...activeDraft.hints]);
      setEditModelAnswer(activeDraft.modelAnswer || '');
      setEditRubric([...activeDraft.rubric]);
      setEditTimeMinutes(activeDraft.timeStandardMinutes || 20);
      setIsEditing(false);
      setIsModelAnswerVisible(false);
    }
  }, [activeDraft?.id]);

  // Check if active draft's source markdown hash differs from current subject material hash
  const isDraftOutdated = useMemo(() => {
    if (!materials || !activeDraft?.sourceMarkdownHash) return false;
    const subjMats = materials.filter((m) => m.subjectId === activeSubject.id && m.parsedMarkdown);
    if (subjMats.length === 0) return false;
    return subjMats.some((m) => computeMarkdownHash(m.parsedMarkdown || '') !== activeDraft.sourceMarkdownHash);
  }, [materials, activeDraft, activeSubject.id]);

  if (!isOpen) return null;

  // Rubric score sum calculation
  const currentRubricSum = (isEditing ? editRubric : activeDraft?.rubric || []).reduce(
    (sum, r) => sum + (Number(r.maxScore) || 0),
    0
  );

  const handleSaveEdits = () => {
    if (!activeDraft) return;

    if (currentRubricSum !== 100) {
      if (
        !confirm(
          `현재 채점 기준 배점 합계가 ${currentRubricSum}점입니다 (표준은 100점). 이대로 저장하시겠습니까?`
        )
      ) {
        return;
      }
    }

    const updated: ProblemDraft = {
      ...activeDraft,
      title: editTitle.trim() || activeDraft.title,
      promptText: editPrompt.trim() || activeDraft.promptText,
      mathFormula: editFormula.trim() || undefined,
      codeSnippet: editCodeSnippet.trim() || undefined,
      designIntent: editDesignIntent.trim() || activeDraft.designIntent,
      appliedConditionNote: editAppliedNote.trim() || activeDraft.appliedConditionNote,
      hints: editHints.filter((h) => h.trim().length > 0),
      modelAnswer: editModelAnswer.trim() || activeDraft.modelAnswer,
      rubric: editRubric,
      timeStandardMinutes: editTimeMinutes,
      timeBreakdownDesc: `${editTimeMinutes}분 (조건 분석 5분, 논리 서술 ${Math.max(
        editTimeMinutes - 8,
        5
      )}분, 검산 3분)`,
      verificationStatus: {
        ...activeDraft.verificationStatus,
        isScore100: currentRubricSum === 100,
        scoreSum: currentRubricSum,
        note: currentRubricSum === 100 ? '100점 배점 규격 검증 완료' : `배점 합계 ${currentRubricSum}점`,
      },
      updatedAt: new Date().toISOString(),
      editedByUser: true,
    };

    onUpdateDraft(updated);
    setIsEditing(false);
    alert('문제 초안 수정 내용이 저장되었습니다.');
  };

  const handleRubricScoreChange = (index: number, newScore: number) => {
    setEditRubric((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], maxScore: newScore, weight: newScore / 100 };
      return next;
    });
  };

  const handleRubricDescChange = (index: number, newDesc: string) => {
    setEditRubric((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], description: newDesc };
      return next;
    });
  };

  const handleAddRubricCriterion = () => {
    setEditRubric((prev) => [
      ...prev,
      {
        id: `r-${prev.length + 1}`,
        label: `${prev.length + 1}. 신규 평가 항목`,
        maxScore: 20,
        weight: 0.2,
        description: '평가 기준 서술',
      },
    ]);
  };

  const handleRemoveRubricCriterion = (index: number) => {
    if (editRubric.length <= 1) {
      alert('최소 1개 이상의 채점 기준이 필요합니다.');
      return;
    }
    setEditRubric((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBatchApprove = () => {
    const pendingIds = subjectDrafts.filter((d) => !d.isApproved).map((d) => d.id);
    if (pendingIds.length === 0) {
      alert('승인 대기 중인 문제가 없습니다.');
      return;
    }
    if (confirm(`승인 대기 중인 ${pendingIds.length}개 문제를 모두 승인하시겠습니까?`)) {
      onBatchApproveDrafts(pendingIds);
    }
  };

  const handleApproveCurrent = () => {
    if (!activeDraft) return;
    onApproveDraft(activeDraft.id);
  };

  const handleDeleteCurrent = () => {
    if (!activeDraft) return;
    if (confirm(`[${activeDraft.title}] 문제를 삭제하시겠습니까?`)) {
      onDeleteDraft(activeDraft.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-6xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col h-[94vh] animate-fade-in font-sans">
        {/* Top Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-[#33302b] shrink-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="w-2.5 h-2.5 bg-[#c52828] inline-block shrink-0" />
            <span className="font-academic-mono text-xs text-[#ded6c8]">EXAM PROBLEM REVIEW & QA</span>
            <span className="text-[#827d73]">|</span>
            <span className="text-xs sm:text-sm font-bold text-white">
              {activeSubject.name}
            </span>

            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1 bg-[#2b2723] p-0.5 rounded-xs border border-[#443e37] text-xs font-academic-mono ml-2">
              <button
                type="button"
                onClick={() => setMainMode('drafts')}
                className={`px-3 py-1 rounded-2xs transition-colors flex items-center gap-1.5 ${
                  mainMode === 'drafts'
                    ? 'bg-[#c52828] text-white font-bold shadow-2xs'
                    : 'text-[#ded6c8] hover:text-white'
                }`}
              >
                <span>AI 문제 초안 검토</span>
                <span className="px-1.5 py-0.2 bg-black/30 rounded-2xs text-[10px]">
                  {subjectDrafts.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMainMode('quality_reports')}
                className={`px-3 py-1 rounded-2xs transition-colors flex items-center gap-1.5 ${
                  mainMode === 'quality_reports'
                    ? 'bg-[#c52828] text-white font-bold shadow-2xs'
                    : subjectQualityCount > 0
                    ? 'text-amber-300 font-bold hover:text-amber-200'
                    : 'text-[#ded6c8] hover:text-white'
                }`}
              >
                {subjectQualityCount > 0 && (
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <span>문제 품질 & 신고 관리</span>
                {subjectQualityCount > 0 ? (
                  <span className="px-1.5 py-0.2 bg-red-600 text-white rounded-2xs text-[10px] font-bold">
                    {subjectQualityCount}건
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 bg-black/30 rounded-2xs text-[10px]">
                    {(problems || []).filter((p) => p.subjectId === activeSubject.id).length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {mainMode === 'drafts' && onOpenGenerator && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenGenerator();
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#c52828] hover:bg-[#a82020] text-white text-xs font-bold rounded-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>새 문제 출제</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="text-[#ded6c8] hover:text-white p-1 rounded-xs transition-colors"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {mainMode === 'quality_reports' ? (
          <ProblemQualityReviewTab
            activeSubject={activeSubject}
            problems={problems}
            materials={materials}
            onUpdateQualityStatus={onUpdateProblemQualityStatus}
            onDismissReport={onDismissReport}
            onReviseProblem={onReviseProblem}
            onReapproveProblem={onReapproveProblem}
            onSuspendProblem={onSuspendProblem}
            onOpenSourceModal={onOpenSourceModal}
          />
        ) : (
          <>
            {/* Action & Filter Strip */}
            <div className="bg-[#faf8f4] border-b border-[#ded6c8] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
              {/* Tabs */}
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`px-2.5 py-1 rounded-xs font-academic-mono transition-colors ${
                    filterTab === 'all'
                      ? 'bg-[#191817] text-white font-bold'
                      : 'bg-white text-[#57544e] border border-[#ded6c8] hover:bg-[#f1ede4]'
                  }`}
                >
                  전체 ({subjectDrafts.length})
                </button>

            <button
              type="button"
              onClick={() => setFilterTab('pending')}
              className={`px-2.5 py-1 rounded-xs font-academic-mono transition-colors ${
                filterTab === 'pending'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'bg-white text-[#57544e] border border-[#ded6c8] hover:bg-[#f1ede4]'
              }`}
            >
              승인 대기 ({subjectDrafts.filter((d) => !d.isApproved && d.status !== 'needs_review').length})
            </button>

            <button
              type="button"
              onClick={() => setFilterTab('needs_review')}
              className={`px-2.5 py-1 rounded-xs font-academic-mono transition-colors ${
                filterTab === 'needs_review'
                  ? 'bg-amber-800 text-white font-bold'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              검토 필요 ({subjectDrafts.filter((d) => d.status === 'needs_review' && !d.isApproved).length})
            </button>

            <button
              type="button"
              onClick={() => setFilterTab('approved')}
              className={`px-2.5 py-1 rounded-xs font-academic-mono transition-colors ${
                filterTab === 'approved'
                  ? 'bg-emerald-800 text-white font-bold'
                  : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              승인 완료 ({subjectDrafts.filter((d) => d.isApproved).length})
            </button>
          </div>

          {/* Batch Actions & Search */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#827d73] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="문제명, 개념명 검색..."
                className="pl-8 pr-2.5 py-1 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817] w-44 sm:w-56 focus:outline-none focus:border-[#c52828]"
              />
            </div>

            <button
              type="button"
              onClick={handleBatchApprove}
              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-[#f1ede4] border border-[#ded6c8] text-xs font-bold text-[#191817] rounded-xs transition-colors shadow-2xs"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>일괄 승인</span>
            </button>
          </div>
        </div>

        {/* 2-Column Main Workspace */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left Column: Problem Drafts List (Approx 38%) */}
          <div className="w-full md:w-80 lg:w-96 border-r border-[#ded6c8] bg-[#faf8f4] flex flex-col overflow-hidden shrink-0">
            <div className="p-2.5 border-b border-[#ded6c8] text-[11px] font-academic-mono text-[#827d73] flex justify-between items-center bg-[#f6f3eb]">
              <span>출제된 문제 초안 ({filteredDrafts.length}건)</span>
              <span>100점 만점 규격</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {filteredDrafts.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#827d73] space-y-2">
                  <BrainCircuit className="w-8 h-8 text-[#c8c2b5] mx-auto" />
                  <p>해당 조건의 문제 초안이 없습니다.</p>
                  {onOpenGenerator && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenGenerator();
                      }}
                      className="inline-block mt-2 px-3 py-1 bg-[#c52828] text-white rounded-xs text-xs font-bold"
                    >
                      AI 시험 문제 출제하기
                    </button>
                  )}
                </div>
              ) : (
                filteredDrafts.map((draft) => {
                  const isSelected = activeDraft?.id === draft.id;
                  const isScore100 = draft.verificationStatus?.isScore100;
                  return (
                    <div
                      key={draft.id}
                      onClick={() => setSelectedDraftId(draft.id)}
                      className={`p-3 rounded-xs border cursor-pointer transition-all space-y-1.5 ${
                        isSelected
                          ? 'bg-white border-[#c52828] shadow-xs'
                          : 'bg-[#faf8f4] hover:bg-white border-[#ded6c8]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="text-[10px] font-academic-mono font-bold text-[#c52828] uppercase">
                          {draft.categoryLabel}
                        </span>

                        <div className="flex items-center gap-1 shrink-0">
                          {draft.isApproved ? (
                            <span className="text-[9.5px] font-academic-mono bg-emerald-50 border border-emerald-300 text-emerald-800 px-1 py-0.2 rounded-2xs font-semibold">
                              승인 완료
                            </span>
                          ) : draft.status === 'needs_review' ? (
                            <span className="text-[9.5px] font-academic-mono bg-amber-50 border border-amber-300 text-amber-800 px-1 py-0.2 rounded-2xs font-semibold">
                              검토 필요
                            </span>
                          ) : (
                            <span className="text-[9.5px] font-academic-mono bg-slate-100 border border-slate-300 text-slate-700 px-1 py-0.2 rounded-2xs">
                              승인 대기
                            </span>
                          )}
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-[#191817] line-clamp-2 leading-snug">
                        {draft.title}
                      </h4>

                      {/* Concept Tags */}
                      <div className="flex flex-wrap gap-1">
                        {draft.conceptTitles.map((title, i) => (
                          <span
                            key={i}
                            className="text-[9.5px] bg-[#f1ede4] text-[#57544e] px-1 py-0.5 rounded-2xs truncate max-w-[120px]"
                          >
                            #{title}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center justify-between text-[10.5px] font-academic-mono pt-1 text-[#827d73] border-t border-[#f1ede4]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {draft.timeStandardMinutes}분
                        </span>

                        <span
                          className={
                            isScore100
                              ? 'text-emerald-700 font-bold'
                              : 'text-amber-700 font-bold'
                          }
                        >
                          {draft.verificationStatus?.scoreSum || 100}점 만점
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Problem Detail Inspection & Editing (Approx 62%) */}
          <div className="flex-1 flex flex-col bg-white overflow-y-auto">
            {activeDraft ? (
              <div className="p-5 sm:p-6 space-y-5">
                {/* Header Strip */}
                <div className="border-b border-[#ded6c8] pb-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-academic-mono text-[#c52828] bg-[#fef2f2] border border-[#fecaca] px-2 py-0.5 rounded-xs">
                        {activeDraft.categoryLabel}
                      </span>
                      <span className="text-xs font-academic-mono text-[#827d73]">
                        난이도: {PROBLEM_DIFFICULTY_LABELS[activeDraft.difficulty] || activeDraft.difficulty}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <button
                          type="button"
                          onClick={handleSaveEdits}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[#c52828] text-white text-xs font-bold rounded-xs shadow-2xs hover:bg-[#a82020]"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>수정 내용 저장</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#ded6c8] text-[#57544e] hover:text-[#191817] text-xs font-semibold rounded-xs hover:bg-[#faf8f4]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>문제 편집</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleDeleteCurrent}
                        className="p-1.5 text-[#827d73] hover:text-red-600 rounded-xs hover:bg-red-50 border border-transparent hover:border-red-200"
                        title="초안 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full text-base sm:text-lg font-bold font-academic-serif p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817]"
                    />
                  ) : (
                    <h2 className="text-base sm:text-xl font-bold font-academic-serif text-[#191817] leading-snug">
                      {activeDraft.title}
                    </h2>
                  )}

                  {/* Concept & Source Badge */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-academic-mono text-[#827d73]">연결 개념:</span>
                    {activeDraft.conceptTitles.map((t, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-[#f6f3eb] border border-[#ded6c8] text-[#191817] rounded-xs font-medium text-[11px]"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-[#ded6c8]">|</span>
                    <span className="font-academic-mono text-[#827d73]">
                      출처: {activeDraft.sourceRefs}
                    </span>
                  </div>
                </div>

                {/* Outdated Warning Banner */}
                {isDraftOutdated && (
                  <div className="p-3 bg-amber-100/90 border border-amber-300 rounded-xs text-xs text-amber-950 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold">이전 자료 기반 출제: </strong>
                      <span>학습 자료 원문(Markdown)이 수정되어 출제 당시의 원문 버전과 차이가 있습니다. 현재 자료의 최신 내용과 비교하여 필요 시 지문이나 해설을 수정해 주세요.</span>
                    </div>
                  </div>
                )}

                {/* AI Design vs Original Source Banner (Requirement 2 & 3) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>AI 설계 응용 조건 (확장 제약)</span>
                    </div>
                    {isEditing ? (
                      <textarea
                        value={editAppliedNote}
                        onChange={(e) => setEditAppliedNote(e.target.value)}
                        rows={2}
                        className="w-full p-1.5 text-[11px] border border-amber-300 rounded-xs bg-white text-amber-950"
                      />
                    ) : (
                      <p className="text-[11px] text-amber-900 leading-relaxed">
                        {activeDraft.appliedConditionNote ||
                          '원문 개념에 대학 정규 시험 수준의 경계 조건 및 심화 조건을 적용함'}
                      </p>
                    )}
                  </div>

                  <div className="p-3 bg-[#f6f3eb] border border-[#ded6c8] rounded-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-[#191817]">
                      <BookOpen className="w-3.5 h-3.5 text-[#c52828] shrink-0" />
                      <span>원문 교재 확인 근거</span>
                    </div>
                    <p className="text-[11px] text-[#57544e] leading-relaxed line-clamp-2">
                      {activeDraft.sourceEvidenceQuote
                        ? `"${activeDraft.sourceEvidenceQuote}"`
                        : `${activeDraft.sourceRefs} 기반 학습 개념`}
                    </p>
                  </div>
                </div>

                {/* Problem Statement Card */}
                <div className="border border-[#ded6c8] rounded-xs overflow-hidden bg-[#fcfbf9]">
                  <div className="bg-[#f6f3eb] px-4 py-2 border-b border-[#ded6c8] flex items-center justify-between text-xs">
                    <span className="font-academic-mono font-bold text-[#57544e]">
                      EXAMINATION QUESTION (문제 본문)
                    </span>
                    <span className="text-[11px] font-academic-mono text-[#827d73]">
                      표준 소요: {activeDraft.timeStandardMinutes}분
                    </span>
                  </div>

                  <div className="p-4 space-y-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label className="text-[11px] font-academic-mono text-[#827d73] block">
                          문제 지문 수정 (Markdown / LaTeX 수식 지원):
                        </label>
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          rows={6}
                          className="w-full p-2.5 text-xs font-mono border border-[#ded6c8] rounded-xs bg-white text-[#191817] leading-relaxed"
                        />
                      </div>
                    ) : (
                      <div className="text-sm sm:text-base text-[#191817] leading-relaxed korean-prose whitespace-pre-wrap">
                        {activeDraft.promptText}
                      </div>
                    )}

                    {/* Math Formula if present */}
                    {(activeDraft.mathFormula || editFormula) && (
                      <div className="p-3 bg-white border border-[#e2ded6] rounded-xs space-y-1.5">
                        <span className="text-[10px] font-academic-mono text-[#827d73] uppercase tracking-wider block">
                          핵심 수학 수식:
                        </span>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormula}
                            onChange={(e) => setEditFormula(e.target.value)}
                            placeholder="LaTeX 수식 e.g. E[Y|X=x] = \mu_Y"
                            className="w-full p-2 text-xs font-mono border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                          />
                        ) : (
                          <div className="overflow-x-auto py-1 text-center sm:text-left">
                            <MathFormula math={activeDraft.mathFormula!} displayMode={true} />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Code Snippet if present */}
                    {(activeDraft.codeSnippet || editCodeSnippet) && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-academic-mono text-[#827d73] uppercase tracking-wider block">
                          알고리즘 코드 스니펫:
                        </span>
                        {isEditing ? (
                          <textarea
                            value={editCodeSnippet}
                            onChange={(e) => setEditCodeSnippet(e.target.value)}
                            rows={5}
                            placeholder="코드 스니펫 작성"
                            className="w-full p-2 text-xs font-mono border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                          />
                        ) : (
                          <pre className="p-3 bg-[#191817] text-white text-xs font-academic-mono rounded-xs overflow-x-auto">
                            <code>{activeDraft.codeSnippet}</code>
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Step-by-Step Hints */}
                <div className="border border-[#ded6c8] rounded-xs overflow-hidden bg-white">
                  <div className="bg-[#faf8f4] px-4 py-2 border-b border-[#ded6c8] flex items-center justify-between text-xs">
                    <span className="font-academic-mono font-bold text-[#57544e] flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span>단계별 풀이 힌트 (STEP-BY-STEP HINTS)</span>
                    </span>
                    <span className="text-[11px] font-academic-mono text-[#827d73]">
                      {(isEditing ? editHints : activeDraft.hints).length}단계 구성
                    </span>
                  </div>

                  <div className="p-4 space-y-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        {editHints.map((hint, hIdx) => (
                          <div key={hIdx} className="flex items-center gap-2">
                            <span className="text-xs font-academic-mono font-bold text-[#827d73] w-12 shrink-0">
                              단계 {hIdx + 1}:
                            </span>
                            <input
                              type="text"
                              value={hint}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditHints((prev) => {
                                  const n = [...prev];
                                  n[hIdx] = val;
                                  return n;
                                });
                              }}
                              className="flex-1 p-2 text-xs border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                            />
                            <button
                              type="button"
                              onClick={() => setEditHints(editHints.filter((_, i) => i !== hIdx))}
                              className="text-[#827d73] hover:text-red-600 p-1"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setEditHints([...editHints, ''])}
                          className="text-xs text-[#c52828] hover:underline font-semibold flex items-center gap-1 pt-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>힌트 단계 추가</span>
                        </button>
                      </div>
                    ) : (
                      <ol className="space-y-1.5 text-xs text-[#57544e] list-decimal list-inside leading-relaxed">
                        {activeDraft.hints.map((hint, idx) => (
                          <li key={idx} className="p-2 bg-[#faf8f4] rounded-xs border border-[#f1ede4]">
                            {hint}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>

                {/* Model Answer (HIDDEN BY DEFAULT - SPOLIER PREVENTION) */}
                <div className="border border-[#ded6c8] rounded-xs overflow-hidden bg-white">
                  <div className="bg-[#faf8f4] px-4 py-2 border-b border-[#ded6c8] flex items-center justify-between text-xs">
                    <span className="font-academic-mono font-bold text-[#57544e]">
                      OFFICIAL MODEL ANSWER (공식 모범 답안)
                    </span>

                    <button
                      type="button"
                      onClick={() => setIsModelAnswerVisible(!isModelAnswerVisible)}
                      className="flex items-center gap-1 text-xs text-[#c52828] hover:text-[#a82020] font-semibold"
                    >
                      {isModelAnswerVisible ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>답안 숨기기 (스포일러 방지)</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>모범 답안 보기 / 수정하기</span>
                        </>
                      )}
                    </button>
                  </div>

                  {isModelAnswerVisible ? (
                    <div className="p-4 space-y-2 animate-fade-in">
                      {isEditing ? (
                        <textarea
                          value={editModelAnswer}
                          onChange={(e) => setEditModelAnswer(e.target.value)}
                          rows={6}
                          className="w-full p-2.5 text-xs font-mono border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817] leading-relaxed"
                        />
                      ) : (
                        <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-xs sm:text-sm text-[#191817] whitespace-pre-wrap leading-relaxed korean-prose">
                          {activeDraft.modelAnswer}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-xs text-[#827d73] bg-[#faf8f4]/60">
                      <span>풀이 전 스포일러 방지를 위해 모범 답안이 숨겨져 있습니다. 상단 버튼을 눌러 확인할 수 있습니다.</span>
                    </div>
                  )}
                </div>

                {/* Detailed Rubric Criteria (100-Point Sum Required) */}
                <div className="border border-[#ded6c8] rounded-xs overflow-hidden bg-white">
                  <div className="bg-[#faf8f4] px-4 py-2 border-b border-[#ded6c8] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-academic-mono font-bold text-[#57544e]">
                        GRADING RUBRIC CRITERIA (총점 100점 채점 기준)
                      </span>
                      <span
                        className={`text-[11px] font-academic-mono font-bold px-1.5 py-0.5 rounded-2xs ${
                          currentRubricSum === 100
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        합계: {currentRubricSum} / 100점
                      </span>
                    </div>

                    {isEditing && (
                      <button
                        type="button"
                        onClick={handleAddRubricCriterion}
                        className="text-xs text-[#c52828] font-bold hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>항목 추가</span>
                      </button>
                    )}
                  </div>

                  <div className="p-4 space-y-2.5">
                    {(isEditing ? editRubric : activeDraft.rubric).map((crit, idx) => (
                      <div
                        key={crit.id || idx}
                        className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#191817] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#c52828]" />
                            {crit.label}
                          </span>

                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1 font-academic-mono">
                                <span className="text-[#827d73] text-[11px]">배점:</span>
                                <input
                                  type="number"
                                  value={crit.maxScore}
                                  onChange={(e) =>
                                    handleRubricScoreChange(idx, Number(e.target.value))
                                  }
                                  className="w-16 p-1 text-xs border border-[#ded6c8] rounded-xs bg-white text-right font-bold"
                                />
                                <span>점</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRubricCriterion(idx)}
                                  className="text-[#827d73] hover:text-red-600 p-1"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="font-academic-mono font-bold text-[#c52828] bg-white border border-[#ded6c8] px-2 py-0.5 rounded-2xs">
                                {crit.maxScore}점 만점
                              </span>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <input
                            type="text"
                            value={crit.description}
                            onChange={(e) => handleRubricDescChange(idx, e.target.value)}
                            className="w-full p-1.5 text-[11.5px] border border-[#ded6c8] rounded-xs bg-white text-[#57544e]"
                          />
                        ) : (
                          <p className="text-[11.5px] text-[#57544e] leading-relaxed">
                            {crit.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom Action Strip */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#ded6c8]">
                  <div className="flex items-center gap-2">
                    {onStartPracticeSession && (
                      <button
                        type="button"
                        onClick={() => {
                          onStartPracticeSession(activeDraft);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-xs font-bold text-[#191817] rounded-xs transition-colors shadow-2xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-[#c52828] text-[#c52828]" />
                        <span>시험 풀기 세션으로 열기</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {activeDraft.isApproved ? (
                      <div className="flex items-center gap-1 text-xs text-emerald-700 font-bold px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>과목 문제 레일에 승인 등록됨</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleApproveCurrent}
                        className="flex items-center gap-1.5 px-5 py-2 bg-[#c52828] hover:bg-[#a82020] text-white text-xs font-bold rounded-xs shadow-xs transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>이 문제 승인 및 보관함 등록</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-[#827d73]">
                왼쪽 목록에서 검토할 문제를 선택해 주세요.
              </div>
            )}
          </div>
        </div>
      </>
    )}
      </div>
    </div>
  );
}
