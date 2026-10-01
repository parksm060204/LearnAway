'use client';

import React, { useState, useMemo } from 'react';
import { Subject, Material, ConceptDraft, Concept } from '../lib/types';
import {
  saveStoredConceptDrafts,
  approveConceptDraft,
  batchApproveConceptDrafts,
  deleteConceptDraft,
  mergeConceptDrafts,
  markConceptAsLearned,
} from '../lib/storage';
import { computeMarkdownHash } from '../lib/markdownUtils';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Combine,
  CheckCheck,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  Edit3,
} from 'lucide-react';

interface ConceptReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSubject: Subject;
  material: Material | null;
  drafts: ConceptDraft[];
  onUpdateDrafts: (updatedDrafts: ConceptDraft[]) => void;
  onConceptsUpdated: (updatedConcepts: Concept[]) => void;
  onOpenMaterialEditor?: (material: Material) => void;
  onTriggerAnalysis?: (material: Material) => void;
  isAnalyzing?: boolean;
}

export function ConceptReviewModal({
  isOpen,
  onClose,
  activeSubject,
  material,
  drafts,
  onUpdateDrafts,
  onConceptsUpdated,
  onOpenMaterialEditor,
  onTriggerAnalysis,
  isAnalyzing = false,
}: ConceptReviewModalProps) {
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'pending' | 'approved' | 'unverified'>('all');
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Editable fields for selected draft
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFormula, setEditFormula] = useState('');
  const [editPrereq, setEditPrereq] = useState('');
  const [editRelated, setEditRelated] = useState('');
  const [editMisconceptions, setEditMisconceptions] = useState('');
  const [editExamples, setEditExamples] = useState('');

  // Filter drafts for current subject and (if selected) material
  const subjectDrafts = useMemo(() => {
    return drafts.filter((d) => {
      if (d.subjectId !== activeSubject.id) return false;
      if (material && d.materialId !== material.id) return false;
      return true;
    });
  }, [drafts, activeSubject.id, material]);

  const filteredDrafts = useMemo(() => {
    return subjectDrafts.filter((d) => {
      if (filterMode === 'pending' && d.isApproved) return false;
      if (filterMode === 'approved' && !d.isApproved) return false;
      if (filterMode === 'unverified' && d.sourceEvidence.verified) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          (d.coreDefinitionFormulaOrAlgorithm || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [subjectDrafts, filterMode, searchQuery]);

  // Active draft object
  const activeDraft = useMemo(() => {
    return (
      subjectDrafts.find((d) => d.id === selectedDraftId) ||
      filteredDrafts[0] ||
      subjectDrafts[0] ||
      null
    );
  }, [subjectDrafts, selectedDraftId, filteredDrafts]);

  // Reset the edit form when the active draft changes. This runs during render
  // (guarded), which is hydration-safe and avoids cascading effect renders.
  const [syncedDraftId, setSyncedDraftId] = useState<string | null>(null);
  if (activeDraft && syncedDraftId !== activeDraft.id) {
    setSyncedDraftId(activeDraft.id);
    setEditTitle(activeDraft.title);
    setEditDescription(activeDraft.description);
    setEditFormula(activeDraft.coreDefinitionFormulaOrAlgorithm || '');
    setEditPrereq(activeDraft.prerequisites.join(', '));
    setEditRelated(activeDraft.relatedConcepts.join(', '));
    setEditMisconceptions(activeDraft.commonMisconceptions.join(', '));
    setEditExamples(activeDraft.examples.join('\n'));
  }

  if (!isOpen) return null;

  // Check if current material markdown hash matches the draft source hash
  const isOutdated = Boolean(
    material &&
      material.parsedMarkdown &&
      activeDraft &&
      activeDraft.sourceMarkdownHash &&
      activeDraft.sourceMarkdownHash !== computeMarkdownHash(material.parsedMarkdown)
  );

  const pendingCount = subjectDrafts.filter((d) => !d.isApproved).length;
  const approvedCount = subjectDrafts.filter((d) => d.isApproved).length;
  const unverifiedCount = subjectDrafts.filter((d) => !d.sourceEvidence.verified).length;

  const handleSaveDraftEdits = () => {
    if (!activeDraft) return;

    const updated: ConceptDraft = {
      ...activeDraft,
      title: editTitle.trim() || activeDraft.title,
      description: editDescription.trim(),
      coreDefinitionFormulaOrAlgorithm: editFormula.trim() || undefined,
      prerequisites: editPrereq
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      relatedConcepts: editRelated
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      commonMisconceptions: editMisconceptions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      examples: editExamples
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      updatedAt: new Date().toISOString(),
      editedByUser: true,
    };

    const nextDrafts = drafts.map((d) => (d.id === activeDraft.id ? updated : d));
    onUpdateDrafts(nextDrafts);
    saveStoredConceptDrafts(nextDrafts);
    alert('개념 초안 수정사항이 저장되었습니다.');
  };

  const handleApproveSingle = (draftId: string) => {
    const { updatedDrafts, updatedConcepts } = approveConceptDraft(draftId);
    onUpdateDrafts(updatedDrafts);
    onConceptsUpdated(updatedConcepts);
  };

  const handleBatchApprove = () => {
    const pendingIds = subjectDrafts.filter((d) => !d.isApproved).map((d) => d.id);
    if (pendingIds.length === 0) {
      alert('승인 대기 중인 초안이 없습니다.');
      return;
    }
    if (confirm(`총 ${pendingIds.length}개의 개념 초안을 일괄 승인하시겠습니까?`)) {
      const { updatedDrafts, updatedConcepts } = batchApproveConceptDrafts(pendingIds);
      onUpdateDrafts(updatedDrafts);
      onConceptsUpdated(updatedConcepts);
    }
  };

  const handleDelete = (draftId: string) => {
    if (confirm('이 개념 초안을 삭제하시겠습니까?')) {
      const updated = deleteConceptDraft(draftId);
      onUpdateDrafts(updated);
      setSelectedForMerge((prev) => prev.filter((id) => id !== draftId));
      if (selectedDraftId === draftId) {
        setSelectedDraftId('');
      }
    }
  };

  const handleToggleMergeSelect = (draftId: string) => {
    if (selectedForMerge.includes(draftId)) {
      setSelectedForMerge(selectedForMerge.filter((id) => id !== draftId));
    } else {
      if (selectedForMerge.length >= 2) {
        setSelectedForMerge([selectedForMerge[1], draftId]);
      } else {
        setSelectedForMerge([...selectedForMerge, draftId]);
      }
    }
  };

  const handleExecuteMerge = () => {
    if (selectedForMerge.length !== 2) return;
    const [targetId, sourceId] = selectedForMerge;
    const target = subjectDrafts.find((d) => d.id === targetId);
    const source = subjectDrafts.find((d) => d.id === sourceId);
    if (!target || !source) return;

    if (
      confirm(
        `'${source.title}' 개념을 '${target.title}' 개념으로 병합하시겠습니까?\n(선수 개념, 관련 개념, 예제 항목이 통합됩니다)`
      )
    ) {
      const updated = mergeConceptDrafts(targetId, sourceId);
      onUpdateDrafts(updated);
      setSelectedForMerge([]);
      setSelectedDraftId(targetId);
      alert('두 개념 초안이 하나로 병합되었습니다.');
    }
  };

  const handleMarkAsLearned = (draftId: string) => {
    // Find concept connected to this draft
    const concepts = approveConceptDraft(draftId).updatedConcepts;
    const connectedConcept = concepts.find((c) => c.draftId === draftId);
    if (connectedConcept) {
      const scoreStr = prompt(
        `[${connectedConcept.title}]의 초기 학습 이해도 점수를 입력해 주세요 (0~100):`,
        '85'
      );
      if (scoreStr !== null) {
        const score = Math.max(0, Math.min(100, Number(scoreStr) || 85));
        const { updatedConcepts } = markConceptAsLearned(connectedConcept.id, score);
        onConceptsUpdated(updatedConcepts);
        alert(`'${connectedConcept.title}' 개념이 학습 완료(초기 점수 ${score}점)로 등록되었습니다.`);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-6xl h-[94vh] bg-white border border-[#c8c2b5] rounded-xs shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="bg-[#191817] text-white px-5 py-3.5 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#c52828]" />
              <h2 className="font-academic-serif font-bold text-sm">
                AI 개념 분석 초안 검토 및 승인
              </h2>
            </div>

            <div className="text-[11px] font-academic-mono text-[#ded6c8] flex items-center gap-2">
              <span>과목: {activeSubject.name}</span>
              {material && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-xs">자료: {material.title}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {material && onTriggerAnalysis && (
              <button
                onClick={() => onTriggerAnalysis(material)}
                disabled={isAnalyzing}
                className="px-3 py-1.5 bg-[#33302b] hover:bg-[#44403a] text-white text-xs font-academic-mono rounded-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                title="최신 Markdown 본문으로 AI 개념 재분석 실행"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? '분석 중...' : '재분석 실행'}</span>
              </button>
            )}

            <button
              onClick={handleBatchApprove}
              disabled={pendingCount === 0}
              className="px-3 py-1.5 bg-[#c52828] hover:bg-[#a52020] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-40"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>전체 일괄 승인 ({pendingCount})</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-[#ded6c8] hover:text-white hover:bg-white/10 rounded"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Outdated Warning Banner */}
        {isOutdated && (
          <div className="bg-amber-50 border-b border-amber-300 px-5 py-2 flex items-center justify-between text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Markdown 원문 변경 감지:</strong> 이 초안은 자료 수정 이전 내용에 기반하고 있습니다.
              </span>
            </div>
            {material && onTriggerAnalysis && (
              <button
                onClick={() => onTriggerAnalysis(material)}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold"
              >
                최신 내용으로 재분석
              </button>
            )}
          </div>
        )}

        {/* Sub-Header Filters */}
        <div className="bg-[#faf8f4] border-b border-[#ded6c8] px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterMode === 'all'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              전체 ({subjectDrafts.length})
            </button>
            <button
              onClick={() => setFilterMode('pending')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterMode === 'pending'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              검토 대기 ({pendingCount})
            </button>
            <button
              onClick={() => setFilterMode('approved')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterMode === 'approved'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              승인 완료 ({approvedCount})
            </button>
            <button
              onClick={() => setFilterMode('unverified')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterMode === 'unverified'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              인용 확인 필요 ({unverifiedCount})
            </button>
          </div>

          {/* Merge tool button */}
          <div className="flex items-center gap-2">
            {selectedForMerge.length === 2 && (
              <button
                onClick={handleExecuteMerge}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold flex items-center gap-1 shadow-2xs"
              >
                <Combine className="w-3.5 h-3.5" />
                <span>선택한 2개 개념 병합</span>
              </button>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-[#827d73]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="개념명 / 수식 검색..."
                className="pl-7 pr-3 py-1 text-xs border border-[#ded6c8] rounded bg-white text-[#191817] w-48"
              />
            </div>
          </div>
        </div>

        {/* Main Body (2 Columns) */}
        {subjectDrafts.length === 0 ? (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#fdfcfb]">
            <div className="w-14 h-14 bg-white border border-[#ded6c8] rounded-full flex items-center justify-center text-[#827d73] mb-3 shadow-2xs">
              <Sparkles className="w-6 h-6 text-[#c52828]" />
            </div>
            <h3 className="font-academic-serif font-bold text-base text-[#191817] mb-1">
              추출된 개념 초안이 없습니다.
            </h3>
            <p className="text-xs text-[#57544e] max-w-md leading-relaxed mb-5">
              사용자가 검토하고 저장한 Markdown 본문에서 <strong>AI 개념 분석</strong>을 실행하면
              수학·알고리즘의 핵심 정의, 수식, 선수 개념, 출처 인용구를 자동으로 추출하여 이 화면에서 검토할 수 있습니다.
            </p>
            {material && onTriggerAnalysis && (
              <button
                onClick={() => onTriggerAnalysis(material)}
                disabled={isAnalyzing}
                className="px-4 py-2 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-[#c52828]" />
                <span>{isAnalyzing ? 'AI 분석 중...' : '이 자료 AI 개념 분석 실행'}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Column: Drafts List */}
            <div className="w-5/12 border-r border-[#ded6c8] bg-[#fbf9f5] flex flex-col overflow-hidden">
              <div className="p-3 border-b border-[#ded6c8] bg-[#f5f2eb] flex items-center justify-between text-[11px] font-academic-mono text-[#57544e]">
                <span>
                  초안 목록 ({filteredDrafts.length}건)
                  {selectedForMerge.length > 0 && ` • ${selectedForMerge.length}개 선택됨`}
                </span>
                <span className="text-[10px] text-[#827d73]">체크박스로 2개 선택 시 병합 가능</span>
              </div>

              <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
                {filteredDrafts.map((d) => {
                  const isSelected = activeDraft?.id === d.id;
                  const isMergeChecked = selectedForMerge.includes(d.id);

                  return (
                    <div
                      key={d.id}
                      onClick={() => setSelectedDraftId(d.id)}
                      className={`p-3 rounded-xs border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-white border-[#191817] shadow-sm ring-1 ring-[#191817]'
                          : 'bg-white border-[#ded6c8] hover:border-[#827d73]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isMergeChecked}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleMergeSelect(d.id);
                            }}
                            className="rounded border-[#c8c2b5] text-[#c52828] focus:ring-0"
                            title="병합 대상으로 선택"
                          />
                          <h4 className="font-academic-serif font-bold text-xs text-[#191817] truncate">
                            {d.title}
                          </h4>
                        </div>

                        {d.isApproved ? (
                          <span className="text-[10px] font-academic-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-semibold shrink-0">
                            ✓ 승인됨
                          </span>
                        ) : (
                          <span className="text-[10px] font-academic-mono bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.2 rounded font-semibold shrink-0">
                            검토 대기
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-[#57544e] line-clamp-2 leading-relaxed mb-2 font-sans">
                        {d.description}
                      </p>

                      <div className="flex items-center justify-between text-[10px] font-academic-mono text-[#827d73] border-t border-[#f1ede4] pt-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="bg-[#f4f1ea] px-1 py-0.2 rounded text-[#57544e]">
                            {d.sourceEvidence.type === 'page'
                              ? `§ p.${d.sourceEvidence.pageNumber || 1}`
                              : d.sourceEvidence.timestamp || `발화 #${d.sourceEvidence.blockIndex || 1}`}
                          </span>

                          {d.sourceEvidence.verified ? (
                            <span className="text-emerald-700 flex items-center gap-0.5">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" /> 인용 검증됨
                            </span>
                          ) : (
                            <span className="text-amber-700 flex items-center gap-0.5">
                              <ShieldAlert className="w-3 h-3 text-amber-600" /> 인용 확인 필요
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {!d.isApproved ? (
                            <button
                              onClick={() => handleApproveSingle(d.id)}
                              className="px-2 py-0.5 bg-[#191817] hover:bg-[#33302b] text-white rounded text-[10px] font-bold"
                            >
                              승인
                            </button>
                          ) : (
                            <button
                              onClick={() => handleApproveSingle(d.id)}
                              className="px-1.5 py-0.5 text-[#827d73] hover:text-[#191817] text-[10px]"
                            >
                              승인 취소
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Draft Detail & Source Evidence */}
            {activeDraft ? (
              <div className="w-7/12 flex flex-col bg-white overflow-hidden">
                {/* Detail Header & Action Buttons */}
                <div className="p-4 border-b border-[#ded6c8] bg-[#fdfcfb] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-academic-mono text-[#827d73]">
                      개념 초안 ID: {activeDraft.id} • 분야: {activeDraft.domain === 'math_stats' ? '수리통계' : '컴퓨터과학'}
                    </span>
                    <h3 className="font-academic-serif font-bold text-base text-[#191817]">
                      {activeDraft.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveDraftEdits}
                      className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-[#191817] rounded text-xs font-semibold flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>수정 저장</span>
                    </button>

                    {!activeDraft.isApproved ? (
                      <button
                        onClick={() => handleApproveSingle(activeDraft.id)}
                        className="px-3 py-1.5 bg-[#c52828] hover:bg-[#a52020] text-white rounded text-xs font-bold flex items-center gap-1 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>이 개념 승인</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleMarkAsLearned(activeDraft.id)}
                        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-bold flex items-center gap-1 shadow-xs"
                        title="학습 완료 및 초기 기준 점수 등록"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                        <span>학습 완료로 표시</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(activeDraft.id)}
                      className="p-1.5 text-[#827d73] hover:text-[#c52828] hover:bg-red-50 rounded"
                      title="초안 삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Form & Source Verification Content */}
                <div className="flex-1 p-5 overflow-y-auto space-y-4 text-xs font-sans">
                  {/* Source Evidence & Citation Card (Prominent requirement) */}
                  <div
                    className={`p-3.5 rounded-xs border text-xs space-y-2 ${
                      activeDraft.sourceEvidence.verified
                        ? 'bg-emerald-50/60 border-emerald-300 text-emerald-950'
                        : 'bg-amber-50/70 border-amber-300 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between font-academic-mono text-[11px] font-bold">
                      <div className="flex items-center gap-1.5">
                        {activeDraft.sourceEvidence.verified ? (
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-amber-600" />
                        )}
                        <span>원문 출처 근거 및 서버 검증 결과</span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          activeDraft.sourceEvidence.verified
                            ? 'bg-emerald-200/70 text-emerald-900'
                            : 'bg-amber-200/70 text-amber-900'
                        }`}
                      >
                        {activeDraft.sourceEvidence.verified ? '검증 완료' : '사용자 확인 필요'}
                      </span>
                    </div>

                    <div className="text-[11px] space-y-1">
                      <div>
                        • 위치 참조:{' '}
                        <strong>
                          {activeDraft.sourceEvidence.type === 'page'
                            ? `제${activeDraft.sourceEvidence.pageNumber || 1}페이지`
                            : activeDraft.sourceEvidence.timestamp
                            ? `전사본 ${activeDraft.sourceEvidence.timestamp}`
                            : `전사본 발화 #${activeDraft.sourceEvidence.blockIndex || 1}`}
                          {activeDraft.sourceEvidence.speaker && ` (${activeDraft.sourceEvidence.speaker})`}
                        </strong>
                      </div>
                      <div>• 상태 메모: {activeDraft.sourceEvidence.verificationNote}</div>
                    </div>

                    {activeDraft.sourceEvidence.quote && (
                      <div className="p-2.5 bg-white border border-[#ded6c8] rounded text-[11px] font-academic-mono italic text-[#2e2c29] leading-relaxed">
                        &quot;{activeDraft.sourceEvidence.quote}&quot;
                      </div>
                    )}

                    {material && onOpenMaterialEditor && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => {
                            onClose();
                            onOpenMaterialEditor(material);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-[#191817] rounded text-[11px] font-semibold flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3 text-[#c52828]" />
                          <span>원문 대조 편집기에서 이 위치 확인</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                      개념 명칭 (제목):
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817] font-academic-serif font-bold text-sm"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                      학술적 설명:
                    </label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-white text-[#191817] text-xs leading-relaxed resize-y"
                    />
                  </div>

                  {/* Core Definition / Formula / Algorithm */}
                  <div>
                    <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                      핵심 정의, 수식 ($...$) 또는 알고리즘 단계:
                    </label>
                    <textarea
                      value={editFormula}
                      onChange={(e) => setEditFormula(e.target.value)}
                      rows={3}
                      placeholder="$$E[Y|X=x] = \int y f(y|x) dy$$ 또는 1. 단계..."
                      className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817] font-academic-mono text-xs resize-y"
                    />
                  </div>

                  {/* Prerequisites & Related Concepts */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                        선수 개념 (쉼표로 구분):
                      </label>
                      <input
                        type="text"
                        value={editPrereq}
                        onChange={(e) => setEditPrereq(e.target.value)}
                        placeholder="예: 결합확률밀도, 조건부분포"
                        className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                      />
                    </div>

                    <div>
                      <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                        관련 개념 (쉼표로 구분):
                      </label>
                      <input
                        type="text"
                        value={editRelated}
                        onChange={(e) => setEditRelated(e.target.value)}
                        placeholder="예: 푸비니 정리, 분산 분해"
                        className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                      />
                    </div>
                  </div>

                  {/* Common Misconceptions */}
                  <div>
                    <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                      흔한 오해 및 시험 감점 주의사항:
                    </label>
                    <input
                      type="text"
                      value={editMisconceptions}
                      onChange={(e) => setEditMisconceptions(e.target.value)}
                      placeholder="예: 절대수렴 조건 미확인 시 푸비니 정리 적용 불가"
                      className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                    />
                  </div>

                  {/* Examples (Separated from Theory) */}
                  <div>
                    <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
                      원문 언급 예제 (줄바꿈으로 구분):
                    </label>
                    <textarea
                      value={editExamples}
                      onChange={(e) => setEditExamples(e.target.value)}
                      rows={2}
                      placeholder="예: 예제 3.2 - 균등분포에서의 조건부 기댓값 도출"
                      className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817] text-xs resize-y"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-7/12 flex items-center justify-center p-8 text-center text-[#827d73]">
                왼쪽 목록에서 검토할 개념 초안을 선택해 주세요.
              </div>
            )}
          </div>
        )}

        {/* Bottom Footer */}
        <div className="bg-[#f5f2eb] px-5 py-3 border-t border-[#ded6c8] flex items-center justify-between text-xs font-academic-mono text-[#57544e]">
          <span>
            REDCALL AI 개념 추출 파이프라인 • 총 {subjectDrafts.length}개 초안 중 {approvedCount}개 승인됨
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded text-xs text-[#191817]"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
