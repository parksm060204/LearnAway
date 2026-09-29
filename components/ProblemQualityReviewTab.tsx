'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Subject,
  Problem,
  ProblemQualityStatus,
  PROBLEM_QUALITY_STATUS_LABELS,
  ProblemReport,
  ProblemReportType,
  PROBLEM_REPORT_TYPE_LABELS,
  RubricCriterion,
  ProblemQualityReviewResult,
  Material,
} from '../lib/types';
import { MathFormula } from './MathFormula';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Clock,
  Edit3,
  Sparkles,
  BookOpen,
  RotateCcw,
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Filter,
  Search,
  Ban,
  Eye,
  EyeOff,
  Save,
  Loader2,
  ArrowRight,
} from 'lucide-react';

interface ProblemQualityReviewTabProps {
  activeSubject: Subject;
  problems: Problem[];
  materials?: Material[];
  onUpdateQualityStatus?: (problemId: string, newStatus: ProblemQualityStatus, note?: string) => void;
  onDismissReport?: (problemId: string, reportId: string, dismissReason: string) => { success: boolean; error?: string };
  onReviseProblem?: (problemId: string, updates: Partial<Problem>, editReason: string) => { success: boolean; error?: string };
  onReapproveProblem?: (problemId: string, reapprovalNote?: string) => { success: boolean; error?: string };
  onSuspendProblem?: (problemId: string, suspensionReason?: string) => void;
  onOpenSourceModal?: (sourceRef: string) => void;
}

