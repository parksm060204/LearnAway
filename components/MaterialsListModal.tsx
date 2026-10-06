'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Material, Subject } from '../lib/types';
import { listMaterialContentIds, listMaterialOriginalIds } from '../lib/materialStorage';
import { getMaterialSyncState, isMaterialSaveFailed } from '../lib/storage';
import { deriveMaterialStorageState } from '../lib/materialPolicy';
import {
  X,
  Plus,
  FileText,
  Mic,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ExternalLink,
  FolderOpen,
  Sparkles,
} from 'lucide-react';
import { ConceptDraft } from '../lib/types';

interface MaterialsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSubject: Subject;
  materials: Material[];
  drafts?: ConceptDraft[];
  onOpenUpload: () => void;
  onSelectMaterial: (material: Material) => void;
  onDeleteMaterial?: (materialId: string) => void;
  /** True when a private original file exists for the material. */
  hasOriginal?: (materialId: string) => boolean;
  /** Opens the original via a short-lived signed URL. */
  onOpenOriginal?: (materialId: string) => void;
  onOpenConceptReview?: (material: Material) => void;
  onTriggerAnalysis?: (material: Material) => void;
  isAnalyzing?: boolean;
  /** Reconnect a local file (original PDF or converted MD) for a material. */
  onReconnectFile?: (material: Material, kind: 'original' | 'body', file: File) => Promise<boolean>;
}

