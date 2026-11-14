'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Material, Subject, ConceptDraft } from '../lib/types';
import { listMaterialContentIds, listMaterialOriginalIds } from '../lib/materialStorage';
import { getMaterialSyncState, isMaterialSaveFailed } from '../lib/storage';
import { deriveMaterialStorageState } from '../lib/materialPolicy';
import {
  FolderOpen,
  Plus,
  Search,
  FileText,
  Mic,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Edit3,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  SectionCard,
  WorkspaceHeader,
} from './ui/WorkspacePrimitives';

export interface MaterialsWorkspaceProps {
  activeSubject?: Subject | null;
  materials: Material[];
  drafts?: ConceptDraft[];
  onOpenUpload: () => void;
  onOpenAddSubject?: () => void;
  onSelectMaterial: (material: Material) => void;
  onDeleteMaterial?: (materialId: string) => Promise<void>;
  hasOriginal?: (materialId: string) => boolean;
  onOpenOriginal?: (materialId: string) => void;
  onOpenConceptReview?: (material?: Material) => void;
  onTriggerAnalysis?: (material: Material) => void;
  isAnalyzing?: boolean;
  onReconnectFile?: (material: Material, kind: 'original' | 'body', file: File) => Promise<boolean>;
}

export function MaterialsWorkspace({
  activeSubject,
  materials,
  drafts = [],
  onOpenUpload,
  onOpenAddSubject,
  onSelectMaterial,
  onDeleteMaterial,
  hasOriginal,
  onOpenOriginal,
  onOpenConceptReview,
  onTriggerAnalysis,
  isAnalyzing = false,
  onReconnectFile,
}: MaterialsWorkspaceProps) {
  const [filterKind, setFilterKind] = useState<'all' | 'pdf' | 'transcript' | 'user' | 'demo'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bodyIds, setBodyIds] = useState<Set<string>>(new Set());
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());
  const [reconnectTarget, setReconnectTarget] = useState<{ id: string; kind: 'original' | 'body' } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshPresence = useCallback(async () => {
    try {
      const [bodies, originals] = await Promise.all([listMaterialContentIds(), listMaterialOriginalIds()]);
      setBodyIds(new Set(bodies ?? []));
      setOriginalIds(new Set(originals ?? []));
    } catch {
      // Graceful fallback if storage presence query fails
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPresence();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [materials, refreshPresence]);

  const startReconnect = (mat: Material, kind: 'original' | 'body') => {
    setReconnectTarget({ id: mat.id, kind });
    if (fileInputRef.current) {
      fileInputRef.current.accept = kind === 'original' ? 'application/pdf,.pdf' : '.md,.markdown,.txt,text/plain';
      fileInputRef.current.click();
    }
  };

  const handleReconnectFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    const target = reconnectTarget;
    setReconnectTarget(null);
    if (!file || !target || !onReconnectFile) return;
    const mat = materials.find((m) => m.id === target.id);
    if (!mat) return;
    const ok = await onReconnectFile(mat, target.kind, file);
    if (ok) await refreshPresence();
  };

  if (!activeSubject) {
    return (
      <EmptyState
        icon={<FolderOpen className="w-5 h-5 stroke-1.5 text-[#827d73]" />}
        title="선택된 과목이 없습니다."
        description="강의 자료를 등록하고 관리하려면 먼저 과목 폴더를 생성하거나 선택해 주세요."
        actions={
          onOpenAddSubject ? (
            <Button variant="primary" size="md" onClick={onOpenAddSubject}>
              <Plus className="w-3.5 h-3.5 text-[#c52828]" />
              <span>새 과목 폴더 추가</span>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const subjectMaterials = materials.filter((m) => m.subjectId === activeSubject.id);

  const filteredMaterials = subjectMaterials.filter((m) => {
    if (filterKind === 'pdf' && m.kind !== 'pdf') return false;
    if (filterKind === 'transcript' && m.kind !== 'transcript') return false;
    if (filterKind === 'user' && m.isDemo) return false;
    if (filterKind === 'demo' && !m.isDemo) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = m.title.toLowerCase().includes(q);
      const matchSource = m.sourceRefs?.toLowerCase().includes(q);
      if (!matchTitle && !matchSource) return false;
    }

    return true;
  });

  const pdfCount = subjectMaterials.filter((m) => m.kind === 'pdf').length;
  const transcriptCount = subjectMaterials.filter((m) => m.kind === 'transcript').length;
  const userCount = subjectMaterials.filter((m) => !m.isDemo).length;
  const demoCount = subjectMaterials.filter((m) => !!m.isDemo).length;
  const pendingDraftsCount = drafts.filter((d) => d.subjectId === activeSubject.id && !d.isApproved).length;

  return (
    <div className="w-full space-y-4">
      {/* Hidden file input for reconnect */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleReconnectFileChange}
      />

      {/* Top Banner / Workspace Header */}
      <WorkspaceHeader
        icon={<FolderOpen className="w-5 h-5" />}
        title={`${activeSubject.name} 학습 자료 관리`}
        subtitle={`총 ${subjectMaterials.length}건 등록됨 · 사용자 자료 ${userCount}건 · 데모 자료 ${demoCount}건`}
        actions={
          <>
            {onOpenConceptReview && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => onOpenConceptReview()}
                title="AI 추출 개념 검토 및 승인"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#c52828]" />
                <span>개념 검토 및 승인</span>
                {pendingDraftsCount > 0 && (
                  <Badge variant="warning" mono>
                    {pendingDraftsCount}
                  </Badge>
                )}
              </Button>
            )}
            <Button variant="primary" size="md" onClick={onOpenUpload}>
              <Plus className="w-3.5 h-3.5 text-[#c52828]" />
              <span>새 자료 등록</span>
            </Button>
          </>
        }
      />

      {/* Filter and Search Bar */}
      <SectionCard padding="sm" className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: 'all' as const, label: `전체 (${subjectMaterials.length})` },
            { id: 'pdf' as const, label: `PDF 교재 (${pdfCount})` },
            { id: 'transcript' as const, label: `녹음 전사본 (${transcriptCount})` },
            { id: 'user' as const, label: `사용자 등록 (${userCount})` },
            { id: 'demo' as const, label: `데모 (${demoCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterKind(tab.id)}
              className={`px-2.5 py-1.5 rounded-xs text-xs whitespace-nowrap transition-colors ${
                filterKind === tab.id
                  ? 'bg-[#191817] text-white font-semibold'
                  : 'text-[#57544e] hover:bg-[#faf8f4] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#827d73] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="자료 제목 또는 출처 검색..."
            aria-label="자료 제목 또는 출처 검색"
            className="pl-8 py-1.5 min-h-[34px]"
          />
        </div>
      </SectionCard>

      {/* Materials List */}
      {filteredMaterials.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-5 h-5 stroke-1.5 text-[#827d73]" />}
          title={searchQuery.trim() ? '검색 조건과 일치하는 학습 자료가 없습니다.' : '등록된 학습 자료가 없습니다.'}
          description={
            searchQuery.trim()
              ? '다른 검색어를 입력하거나 필터를 전체로 변경해 보세요.'
              : `선택한 과목(${activeSubject.name})에 강의 PDF나 녹음 전사본을 등록하여 변환 및 개념 추출을 시작하세요.`
          }
          actions={
            searchQuery.trim() ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setSearchQuery('');
                  setFilterKind('all');
                }}
              >
                검색 초기화
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={onOpenUpload}>
                <Plus className="w-3.5 h-3.5 text-[#c52828]" />
                <span>첫 자료 등록하기</span>
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredMaterials.map((mat) => {
            const matDrafts = drafts.filter((d) => d.materialId === mat.id);
            const approvedDrafts = matDrafts.filter((d) => d.isApproved).length;
            const storageState = deriveMaterialStorageState({
              material: mat,
              hasLocalBody: bodyIds.has(mat.id),
              hasLocalOriginal: originalIds.has(mat.id),
              originalBackedUp: hasOriginal ? hasOriginal(mat.id) : originalIds.has(mat.id),
              // A failed/partial edit save is recorded by the editor, so the
              // list can show the real retry-needed state instead of "synced".
              saveFailed: isMaterialSaveFailed(mat.id),
              // Body sync is claimed ONLY from the server-confirmed record
              // (hash-equal), never from settings or local presence alone.
              syncState: getMaterialSyncState(mat.id),
            });

            const hasOriginalFile = hasOriginal ? hasOriginal(mat.id) : originalIds.has(mat.id);

            return (
              <div
                key={mat.id}
                className="bg-white border border-[#e2ded6] hover:border-[#c8c2b5] rounded-xs p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs group"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Icon & Metadata */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xs bg-[#faf8f4] border border-[#ded6c8] flex items-center justify-center shrink-0 mt-0.5">
                      {mat.kind === 'pdf' ? (
                        <FileText className="w-5 h-5 text-[#c52828]" />
                      ) : mat.kind === 'transcript' ? (
                        <Mic className="w-5 h-5 text-amber-600" />
                      ) : (
                        <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="font-academic-serif font-bold text-sm sm:text-base text-[#191817] group-hover:text-[#c52828] transition-colors">
                          {mat.title}
                        </span>

                        {mat.isDemo ? (
                          <Badge variant="neutral" mono>데모</Badge>
                        ) : (
                          <Badge variant="neutral">사용자 등록</Badge>
                        )}

                        {mat.status === 'ready' ? (
                          <Badge variant="success">
                            <CheckCircle2 className="w-3 h-3" /> 변환 완료
                          </Badge>
                        ) : mat.status === 'needs_review' ? (
                          <Badge variant="warning">
                            <AlertTriangle className="w-3 h-3" /> 원본 확인 필요
                          </Badge>
                        ) : mat.status === 'failed' ? (
                          <Badge variant="danger">
                            <AlertTriangle className="w-3 h-3" /> 변환 실패
                          </Badge>
                        ) : (
                          <Badge variant="info">변환 중...</Badge>
                        )}

                        {matDrafts.length > 0 ? (
                          <Badge variant="warning">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>개념 {matDrafts.length}건 ({approvedDrafts}건 승인)</span>
                          </Badge>
                        ) : mat.hasAiConcepts ? (
                          <Badge variant="neutral">개념 연계됨</Badge>
                        ) : (
                          <Badge variant="warning">AI 개념 미추출</Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#827d73] mb-2">
                        <span>출처: {mat.sourceRefs}</span>
                        {mat.pageCount && <span className="font-academic-mono">· {mat.pageCount}페이지</span>}
                        {mat.durationMinutes && <span className="font-academic-mono">· {mat.durationMinutes}분</span>}
                        {mat.speakers && mat.speakers.length > 0 && (
                          <span>· 화자: {mat.speakers.join(', ')}</span>
                        )}
                        <span className="font-academic-mono">
                          · 등록일:{' '}
                          {new Date(mat.uploadedAt).toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </span>
                      </div>

                      {/* Storage Policy State Badges */}
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {storageState.labels.map((label) => (
                          <Badge
                            key={label}
                            variant={label.includes('재연결 필요') ? 'warning' : 'neutral'}
                          >
                            {label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-wrap items-center gap-2 lg:self-center shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#f1ede4]">
                    {/* Reconnect button if needed */}
                    {storageState.needsLink && (
                      <button
                        type="button"
                        onClick={() => startReconnect(mat, mat.kind === 'pdf' ? 'original' : 'body')}
                        className="px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xs flex items-center gap-1 transition-colors"
                        title="로컬 파일 다시 연결"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-700" />
                        <span>파일 재연결</span>
                      </button>
                    )}

                    {/* PDF Original View Button */}
                    {hasOriginalFile && onOpenOriginal && (
                      <button
                        type="button"
                        onClick={() => onOpenOriginal(mat.id)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-[#57544e] hover:text-[#191817] bg-[#faf8f4] hover:bg-[#f1ede4] border border-[#ded6c8] rounded-xs flex items-center gap-1 transition-colors"
                        title="원본 PDF 열기"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>원본 PDF</span>
                      </button>
                    )}

                    {/* AI Concept Extraction Trigger Button */}
                    {onTriggerAnalysis && !mat.hasAiConcepts && matDrafts.length === 0 && (
                      <button
                        type="button"
                        onClick={() => onTriggerAnalysis(mat)}
                        disabled={isAnalyzing}
                        className="px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xs flex items-center gap-1 transition-colors disabled:opacity-50"
                        title="AI 개념 추출 실행"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>개념 추출</span>
                      </button>
                    )}

                    {/* Edit Body Button */}
                    <button
                      type="button"
                      onClick={() => onSelectMaterial(mat)}
                      className="px-3 py-1.5 text-xs font-bold text-[#191817] bg-[#faf8f4] hover:bg-[#191817] hover:text-white border border-[#ded6c8] rounded-xs flex items-center gap-1.5 transition-colors"
                      title="자료 본문 확인 및 대조 편집"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#c52828]" />
                      <span>본문 보기·편집</span>
                    </button>

                    {/* Delete Material Button */}
                    {onDeleteMaterial && (
                      <div className="relative">
                        {deleteConfirmId === mat.id ? (
                          <div className="flex items-center gap-1 bg-[#fef2f2] border border-[#fecaca] p-1 rounded-xs">
                            <span className="text-[11px] text-[#991b1b] font-medium px-1">삭제?</span>
                            <button
                              type="button"
                              onClick={async () => {
                                setIsDeleting(true);
                                try {
                                  await onDeleteMaterial(mat.id);
                                } finally {
                                  setIsDeleting(false);
                                  setDeleteConfirmId(null);
                                }
                              }}
                              disabled={isDeleting}
                              className="px-2 py-0.5 text-[11px] bg-[#dc2626] text-white rounded-xs font-bold hover:bg-[#b91c1c] disabled:opacity-50"
                            >
                              확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-0.5 text-[11px] text-[#57544e] hover:text-[#191817]"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(mat.id)}
                            className="p-1.5 text-[#827d73] hover:text-[#dc2626] hover:bg-[#fef2f2] rounded-xs transition-colors"
                            title="자료 삭제"
                            aria-label={`${mat.title} 삭제`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