export function ProblemQualityReviewTab({
  activeSubject,
  problems,
  materials = [],
  onUpdateQualityStatus,
  onDismissReport,
  onReviseProblem,
  onReapproveProblem,
  onSuspendProblem,
  onOpenSourceModal,
}: ProblemQualityReviewTabProps) {
  // Filter problems for active subject
  const subjectProblems = useMemo(() => {
    return problems.filter((p) => p.subjectId === activeSubject.id);
  }, [problems, activeSubject.id]);

  // Quality Filter Tab
  const [filterStatus, setFilterStatus] = useState<'all' | ProblemQualityStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProblemId, setSelectedProblemId] = useState<string>('');

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editFormula, setEditFormula] = useState('');
  const [editCodeSnippet, setEditCodeSnippet] = useState('');
  const [editHints, setEditHints] = useState<string[]>([]);
  const [editModelAnswer, setEditModelAnswer] = useState('');
  const [editRubric, setEditRubric] = useState<RubricCriterion[]>([]);
  const [editTimeMinutes, setEditTimeMinutes] = useState(20);
  const [editReasonText, setEditReasonText] = useState('');
  const [editValidationError, setEditValidationError] = useState<string | null>(null);

  // AI Re-review state
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [aiReviewResult, setAiReviewResult] = useState<ProblemQualityReviewResult | null>(null);
  const [aiReviewError, setAiReviewError] = useState<string | null>(null);

  // Dismiss report modal/dialog state
  const [dismissingReport, setDismissingReport] = useState<ProblemReport | null>(null);
  const [dismissReasonInput, setDismissReasonInput] = useState('');
  const [dismissError, setDismissError] = useState<string | null>(null);

  // Re-approval confirm modal/dialog state
  const [isReapproving, setIsReapproving] = useState(false);
  const [reapprovalNoteInput, setReapprovalNoteInput] = useState('');
  const [reapprovalError, setReapprovalError] = useState<string | null>(null);

  // Version history expansion state
  const [expandedVersionNum, setExpandedVersionNum] = useState<number | null>(null);
  const [isModelAnswerVisible, setIsModelAnswerVisible] = useState(true);

  // Filtered problems list
  const filteredProblems = useMemo(() => {
    return subjectProblems.filter((p) => {
      const qStatus = p.qualityStatus || 'normal';
      if (filterStatus !== 'all' && qStatus !== filterStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = p.title.toLowerCase().includes(q);
        const matchesPrompt = p.promptText.toLowerCase().includes(q);
        const matchesCategory = p.categoryLabel.toLowerCase().includes(q);
        const matchesReports = (p.reports || []).some(
          (r) => r.details.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)
        );
        return matchesTitle || matchesPrompt || matchesCategory || matchesReports;
      }
      return true;
    });
  }, [subjectProblems, filterStatus, searchQuery]);

  // Selected problem
  const activeProblem = useMemo(() => {
    if (selectedProblemId) {
      const found = subjectProblems.find((p) => p.id === selectedProblemId);
      if (found) return found;
    }
    // Default prioritizing reported or under_review
    const reported = filteredProblems.find(
      (p) => p.qualityStatus === 'reported' || p.qualityStatus === 'under_review' || p.qualityStatus === 'review_after_edit'
    );
    return reported || filteredProblems[0] || subjectProblems[0] || null;
  }, [selectedProblemId, filteredProblems, subjectProblems]);

  // Sync edit form when active problem changes
  useEffect(() => {
    if (activeProblem) {
      setEditTitle(activeProblem.title);
      setEditPrompt(activeProblem.promptText);
      setEditFormula(activeProblem.mathFormula || '');
      setEditCodeSnippet(activeProblem.codeSnippet || '');
      setEditHints([...activeProblem.hints]);
      setEditModelAnswer(activeProblem.modelAnswer || '');
      setEditRubric([...activeProblem.rubric]);
      setEditTimeMinutes(activeProblem.timeStandardMinutes || 20);
      setEditReasonText('');
      setEditValidationError(null);
      setIsEditing(false);
      setAiReviewResult(null);
      setAiReviewError(null);
      setExpandedVersionNum(null);
    }
  }, [activeProblem?.id]);

  // Calculate rubric sum
  const rubricScoreSum = (isEditing ? editRubric : activeProblem?.rubric || []).reduce(
    (sum, r) => sum + (Number(r.maxScore) || 0),
    0
  );

  // Status counts for active subject
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: subjectProblems.length,
      reported: 0,
      under_review: 0,
      review_after_edit: 0,
      reapproved: 0,
      normal: 0,
      suspended: 0,
    };
    subjectProblems.forEach((p) => {
      const st = p.qualityStatus || 'normal';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [subjectProblems]);

  // Trigger AI Re-review request
  const handleRequestAiReview = async () => {
    if (!activeProblem) return;
    setIsAiReviewing(true);
    setAiReviewError(null);

    try {
      const subjectMaterial = materials.find(
        (m) => m.subjectId === activeSubject.id && m.parsedMarkdown
      );

      const res = await fetch('/api/review-problem-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: activeProblem,
          reports: activeProblem.reports || [],
          sourceMarkdown: subjectMaterial?.parsedMarkdown || '',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setAiReviewError(data.error || 'AI 품질 검토 호출에 실패했습니다.');
        return;
      }

      setAiReviewResult(data.review);
    } catch (err: any) {
      setAiReviewError(`네트워크 오류: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setIsAiReviewing(false);
    }
  };

  // Save Edits as a New Version
  const handleSaveRevisedVersion = () => {
    if (!activeProblem) return;

    if (!editReasonText.trim()) {
      setEditValidationError('새 버전을 생성하기 위해 수정 사유(변경 내용 요약)를 반드시 입력해야 합니다.');
      return;
    }

    if (!editPrompt.trim()) {
      setEditValidationError('문제 지문이 비어 있습니다.');
      return;
    }

    if (!editModelAnswer.trim()) {
      setEditValidationError('모범 답안이 비어 있습니다.');
      return;
    }

    if (rubricScoreSum !== 100) {
      if (
        !confirm(
          `현재 루브릭 배점 합계가 ${rubricScoreSum}점입니다 (표준은 100점). 이대로 새 버전을 생성하시겠습니까? (재승인 시 100점 일치가 필요합니다.)`
        )
      ) {
        return;
      }
    }

    if (onReviseProblem) {
      const res = onReviseProblem(
        activeProblem.id,
        {
          title: editTitle.trim() || activeProblem.title,
          promptText: editPrompt.trim(),
          mathFormula: editFormula.trim() || undefined,
          codeSnippet: editCodeSnippet.trim() || undefined,
          hints: editHints.filter((h) => h.trim().length > 0),
          modelAnswer: editModelAnswer.trim(),
          rubric: editRubric,
          timeStandardMinutes: editTimeMinutes,
          timeBreakdownDesc: `${editTimeMinutes}분 (수정판)`,
        },
        editReasonText.trim()
      );

      if (!res.success) {
        setEditValidationError(res.error || '수정 저장에 실패했습니다.');
        return;
      }

      setIsEditing(false);
      setEditValidationError(null);
    }
  };

  // Re-approve confirmation
  const handleConfirmReapprove = () => {
    if (!activeProblem || !onReapproveProblem) return;
    setReapprovalError(null);

    const res = onReapproveProblem(activeProblem.id, reapprovalNoteInput.trim() || undefined);
    if (!res.success) {
      setReapprovalError(res.error || '재승인 처리에 실패했습니다.');
      return;
    }

    setIsReapproving(false);
    setReapprovalNoteInput('');
  };

  // Dismiss report confirmation
  const handleConfirmDismissReport = () => {
    if (!activeProblem || !dismissingReport || !onDismissReport) return;
    setDismissError(null);

    const trimmed = dismissReasonInput.trim();
    if (!trimmed) {
      setDismissError('기각 사유를 작성해야 합니다.');
      return;
    }

    const res = onDismissReport(activeProblem.id, dismissingReport.id, trimmed);
    if (!res.success) {
      setDismissError(res.error || '신고 기각 처리에 실패했습니다.');
      return;
    }

    setDismissingReport(null);
    setDismissReasonInput('');
  };

  // Helper for status badge styling
  const getStatusBadge = (status?: ProblemQualityStatus) => {
    switch (status) {
      case 'reported':
        return {
          bg: 'bg-red-100 text-red-900 border-red-300',
          icon: <ShieldAlert className="w-3 h-3 text-red-600" />,
          label: '신고 접수',
        };
      case 'under_review':
        return {
          bg: 'bg-amber-100 text-amber-900 border-amber-300',
          icon: <Clock className="w-3 h-3 text-amber-600" />,
          label: '검토 중',
        };
      case 'review_after_edit':
        return {
          bg: 'bg-blue-100 text-blue-900 border-blue-300',
          icon: <History className="w-3 h-3 text-blue-600" />,
          label: '수정 후 재검토',
        };
      case 'reapproved':
        return {
          bg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
          icon: <ShieldCheck className="w-3 h-3 text-emerald-600" />,
          label: '재승인 완료',
        };
      case 'suspended':
        return {
          bg: 'bg-gray-200 text-gray-800 border-gray-400',
          icon: <Ban className="w-3 h-3 text-gray-600" />,
          label: '사용 중지',
        };
      case 'normal':
      default:
        return {
          bg: 'bg-[#faf8f4] text-[#57544e] border-[#ded6c8]',
          icon: <CheckCircle className="w-3 h-3 text-emerald-600" />,
          label: '정상',
        };
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#faf8f4]">
      {/* Quality Filter Bar */}
      <div className="bg-[#f6f3eb] border-b border-[#ded6c8] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-academic-mono">
          <span className="text-[#827d73] font-bold flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>품질 상태:</span>
          </span>

          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-2.5 py-1 rounded-xs transition-colors ${
              filterStatus === 'all'
                ? 'bg-[#191817] text-white font-bold'
                : 'bg-white text-[#57544e] border border-[#ded6c8] hover:bg-[#ede8dc]'
            }`}
          >
            전체 ({statusCounts.all})
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('reported')}
            className={`px-2.5 py-1 rounded-xs flex items-center gap-1 transition-colors ${
              filterStatus === 'reported'
                ? 'bg-[#c52828] text-white font-bold'
                : 'bg-white text-red-700 border border-red-200 hover:bg-red-50'
            }`}
          >
            <span>신고 접수</span>
            <span className="px-1 bg-red-200 text-red-900 rounded-2xs text-[10px] font-bold">
              {statusCounts.reported}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('under_review')}
            className={`px-2.5 py-1 rounded-xs flex items-center gap-1 transition-colors ${
              filterStatus === 'under_review'
                ? 'bg-amber-600 text-white font-bold'
                : 'bg-white text-amber-800 border border-amber-200 hover:bg-amber-50'
            }`}
          >
            <span>검토 중</span>
            <span className="px-1 bg-amber-200 text-amber-900 rounded-2xs text-[10px]">
              {statusCounts.under_review}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('review_after_edit')}
            className={`px-2.5 py-1 rounded-xs flex items-center gap-1 transition-colors ${
              filterStatus === 'review_after_edit'
                ? 'bg-blue-600 text-white font-bold'
                : 'bg-white text-blue-800 border border-blue-200 hover:bg-blue-50'
            }`}
          >
            <span>수정 후 재검토</span>
            <span className="px-1 bg-blue-200 text-blue-900 rounded-2xs text-[10px]">
              {statusCounts.review_after_edit}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('reapproved')}
            className={`px-2.5 py-1 rounded-xs flex items-center gap-1 transition-colors ${
              filterStatus === 'reapproved'
                ? 'bg-emerald-700 text-white font-bold'
                : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50'
            }`}
          >
            <span>재승인</span>
            <span className="px-1 bg-emerald-200 text-emerald-900 rounded-2xs text-[10px]">
              {statusCounts.reapproved}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('normal')}
            className={`px-2.5 py-1 rounded-xs transition-colors ${
              filterStatus === 'normal'
                ? 'bg-[#57544e] text-white font-bold'
                : 'bg-white text-[#57544e] border border-[#ded6c8] hover:bg-[#ede8dc]'
            }`}
          >
            정상 ({statusCounts.normal})
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('suspended')}
            className={`px-2.5 py-1 rounded-xs transition-colors ${
              filterStatus === 'suspended'
                ? 'bg-gray-800 text-white font-bold'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
            }`}
          >
            사용 중지 ({statusCounts.suspended})
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[200px] text-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#827d73]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="문제 검색 (제목, 지문, 신고 내용)..."
            className="w-full pl-8 pr-3 py-1 bg-white border border-[#ded6c8] rounded-xs text-xs focus:border-[#191817] focus:ring-1 focus:ring-[#191817]"
          />
        </div>
      </div>

      {/* Main Split Body: Left List, Right Detail */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left Problems List */}
        <div className="w-full md:w-80 border-r border-[#ded6c8] bg-white flex flex-col shrink-0 overflow-y-auto max-h-56 md:max-h-full">
          <div className="p-2.5 bg-[#faf8f4] border-b border-[#ded6c8] flex items-center justify-between text-[11px] font-academic-mono text-[#827d73]">
            <span>문제 목록 ({filteredProblems.length}개)</span>
            <span>정렬: 최신 등록순</span>
          </div>

          <div className="divide-y divide-[#f1ede4] overflow-y-auto flex-1">
            {filteredProblems.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#827d73] space-y-1">
                <Info className="w-5 h-5 mx-auto text-[#ded6c8]" />
                <p>해당 상태의 문제가 없습니다.</p>
              </div>
            ) : (
              filteredProblems.map((p) => {
                const isSelected = p.id === activeProblem?.id;
                const statusBadge = getStatusBadge(p.qualityStatus);
                const openReportsCount = (p.reports || []).filter(
                  (r) => r.status === 'open' || r.status === 'under_review'
                ).length;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProblemId(p.id);
                      setIsEditing(false);
                      setAiReviewResult(null);
                    }}
                    className={`w-full p-3 text-left transition-colors flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-[#faf8f4] border-l-4 border-l-[#c52828]'
                        : 'hover:bg-[#fcfbf9]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-academic-mono text-[10px] text-[#827d73]">
                        {p.categoryLabel} · v{p.version || 1}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-academic-mono px-1.5 py-0.5 rounded-2xs border font-semibold ${statusBadge.bg}`}
                      >
                        {statusBadge.icon}
                        <span>{statusBadge.label}</span>
                      </span>
                    </div>

                    <h4 className="font-bold text-xs text-[#191817] line-clamp-1 font-academic-serif">
                      {p.title}
                    </h4>

                    <p className="text-[11px] text-[#57544e] line-clamp-2 leading-relaxed">
                      {p.promptText}
                    </p>

                    {openReportsCount > 0 && (
                      <div className="flex items-center gap-1 text-[10.5px] font-academic-mono text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-2xs mt-0.5">
                        <ShieldAlert className="w-3 h-3 text-red-600" />
                        <span>미해결 신고 {openReportsCount}건 접수됨</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Detail Pane */}
        {activeProblem ? (
          <div className="flex-1 flex flex-col min-h-0 bg-[#faf8f4] overflow-y-auto">
            {/* Detail Top Header */}
            <div className="p-4 sm:p-5 bg-white border-b border-[#ded6c8] space-y-3 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {(() => {
                    const badge = getStatusBadge(activeProblem.qualityStatus);
                    return (
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-academic-mono px-2 py-0.5 rounded-xs border font-semibold ${badge.bg}`}
                      >
                        {badge.icon}
                        <span>{badge.label}</span>
                      </span>
                    );
                  })()}

                  <span className="text-xs font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#57544e] px-2 py-0.5 rounded-xs font-bold">
                    VERSION v{activeProblem.version || 1}
                  </span>

                  {activeProblem.isDemo ? (
                    <span className="text-[11px] font-academic-mono text-[#827d73] bg-[#f4f1ea] px-1.5 py-0.5 rounded-2xs">
                      기본 예시 문제
                    </span>
                  ) : (
                    <span className="text-[11px] font-academic-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-2xs">
                      AI 생성 승인 문제
                    </span>
                  )}
                </div>

                {/* Primary Action Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-academic-mono">
                  {/* Status transitions */}
                  {activeProblem.qualityStatus === 'reported' && onUpdateQualityStatus && (
                    <button
                      type="button"
                      onClick={() => onUpdateQualityStatus(activeProblem.id, 'under_review', '검토 착수')}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xs transition-colors flex items-center gap-1"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>검토 착수 (under_review)</span>
                    </button>
                  )}

                  {/* AI Re-review Button */}
                  <button
                    type="button"
                    onClick={handleRequestAiReview}
                    disabled={isAiReviewing}
                    className="px-3 py-1 bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs transition-colors flex items-center gap-1"
                  >
                    {isAiReviewing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span>{isAiReviewing ? 'AI 정밀 검토 중...' : 'AI 재검토 요청'}</span>
                  </button>

                  {/* Edit Button */}
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-3 py-1 bg-white hover:bg-[#faf8f4] text-[#191817] border border-[#ded6c8] font-bold rounded-xs transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>문제 수정 (새 버전 작성)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1 bg-white hover:bg-[#faf8f4] text-[#57544e] border border-[#ded6c8] rounded-xs transition-colors"
                    >
                      수정 취소
                    </button>
                  )}

                  {/* Re-approval Button (Strict manual user re-approval with 100-pt check) */}
                  <button
                    type="button"
                    onClick={() => {
                      setReapprovalError(null);
                      setReapprovalNoteInput('');
                      setIsReapproving(true);
                    }}
                    className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xs transition-colors flex items-center gap-1 shadow-2xs"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>재승인 확정</span>
                  </button>

                  {/* Suspend Button */}
                  {activeProblem.qualityStatus !== 'suspended' && onSuspendProblem && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm('이 문제를 사용 중지 처리하시겠습니까? (출제 목록에서 영구 제외됩니다.)')) {
                          onSuspendProblem(activeProblem.id, '품질 결함으로 사용 중지');
                        }
                      }}
                      className="px-2.5 py-1 text-gray-700 hover:text-red-700 hover:bg-gray-100 border border-gray-300 rounded-xs transition-colors"
                      title="문제 사용 중지"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Title & Category */}
              <div>
                <span className="font-academic-mono text-[11px] text-[#827d73]">
                  {activeProblem.categoryLabel} · 표준 소요 {activeProblem.timeStandardMinutes}분 · 출처: {activeProblem.sourceRefs}
                </span>
                <h2 className="text-base sm:text-lg font-bold text-[#191817] font-academic-serif mt-0.5">
                  {activeProblem.title}
                </h2>
              </div>
            </div>

            {/* Detail Scrollable Content */}
            <div className="p-4 sm:p-6 space-y-5">
              {/* Section 1: 접수된 신고 내역 (Reports Section) */}
              <div className="bg-white border border-[#ded6c8] rounded-xs p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#c52828]" />
                    <h3 className="font-bold text-xs sm:text-sm font-academic-serif text-[#191817]">
                      접수된 품질 오류 신고 내역 ({activeProblem.reports?.length || 0}건)
                    </h3>
                  </div>
                  <span className="text-[11px] font-academic-mono text-[#827d73]">
                    동일 사용자의 연속 중복 신고 방지 적용
                  </span>
                </div>

                {!activeProblem.reports || activeProblem.reports.length === 0 ? (
                  <div className="p-4 bg-[#faf8f4] border border-[#f1ede4] rounded-xs text-xs text-[#827d73] text-center">
                    현재 접수된 오류 신고가 없습니다. (문제 상태: {getStatusBadge(activeProblem.qualityStatus).label})
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeProblem.reports.map((report) => (
                      <div
                        key={report.id}
                        className={`p-3.5 rounded-xs border text-xs space-y-2 ${
                          report.status === 'dismissed'
                            ? 'bg-gray-50 border-gray-200 text-gray-600 opacity-75'
                            : report.status === 'resolved'
                            ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                            : 'bg-[#fef2f2]/60 border-red-200 text-red-950'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-black/5 pb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-academic-mono px-2 py-0.5 rounded-2xs text-[11px] bg-white border border-black/10">
                              {PROBLEM_REPORT_TYPE_LABELS[report.type] || report.type}
                            </span>
                            <span className="text-[10.5px] font-academic-mono text-[#827d73]">
                              접수 시각: {new Date(report.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-academic-mono px-1.5 py-0.2 rounded-2xs font-semibold ${
                                report.status === 'dismissed'
                                  ? 'bg-gray-200 text-gray-700'
                                  : report.status === 'resolved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              상태: {report.status === 'dismissed' ? '기각 종결' : report.status === 'resolved' ? '수정 해결' : '접수 검토 중'}
                            </span>

                            {/* Dismiss Report button */}
                            {report.status !== 'dismissed' && report.status !== 'resolved' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDismissingReport(report);
                                  setDismissReasonInput('');
                                  setDismissError(null);
                                }}
                                className="px-2 py-0.5 text-[11px] font-academic-mono bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 rounded-2xs transition-colors"
                              >
                                신고 기각/반려
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Report description */}
                        <div className="space-y-1">
                          <span className="text-[10.5px] font-academic-mono font-bold text-[#57544e]">
                            사용자 오류 지적 내용:
                          </span>
                          <p className="korean-prose leading-relaxed whitespace-pre-wrap text-[11.5px] bg-white p-2.5 rounded-2xs border border-black/5">
                            {report.details}
                          </p>
                        </div>

                        {/* Linked Attempt ID */}
                        {report.attemptId && (
                          <div className="text-[10.5px] font-academic-mono text-[#57544e] flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-[#827d73]" />
                            <span>연결된 풀이 ID: <strong>{report.attemptId}</strong></span>
                          </div>
                        )}

                        {/* Resolution note if dismissed or resolved */}
                        {report.resolutionNote && (
                          <div className="p-2 bg-white/80 border border-black/5 rounded-2xs text-[11px] space-y-0.5">
                            <strong className="text-[10.5px] font-academic-mono text-[#57544e] block">
                              처리 사유 및 결과:
                            </strong>
                            <p>{report.resolutionNote}</p>
                            {report.resolvedAt && (
                              <span className="text-[10px] font-academic-mono text-[#827d73]">
                                처리 시각: {new Date(report.resolvedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: AI 재검토 분석 결과 (AI Re-review Results if triggered) */}
              {isAiReviewing && (
                <div className="p-6 bg-white border border-[#ded6c8] rounded-xs text-center space-y-2.5 shadow-2xs">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#c52828]" />
                  <h4 className="font-bold text-sm text-[#191817] font-academic-serif">
                    AI 학술 품질 및 신고 타당성 검토 진행 중...
                  </h4>
                  <p className="text-xs text-[#57544e] max-w-md mx-auto">
                    원문 대조, 조건 모호성 검증, 모범 답안 수식 엄밀성, 100점 배점 규격을 다각도로 분석하고 있습니다.
                  </p>
                </div>
              )}

              {aiReviewError && (
                <div className="p-4 bg-red-50 border border-red-300 rounded-xs text-xs text-red-900 flex items-start gap-2 shadow-2xs">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">AI 검토 호출 오류</strong>
                    <span>{aiReviewError}</span>
                  </div>
                </div>
              )}

              {aiReviewResult && (
                <div className="bg-white border-2 border-amber-400/80 rounded-xs p-4 sm:p-5 shadow-2xs space-y-3.5 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <h3 className="font-bold text-sm font-academic-serif text-[#191817]">
                        AI 학술 재검토 종합 소견 (ADVISORY REVIEW)
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 font-academic-mono text-[11px]">
                      <span
                        className={`px-2 py-0.5 rounded-xs font-bold border ${
                          aiReviewResult.isReportJustified
                            ? 'bg-red-100 text-red-900 border-red-300'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        }`}
                      >
                        신고 타당성: {aiReviewResult.isReportJustified ? '오류 인정 (수정 권고)' : '문제 없음 (기각 권고)'}
                      </span>
                      <span className="px-2 py-0.5 rounded-xs bg-[#f4f1ea] border border-[#ded6c8] text-[#57544e]">
                        심각도: {aiReviewResult.severity}
                      </span>
                    </div>
                  </div>

                  {/* Deterministic Rule Verification Badges */}
                  <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1.5">
                    <div className="text-[11px] font-academic-mono font-bold text-[#57544e] uppercase">
                      확인 가능한 필수 규칙 검증:
                    </div>
                    <div className="text-xs font-academic-mono text-[#191817]">
                      {aiReviewResult.ruleChecks.details}
                    </div>
                  </div>

                  {/* Analysis Summary */}
                  <div className="space-y-1 text-xs">
                    <strong className="block font-academic-mono text-[11px] text-[#57544e]">
                      학술적 분석 총평:
                    </strong>
                    <p className="korean-prose leading-relaxed text-[#191817] bg-[#fcfbf9] p-3 rounded-xs border border-[#ded6c8]">
                      {aiReviewResult.analysisSummary}
                    </p>
                  </div>

                  {/* Suggested Fixes */}
                  {aiReviewResult.suggestedFixes && (
                    <div className="space-y-1 text-xs">
                      <strong className="block font-academic-mono text-[11px] text-amber-900">
                        AI 제안 수정안:
                      </strong>
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xs text-[11.5px] leading-relaxed text-amber-950 whitespace-pre-wrap">
                        {aiReviewResult.suggestedFixes}
                      </div>
                    </div>
                  )}

                  {/* Critical Invariant Warning */}
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xs text-[11px] text-blue-900 leading-relaxed flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>원칙 안내: </strong>
                      AI의 &apos;문제없음&apos; 소견만으로 자동 재승인되지 않습니다.
                      출처 대조 및 필수 100점 배점 합계를 확인한 뒤, 사용자가 직접 [재승인 확정]을 클릭해야 풀이 목록에 복귀됩니다.
                    </span>
                  </div>
                </div>
              )}

              {/* Section 3: 문제 내용 및 수정 편집기 (Problem Content or Revision Editor) */}
              <div className="bg-white border border-[#ded6c8] rounded-xs p-4 sm:p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#57544e]" />
                    <h3 className="font-bold text-xs sm:text-sm font-academic-serif text-[#191817]">
                      {isEditing ? `문제 수정 편집기 (v${(activeProblem.version || 1) + 1} 생성)` : `문제 본문 및 규격 [v${activeProblem.version || 1}]`}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 font-academic-mono text-xs">
                    <span className="text-[#827d73]">루브릭 합계:</span>
                    <span
                      className={`font-bold px-1.5 py-0.5 rounded-2xs ${
                        rubricScoreSum === 100
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-red-100 text-red-900'
                      }`}
                    >
                      {rubricScoreSum} / 100점
                    </span>
                  </div>
                </div>

                {!isEditing ? (
                  /* Read-Only Preview */
                  <div className="space-y-4 text-xs">
                    <div className="space-y-1">
                      <div className="text-[11px] font-academic-mono text-[#827d73] uppercase">
                        문제 지문 (PROMPT):
                      </div>
                      <p className="text-sm sm:text-base font-bold text-[#191817] font-academic-serif leading-relaxed korean-prose whitespace-pre-wrap">
                        {activeProblem.promptText}
                      </p>
                    </div>

                    {activeProblem.mathFormula && (
                      <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-center overflow-x-auto">
                        <MathFormula math={activeProblem.mathFormula} displayMode />
                      </div>
                    )}

                    {activeProblem.codeSnippet && (
                      <pre className="p-3 bg-[#191817] text-[#ded6c8] text-xs font-mono rounded-xs overflow-x-auto leading-relaxed whitespace-pre-wrap">
                        <code>{activeProblem.codeSnippet}</code>
                      </pre>
                    )}

                    {/* Hints */}
                    {activeProblem.hints && activeProblem.hints.length > 0 && (
                      <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1.5">
                        <span className="font-academic-mono font-bold text-[11px] text-[#57544e]">
                          단계별 힌트 ({activeProblem.hints.length}단계):
                        </span>
                        <div className="space-y-1">
                          {activeProblem.hints.map((h, i) => (
                            <div key={i} className="text-[11.5px] text-[#2e2c29] flex items-start gap-1.5">
                              <span className="font-mono text-[#c52828] font-bold shrink-0">[{i + 1}]</span>
                              <span>{h}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Model Answer Toggle */}
                    <div className="border border-[#ded6c8] rounded-xs overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setIsModelAnswerVisible(!isModelAnswerVisible)}
                        className="w-full px-3.5 py-2 bg-[#f6f3eb] hover:bg-[#ede8dc] flex items-center justify-between text-xs transition-colors"
                      >
                        <span className="font-bold text-[#57544e] flex items-center gap-1.5">
                          {isModelAnswerVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>출제자 모범 답안 (MODEL ANSWER)</span>
                        </span>
                        <span className="text-[11px] font-academic-mono text-[#827d73]">
                          {isModelAnswerVisible ? '접기' : '열람하기'}
                        </span>
                      </button>
                      {isModelAnswerVisible && (
                        <div className="p-4 bg-white text-xs leading-relaxed text-[#191817] whitespace-pre-wrap border-t border-[#ded6c8] font-serif">
                          {activeProblem.modelAnswer}
                        </div>
                      )}
                    </div>

                    {/* Rubric Criteria Table */}
                    <div className="space-y-2">
                      <span className="font-academic-mono font-bold text-[11px] text-[#57544e] uppercase">
                        채점 기준 및 세부 루브릭 (100점 배점표):
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activeProblem.rubric.map((r) => (
                          <div key={r.id} className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-[#191817]">{r.label}</span>
                              <span className="font-academic-mono text-xs font-bold text-[#c52828]">
                                {r.maxScore}점
                              </span>
                            </div>
                            <p className="text-[11px] text-[#57544e] leading-snug">{r.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Edit Mode Form (Creates Next Version) */
                  <div className="space-y-4 text-xs animate-fade-in">
                    {/* Mandatory Edit Reason */}
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-xs space-y-1">
                      <label className="block text-xs font-academic-mono font-bold text-amber-950">
                        수정 사유 및 개정 내역 요약 <span className="text-[#c52828]">*</span>
                      </label>
                      <input
                        type="text"
                        value={editReasonText}
                        onChange={(e) => setEditReasonText(e.target.value)}
                        placeholder="예: 신고 피드백 반영 - 조건식 정의역 추가 및 모범답안 적분 부호 정정"
                        className="w-full p-2 bg-white border border-amber-300 rounded-xs text-xs focus:border-[#191817]"
                      />
                      <span className="text-[10.5px] font-academic-mono text-amber-800">
                        * 저장 시 기존 지문/정답/루브릭은 v{activeProblem.version || 1} 스냅샷으로 보존되며, 새 v{(activeProblem.version || 1) + 1}가 생성됩니다.
                      </span>
                    </div>

                    {/* Edit Title */}
                    <div>
                      <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                        문제 제목:
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-xs font-bold"
                      />
                    </div>

                    {/* Edit Prompt */}
                    <div>
                      <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                        문제 지문 (LaTeX 수식 기호 $...$ 사용 가능):
                      </label>
                      <textarea
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        rows={5}
                        className="w-full p-3 border border-[#ded6c8] rounded-xs bg-white text-xs leading-relaxed"
                      />
                    </div>

                    {/* Edit Math Formula */}
                    <div>
                      <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                        핵심 수식 (LaTeX, 선택사항):
                      </label>
                      <input
                        type="text"
                        value={editFormula}
                        onChange={(e) => setEditFormula(e.target.value)}
                        placeholder="예: E[Y|X] = \int y f(y|x) dy"
                        className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-xs font-mono"
                      />
                    </div>

                    {/* Edit Hints */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-academic-mono text-[#57544e]">
                          단계별 힌트:
                        </label>
                        <button
                          type="button"
                          onClick={() => setEditHints([...editHints, ''])}
                          className="text-[11px] font-academic-mono text-[#c52828] hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>힌트 추가</span>
                        </button>
                      </div>
                      {editHints.map((hint, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#827d73]">#{idx + 1}</span>
                          <input
                            type="text"
                            value={hint}
                            onChange={(e) => {
                              const next = [...editHints];
                              next[idx] = e.target.value;
                              setEditHints(next);
                            }}
                            className="flex-1 p-2 border border-[#ded6c8] rounded-xs bg-white text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setEditHints(editHints.filter((_, i) => i !== idx))}
                            className="p-1.5 text-gray-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Edit Model Answer */}
                    <div>
                      <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                        출제자 모범 답안 및 상세 풀이:
                      </label>
                      <textarea
                        value={editModelAnswer}
                        onChange={(e) => setEditModelAnswer(e.target.value)}
                        rows={7}
                        className="w-full p-3 border border-[#ded6c8] rounded-xs bg-white text-xs leading-relaxed font-serif"
                      />
                    </div>

                    {/* Edit Rubric Criteria */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-academic-mono text-[#57544e]">
                          채점 루브릭 (합계 100점 필수):
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setEditRubric([
                              ...editRubric,
                              {
                                id: `r-${editRubric.length + 1}`,
                                label: `${editRubric.length + 1}. 신규 평가 기준`,
                                maxScore: 20,
                                weight: 0.2,
                                description: '세부 채점 지침 작성',
                              },
                            ])
                          }
                          className="text-[11px] font-academic-mono text-[#c52828] hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>루브릭 기준 추가</span>
                        </button>
                      </div>

                      <div className="space-y-2">
                        {editRubric.map((r, idx) => (
                          <div key={r.id} className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={r.label}
                                onChange={(e) => {
                                  const next = [...editRubric];
                                  next[idx] = { ...next[idx], label: e.target.value };
                                  setEditRubric(next);
                                }}
                                className="flex-1 p-1.5 border border-[#ded6c8] rounded-xs bg-white text-xs font-bold"
                              />
                              <div className="flex items-center gap-1 shrink-0 font-academic-mono">
                                <input
                                  type="number"
                                  value={r.maxScore}
                                  onChange={(e) => {
                                    const next = [...editRubric];
                                    const val = Number(e.target.value) || 0;
                                    next[idx] = { ...next[idx], maxScore: val, weight: val / 100 };
                                    setEditRubric(next);
                                  }}
                                  className="w-16 p-1.5 border border-[#ded6c8] rounded-xs bg-white text-xs text-right font-bold text-[#c52828]"
                                />
                                <span className="text-xs">점</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditRubric(editRubric.filter((_, i) => i !== idx))}
                                className="p-1 text-gray-500 hover:text-red-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={r.description}
                              onChange={(e) => {
                                const next = [...editRubric];
                                next[idx] = { ...next[idx], description: e.target.value };
                                setEditRubric(next);
                              }}
                              placeholder="평가 기준 설명"
                              className="w-full p-1.5 border border-[#ded6c8] rounded-xs bg-white text-xs text-[#57544e]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Validation Error Banner */}
                    {editValidationError && (
                      <div className="p-3 bg-red-50 border border-red-300 rounded-xs text-xs text-red-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>{editValidationError}</span>
                      </div>
                    )}

                    {/* Save Revision Button */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ded6c8]">
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-4 py-2 border border-[#ded6c8] text-[#57544e] rounded-xs hover:bg-[#faf8f4]"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveRevisedVersion}
                        className="px-5 py-2 bg-[#c52828] hover:bg-[#a82020] text-white font-bold rounded-xs shadow-xs flex items-center gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>새 버전(v{(activeProblem.version || 1) + 1})으로 저장 및 수정 완료</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 4: 과거 수정 내역 (Version History Section) */}
              <div className="bg-white border border-[#ded6c8] rounded-xs p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#57544e]" />
                    <h3 className="font-bold text-xs sm:text-sm font-academic-serif text-[#191817]">
                      과거 버전 수정 내역 및 스냅샷 이력 ({activeProblem.versionHistory?.length || 0}건)
                    </h3>
                  </div>
                  <span className="text-[11px] font-academic-mono text-[#827d73]">
                    과거 풀이 기록은 당시 버전 지문과 점수를 불변 보존함
                  </span>
                </div>

                {!activeProblem.versionHistory || activeProblem.versionHistory.length === 0 ? (
                  <div className="p-4 bg-[#faf8f4] border border-[#f1ede4] rounded-xs text-xs text-[#827d73] text-center">
                    수정 이력이 없는 초기 버전(v1)입니다.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeProblem.versionHistory.map((snap) => {
                      const isExpanded = expandedVersionNum === snap.version;
                      return (
                        <div key={snap.version} className="border border-[#ded6c8] rounded-xs overflow-hidden text-xs">
                          <button
                            type="button"
                            onClick={() => setExpandedVersionNum(isExpanded ? null : snap.version)}
                            className="w-full p-3 bg-[#faf8f4] hover:bg-[#f6f3eb] flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-academic-mono font-bold text-[#c52828]">
                                [v{snap.version} 스냅샷]
                              </span>
                              <span className="font-medium text-[#191817]">
                                사유: {snap.editReason || '수정 기록'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] font-academic-mono text-[#827d73]">
                              <span>{new Date(snap.editedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="p-4 bg-white border-t border-[#ded6c8] space-y-3">
                              <div className="space-y-1">
                                <span className="font-academic-mono font-bold text-[10.5px] text-[#827d73] uppercase">
                                  v{snap.version} 당시 문제 지문:
                                </span>
                                <p className="korean-prose whitespace-pre-wrap text-[11.5px] text-[#2e2c29] bg-[#fcfbf9] p-2.5 rounded-2xs border border-[#ded6c8]">
                                  {snap.promptText}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-academic-mono font-bold text-[10.5px] text-[#827d73] uppercase">
                                  v{snap.version} 당시 모범 답안:
                                </span>
                                <p className="font-serif whitespace-pre-wrap text-[11.5px] text-[#2e2c29] bg-[#fcfbf9] p-2.5 rounded-2xs border border-[#ded6c8]">
                                  {snap.modelAnswer}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <span className="font-academic-mono font-bold text-[10.5px] text-[#827d73] uppercase">
                                  v{snap.version} 당시 루브릭 ({snap.rubric?.reduce((s, r) => s + (Number(r.maxScore) || 0), 0)}점):
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {snap.rubric?.map((r) => (
                                    <div key={r.id} className="p-2 bg-[#faf8f4] border border-[#ded6c8] rounded-2xs text-[11px]">
                                      <div className="flex justify-between font-bold">
                                        <span>{r.label}</span>
                                        <span>{r.maxScore}점</span>
                                      </div>
                                      <p className="text-[#57544e] text-[10.5px]">{r.description}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-xs text-[#827d73] font-academic-mono">
            선택된 문제가 없습니다.
          </div>
        )}
      </div>

      {/* Re-approval Confirmation Modal */}
      {isReapproving && activeProblem && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-[#c8c2b5] rounded-xs shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
              <div className="flex items-center gap-2 font-bold text-[#191817] font-academic-serif">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>문제 재승인 확정 및 풀이 복귀</span>
              </div>
              <button
                type="button"
                onClick={() => setIsReapproving(false)}
                className="text-[#827d73] hover:text-[#191817]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[#57544e] leading-relaxed">
              본 문제(v{activeProblem.version || 1})의 오류 검토 및 수정/확인이 완료되었습니까?
              재승인 확정 시 해당 문제는 <span className="font-bold text-emerald-800">[재승인]</span> 상태로 변경되어
              <strong> 오늘의 복습 및 모의시험 출제 목록에 다시 포함</strong>됩니다.
            </p>

            <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-[11px] font-academic-mono space-y-1">
              <div>• 문제 제목: <strong>{activeProblem.title}</strong></div>
              <div>• 루브릭 배점 합계: <strong>{rubricScoreSum} / 100점</strong> {rubricScoreSum === 100 ? '✓ 만점 규격 충족' : '✗ 100점 불일치'}</div>
              <div>• 미해결 신고 건수: <strong>{(activeProblem.reports || []).filter((r) => r.status === 'open' || r.status === 'under_review').length}건 자동 종결 예정</strong></div>
            </div>

            <div>
              <label className="block text-[11px] font-academic-mono text-[#57544e] mb-1">
                재승인 처리 사유 및 메모 (선택사항):
              </label>
              <input
                type="text"
                value={reapprovalNoteInput}
                onChange={(e) => setReapprovalNoteInput(e.target.value)}
                placeholder="예: 원문 교재 제3장 42페이지 대조 완료, 루브릭 100점 정상 확인"
                className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-xs"
              />
            </div>

            {reapprovalError && (
              <div className="p-2 bg-red-50 border border-red-300 rounded-xs text-red-900 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{reapprovalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
              <button
                type="button"
                onClick={() => setIsReapproving(false)}
                className="px-3.5 py-1.5 border border-[#ded6c8] text-[#57544e] rounded-xs hover:bg-[#faf8f4]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmReapprove}
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xs shadow-xs"
              >
                재승인 확정하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss Report Modal */}
      {dismissingReport && activeProblem && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-[#c8c2b5] rounded-xs shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#f1ede4]">
              <div className="flex items-center gap-2 font-bold text-[#191817] font-academic-serif">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>신고 기각 / 반려 처리</span>
              </div>
              <button
                type="button"
                onClick={() => setDismissingReport(null)}
                className="text-[#827d73] hover:text-[#191817]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <span className="font-academic-mono text-[10.5px] text-[#827d73]">
                기각 대상 신고: [{PROBLEM_REPORT_TYPE_LABELS[dismissingReport.type]}]
              </span>
              <p className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-[11.5px] text-[#2e2c29]">
                &ldquo;{dismissingReport.details}&rdquo;
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-academic-mono text-[#191817] font-bold mb-1">
                신고 기각 사유 (필수 작성) <span className="text-[#c52828]">*</span>
              </label>
              <textarea
                value={dismissReasonInput}
                onChange={(e) => setDismissReasonInput(e.target.value)}
                rows={3}
                placeholder="예: 교재 원문 45쪽 정리 3.2에 의해 연속형 확률변수의 경우 해당 적분식이 엄밀히 성립하므로 오류가 아닙니다."
                className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-white text-xs leading-relaxed"
              />
              <span className="text-[10px] font-academic-mono text-[#827d73]">
                * 모든 신고가 기각되면 해당 문제는 다시 정상/재승인 상태로 복구되어 풀이에 사용될 수 있습니다.
              </span>
            </div>

            {dismissError && (
              <div className="p-2 bg-red-50 border border-red-300 rounded-xs text-red-900 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{dismissError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
              <button
                type="button"
                onClick={() => setDismissingReport(null)}
                className="px-3.5 py-1.5 border border-[#ded6c8] text-[#57544e] rounded-xs hover:bg-[#faf8f4]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDismissReport}
                className="px-4 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs"
              >
                기각 사유 저장 및 종결
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