export function MaterialsListModal({
  isOpen,
  onClose,
  activeSubject,
  materials,
  drafts = [],
  onOpenUpload,
  onSelectMaterial,
  onDeleteMaterial,
  hasOriginal,
  onOpenOriginal,
  onOpenConceptReview,
  onTriggerAnalysis,
  isAnalyzing = false,
  onReconnectFile,
}: MaterialsListModalProps) {
  const [filterKind, setFilterKind] = useState<'all' | 'pdf' | 'transcript' | 'user' | 'demo'>('all');
  const [bodyIds, setBodyIds] = useState<Set<string>>(new Set());
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());
  const [reconnectTarget, setReconnectTarget] = useState<{ id: string; kind: 'original' | 'body' } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshPresence = useCallback(async () => {
    const [bodies, originals] = await Promise.all([listMaterialContentIds(), listMaterialOriginalIds()]);
    setBodyIds(new Set(bodies ?? []));
    setOriginalIds(new Set(originals ?? []));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void refreshPresence();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, materials, refreshPresence]);

  const startReconnect = (mat: Material, kind: 'original' | 'body') => {
    setReconnectTarget({ id: mat.id, kind });
    // Set accept before opening so the picker filters correctly.
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

  if (!isOpen) return null;

  // Filter materials for this subject only
  const subjectMaterials = materials.filter((m) => m.subjectId === activeSubject.id);

  const filteredMaterials = subjectMaterials.filter((m) => {
    if (filterKind === 'pdf') return m.kind === 'pdf';
    if (filterKind === 'transcript') return m.kind === 'transcript';
    if (filterKind === 'user') return !m.isDemo;
    if (filterKind === 'demo') return !!m.isDemo;
    return true;
  });

  const pdfCount = subjectMaterials.filter((m) => m.kind === 'pdf').length;
  const transcriptCount = subjectMaterials.filter((m) => m.kind === 'transcript').length;
  const userCount = subjectMaterials.filter((m) => !m.isDemo).length;
  const demoCount = subjectMaterials.filter((m) => !!m.isDemo).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white border border-[#c8c2b5] rounded-xs shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3.5 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-4 h-4 text-[#c52828]" />
            <div>
              <h2 className="font-academic-serif font-bold text-sm">
                {activeSubject.name} 학습 자료 보관함
              </h2>
              <div className="text-[10px] text-[#ded6c8] font-academic-mono">
                {activeSubject.code} • 총 {subjectMaterials.length}건 등록 (사용자 {userCount}건 / 데모 {demoCount}건)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenUpload}
              className="px-3 py-1.5 bg-[#c52828] hover:bg-[#a52020] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>새 자료 등록</span>
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

        {/* Filter Navigation */}
        <div className="bg-[#faf8f4] border-b border-[#ded6c8] px-5 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterKind('all')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterKind === 'all'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              전체 ({subjectMaterials.length})
            </button>
            <button
              onClick={() => setFilterKind('pdf')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterKind === 'pdf'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              PDF 교재 ({pdfCount})
            </button>
            <button
              onClick={() => setFilterKind('transcript')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterKind === 'transcript'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              녹음 전사본 ({transcriptCount})
            </button>
            <button
              onClick={() => setFilterKind('user')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterKind === 'user'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              사용자 등록 ({userCount})
            </button>
            <button
              onClick={() => setFilterKind('demo')}
              className={`px-3 py-1 rounded font-academic-mono text-[11px] transition-colors ${
                filterKind === 'demo'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#e8e4dc]'
              }`}
            >
              데모 ({demoCount})
            </button>
          </div>
        </div>

        {/* Material List Content */}
        <div className="flex-1 p-5 overflow-y-auto">
          {filteredMaterials.length === 0 ? (
            /* Empty State */
            <div className="py-16 text-center flex flex-col items-center justify-center">
              <div className="w-14 h-14 bg-[#faf8f4] border border-[#ded6c8] rounded-full flex items-center justify-center text-[#827d73] mb-3">
                <FolderOpen className="w-6 h-6 stroke-1" />
              </div>
              <h3 className="font-academic-serif font-bold text-sm text-[#191817] mb-1">
                등록된 학습 자료가 없습니다.
              </h3>
              <p className="text-xs text-[#57544e] max-w-sm mb-4 leading-relaxed">
                선택한 과목(<strong>{activeSubject.name}</strong>)에 강의 PDF나 녹음 전사본을 등록하여 PyMuPDF4LLM 변환 및 대조 편집을 시작하세요.
              </p>
              <button
                onClick={onOpenUpload}
                className="px-4 py-2 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>자료 등록하기</span>
              </button>
            </div>
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
                  saveFailed: isMaterialSaveFailed(mat.id),
                  syncState: getMaterialSyncState(mat.id),
                });

                return (
                  <div
                    key={mat.id}
                    className="p-4 bg-[#faf8f4] hover:bg-white border border-[#ded6c8] hover:border-[#191817] rounded-xs transition-all shadow-2xs group flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    {/* Left Column: Icon & Meta */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded bg-white border border-[#ded6c8] flex items-center justify-center shrink-0 mt-0.5">
                        {mat.kind === 'pdf' ? (
                          <FileText className="w-5 h-5 text-[#c52828]" />
                        ) : mat.kind === 'transcript' ? (
                          <Mic className="w-5 h-5 text-amber-600" />
                        ) : (
                          <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-academic-serif font-bold text-sm text-[#191817] group-hover:text-[#c52828] transition-colors truncate">
                            {mat.title}
                          </span>

                          {/* Origin Badge */}
                          {mat.isDemo ? (
                            <span className="text-[10px] font-academic-mono bg-[#e8e4dc] text-[#57544e] px-1.5 py-0.5 rounded">
                              데모
                            </span>
                          ) : (
                            <span className="text-[10px] font-academic-mono bg-indigo-100 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold">
                              사용자 등록
                            </span>
                          )}

                          {/* Status Badge */}
                          {mat.status === 'ready' ? (
                            <span className="text-[10px] font-academic-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3" /> 변환 완료
                            </span>
                          ) : mat.status === 'needs_review' ? (
                            <span className="text-[10px] font-academic-mono bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                              <AlertTriangle className="w-3 h-3 text-amber-600" /> 원본 확인 필요
                            </span>
                          ) : mat.status === 'failed' ? (
                            <span className="text-[10px] font-academic-mono bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                              <AlertTriangle className="w-3 h-3" /> 변환 실패
                            </span>
                          ) : (
                            <span className="text-[10px] font-academic-mono bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                              변환 중...
                            </span>
                          )}

                          {/* AI Extraction State Badge */}
                          {matDrafts.length > 0 ? (
                            <span className="text-[10px] font-academic-mono bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-indigo-600" />
                              <span>개념 {matDrafts.length}건 ({approvedDrafts}건 승인)</span>
                            </span>
                          ) : mat.hasAiConcepts ? (
                            <span className="text-[10px] font-academic-mono text-[#57544e] bg-white border border-[#ded6c8] px-1.5 py-0.5 rounded">
                              개념 연계됨
                            </span>
                          ) : (
                            <span className="text-[10px] font-academic-mono text-amber-800 bg-amber-50/80 border border-amber-200 px-1.5 py-0.5 rounded">
                              AI 개념 미추출
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-academic-mono text-[#827d73]">
                          <span>출처: {mat.sourceRefs}</span>
                          {mat.pageCount && <span>• {mat.pageCount}페이지</span>}
                          {mat.durationMinutes && <span>• {mat.durationMinutes}분</span>}
                          {mat.speakers && mat.speakers.length > 0 && (
                            <span>• 화자: {mat.speakers.join(', ')}</span>
                          )}
                          <span>
                            • 등록일:{' '}
                            {new Date(mat.uploadedAt).toLocaleDateString('ko-KR', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                            })}
                          </span>
                        </div>

                        {storageState.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {storageState.labels.map((label) => (
                              <span
                                key={label}
                                className="text-[10px] font-academic-mono text-[#57544e] bg-white border border-[#ded6c8] px-1.5 py-0.5 rounded"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {/* Concept Review / AI Analysis Button */}
                      {matDrafts.length > 0 ? (
                        <button
                          onClick={() => onOpenConceptReview && onOpenConceptReview(mat)}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 text-xs font-bold rounded-xs flex items-center gap-1 transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          <span>개념 초안 ({matDrafts.length}건)</span>
                        </button>
                      ) : mat.isConverted ? (
                        <button
                          onClick={() => onTriggerAnalysis && onTriggerAnalysis(mat)}
                          disabled={isAnalyzing}
                          className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] text-[#191817] text-xs font-semibold rounded-xs flex items-center gap-1 transition-colors disabled:opacity-50"
                          title="저장된 최신 Markdown으로 AI 개념 분석 실행"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#c52828]" />
                          <span>{isAnalyzing ? '분석 중...' : 'AI 개념 분석'}</span>
                        </button>
                      ) : (
                        <button
                          disabled
                          className="px-2.5 py-1.5 bg-[#f5f2eb] border border-[#ded6c8] text-[#a8a29e] text-xs rounded-xs flex items-center gap-1 cursor-not-allowed"
                          title="먼저 Markdown을 검토하고 저장한 후에 분석할 수 있습니다."
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#a8a29e]" />
                          <span>AI 분석 (저장 필요)</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          onSelectMaterial(mat);
                        }}
                        className="px-3 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white text-xs font-bold rounded-xs flex items-center gap-1 transition-colors shadow-2xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>원문 대조 및 편집</span>
                      </button>

                      {onOpenOriginal && hasOriginal?.(mat.id) && (
                        <button
                          onClick={() => onOpenOriginal(mat.id)}
                          className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] text-[#191817] text-xs font-semibold rounded-xs flex items-center gap-1 transition-colors"
                          title="인증된 원본 파일 보기 (signed URL)"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#827d73]" />
                          <span>원본 보기</span>
                        </button>
                      )}

                      {onReconnectFile && !mat.isDemo && mat.kind === 'pdf' && !originalIds.has(mat.id) && !hasOriginal?.(mat.id) && (
                        <button
                          onClick={() => startReconnect(mat, 'original')}
                          className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] text-[#191817] text-xs font-semibold rounded-xs flex items-center gap-1 transition-colors"
                          title="이 기기에 PDF 원본 파일을 다시 연결합니다 (서버에 업로드하지 않음)"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#827d73]" />
                          <span>원본 다시 연결</span>
                        </button>
                      )}

                      {onReconnectFile && !mat.isDemo && !bodyIds.has(mat.id) && !mat.parsedMarkdown && (
                        <button
                          onClick={() => startReconnect(mat, 'body')}
                          className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#c8c2b5] text-[#191817] text-xs font-semibold rounded-xs flex items-center gap-1 transition-colors"
                          title="이 기기에 변환된 Markdown 본문을 다시 연결합니다 (서버에 업로드하지 않음)"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#827d73]" />
                          <span>본문 다시 연결</span>
                        </button>
                      )}

                      {!mat.isDemo && onDeleteMaterial && (
                        deleteConfirmId === mat.id ? (
                          <div className="flex items-center gap-1 bg-red-50 p-1 rounded-xs border border-red-200">
                            <span className="text-[10px] text-red-700 font-bold">삭제할까요?</span>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteConfirmId(null);
                                onDeleteMaterial(mat.id);
                              }}
                              className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-700 text-white font-bold rounded-xs transition-colors"
                              title="삭제 확정"
                            >
                              삭제
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-200 rounded-xs transition-colors"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(mat.id)}
                            className="p-1.5 text-[#827d73] hover:text-[#c52828] hover:bg-red-50 rounded-xs transition-colors"
                            title="자료 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#f5f2eb] px-5 py-3 border-t border-[#ded6c8] flex items-center justify-between text-xs font-academic-mono text-[#57544e]">
          <span>Learn my way 과목별 자료 저장소 • PyMuPDF4LLM 파이프라인 연계</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded text-xs text-[#191817]"
          >
            닫기
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleReconnectFileChange}
      />
    </div>
  );
}
