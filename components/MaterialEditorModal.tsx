'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Material, MaterialPage, Subject } from '../lib/types';
import { loadMaterialContentResult, saveMaterialContent } from '../lib/materialStorage';
import { recordMaterialBodyHash } from '../lib/storage';
import { computeMarkdownHash } from '../lib/markdownUtils';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  X,
  Save,
  FileText,
  Mic,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  Columns,
  BookmarkPlus,
  Sparkles,
} from 'lucide-react';

interface MaterialEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: Material | null;
  subject?: Subject | null;
  draftCount?: number;
  isAnalyzing?: boolean;
  onTriggerAnalysis?: (material: Material) => void;
  onOpenConceptReview?: (material: Material) => void;
  /** Returns true only when the update was confirmed by the server. */
  onSave: (
    updatedMaterial: Material,
    updatedContent: { markdown: string; pages?: MaterialPage[] }
  ) => Promise<boolean>;
}

export function MaterialEditorModal({
  isOpen,
  onClose,
  material,
  subject,
  draftCount = 0,
  isAnalyzing = false,
  onTriggerAnalysis,
  onOpenConceptReview,
  onSave,
}: MaterialEditorModalProps) {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [markdown, setMarkdown] = useState<string>('');
  const [pages, setPages] = useState<MaterialPage[]>([]);
  const [rawText, setRawText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'edit_only' | 'preview_only'>('split');
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const initialMarkdownRef = useRef<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load decoupled content when modal opens or material changes.
  useEffect(() => {
    if (!isOpen || !material) return;

    let isMounted = true;

    loadMaterialContentResult(material.id).then((result) => {
      if (!isMounted) return;

      let loadedMarkdown = '';
      if (result.status === 'found') {
        loadedMarkdown = result.content.markdown || material.parsedMarkdown || '';
        setMarkdown(loadedMarkdown);
        setRawText(result.content.rawText || material.rawText || '');
        setPages(result.content.pages || material.pages || []);
      } else if (result.status === 'missing') {
        loadedMarkdown = material.parsedMarkdown || '';
        setMarkdown(loadedMarkdown);
        setRawText(material.rawText || '');
        setPages(material.pages || []);
      } else {
        setLoadError(result.error);
        loadedMarkdown = material.parsedMarkdown || '';
        setMarkdown(loadedMarkdown);
      }
      initialMarkdownRef.current = loadedMarkdown;
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, material]);

  if (!isOpen || !material) return null;

  const totalPages = pages.length > 0 ? pages.length : (material.pageCount || 1);
  const currentPageData = pages.find((p) => p.pageNumber === currentPage);

  // Helper to insert text at textarea cursor
  const insertAtCursor = (insertion: string) => {
    if (!textareaRef.current) {
      setMarkdown((prev) => prev + '\n' + insertion);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const prev = textarea.value;
    const next = prev.substring(0, start) + insertion + prev.substring(end);
    setMarkdown(next);

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
    }, 50);
  };

  const handleInsertPageRef = (pageNumber: number) => {
    const snippet = `\n<!-- [PAGE ${pageNumber}] -->\n## § 제${pageNumber}페이지 원본 참조\n`;
    insertAtCursor(snippet);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccessMsg(null);
    setSaveWarning(null);
    try {
      // 1. Save heavy content into decoupled storage
      const result = await saveMaterialContent(material.id, {
        markdown,
        rawText,
        pages,
      });
      // Record the body identity ONLY after a durable save succeeded; a failed
      // save must not leave a hash that claims a body that is not persisted.
      if (result.persisted) {
        recordMaterialBodyHash(material.id, computeMarkdownHash(markdown), {
          subjectId: material.subjectId,
          kind: material.kind,
        });
      }

      // 2. Update lightweight material metadata (the body identity hash is
      // metadata, not the body itself).
      const updatedMaterial: Material = {
        ...material,
        parsedMarkdown: markdown,
        bodyHash: computeMarkdownHash(markdown),
        lastEditedAt: new Date().toISOString(),
        isConverted: true,
        // If it was failed, allow user manual edit to promote it to needs_review or ready
        status: material.status === 'failed' ? 'needs_review' : material.status,
      };

      const savedToServer = await onSave(updatedMaterial, { markdown, pages });
      if (savedToServer) {
        initialMarkdownRef.current = markdown;
      }

      const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      if (!savedToServer) {
        // Do not claim success when the server did not confirm the save.
        setSaveWarning('서버에 저장하지 못했습니다. 다시 시도해 주세요. (로컬 캐시는 갱신되었습니다.)');
      } else if (result.persisted) {
        setSaveSuccessMsg(`저장 완료 (${now})`);
      } else {
        // Do not claim a durable save when only the in-memory cache holds the content.
        setSaveWarning(
          `서버 저장은 완료됐지만 브라우저 캐시에는 메모리로만 보관되었습니다. (${result.error})`
        );
      }
    } catch (e) {
      alert(`저장 중 오류가 발생했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAttemptClose = () => {
    if (initialMarkdownRef.current !== null && markdown !== initialMarkdownRef.current) {
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-6xl h-[94vh] bg-white border border-[#c8c2b5] rounded-xs shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0">
              {material.kind === 'pdf' ? (
                <FileText className="w-4 h-4 text-[#c52828]" />
              ) : material.kind === 'transcript' ? (
                <Mic className="w-4 h-4 text-amber-500" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              )}
              <span className="font-academic-serif font-bold text-sm truncate max-w-md">
                {material.title}
              </span>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-academic-mono">
              {material.isDemo ? (
                <span className="bg-[#33302b] text-[#ded6c8] px-2 py-0.5 rounded">데모 자료</span>
              ) : (
                <span className="bg-indigo-950 text-indigo-200 border border-indigo-700/50 px-2 py-0.5 rounded">
                  사용자 등록 자료
                </span>
              )}

              {material.status === 'ready' ? (
                <span className="bg-emerald-950 text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> 변환 완료
                </span>
              ) : material.status === 'needs_review' ? (
                <span className="bg-amber-950 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> 원본 확인 필요
                </span>
              ) : material.status === 'failed' ? (
                <span className="bg-red-950 text-red-300 border border-red-700/50 px-2 py-0.5 rounded flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> 변환 실패
                </span>
              ) : (
                <span className="bg-blue-950 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded">
                  변환 중...
                </span>
              )}

              {material.hasAiConcepts ? (
                <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                  개념 연계 완료
                </span>
              ) : (
                <span className="bg-[#292524] text-[#a8a29e] px-2 py-0.5 rounded">
                  AI 개념 미추출 (다음 단계)
                </span>
              )}
            </div>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2">
            {saveSuccessMsg && (
              <span className="text-emerald-400 text-xs font-academic-mono animate-fade-in flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {saveSuccessMsg}
              </span>
            )}

            {saveWarning && (
              <span className="text-amber-400 text-[11px] font-academic-mono animate-fade-in flex items-center gap-1 max-w-[280px] text-right">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {saveWarning}
              </span>
            )}

            {onTriggerAnalysis && (
              <button
                onClick={() => onTriggerAnalysis(material)}
                disabled={isAnalyzing || !markdown.trim()}
                className="px-3 py-1.5 bg-[#33302b] hover:bg-[#44403a] text-white text-xs font-academic-mono rounded-xs flex items-center gap-1.5 transition-colors disabled:opacity-40"
                title="현재 저장된 Markdown으로 AI 개념 분석 실행"
              >
                <Sparkles className={`w-3.5 h-3.5 text-[#c52828] ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? '분석 중...' : 'AI 개념 분석'}</span>
              </button>
            )}

            {onOpenConceptReview && draftCount > 0 && (
              <button
                onClick={() => onOpenConceptReview(material)}
                className="px-3 py-1.5 bg-indigo-900/80 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/50 text-xs font-academic-mono rounded-xs flex items-center gap-1.5 transition-colors"
                title="추출된 개념 초안 검토 모달 열기"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>개념 초안 ({draftCount}건)</span>
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-[#c52828] hover:bg-[#a52020] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '저장 중...' : '변경사항 저장'}</span>
            </button>

            <button
              onClick={handleAttemptClose}
              className="p-1.5 text-[#ded6c8] hover:text-white hover:bg-white/10 rounded"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Unsaved Changes Confirmation Modal */}
        {showUnsavedDialog && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-md bg-white border border-[#c8c2b5] rounded-xs shadow-2xl p-5 space-y-4 font-sans text-xs">
              <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>저장되지 않은 본문 수정 내용이 있습니다</span>
              </div>
              <p className="text-[#57544e] leading-relaxed">
                작성 중인 본문 내용이 아직 서버에 영구 저장되지 않았습니다. 어떻게 처리할지 선택해 주세요.
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    await handleSave();
                    setShowUnsavedDialog(false);
                    onClose();
                  }}
                  className="w-full py-2 px-3 bg-[#c52828] hover:bg-[#a81f1f] text-white font-bold rounded-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>저장하고 닫기</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnsavedDialog(false);
                    onClose();
                  }}
                  className="w-full py-2 px-3 bg-[#191817] hover:bg-[#33302b] text-white font-semibold rounded-xs transition-colors"
                >
                  <span>임시 보존하고 닫기 (로컬 입력 유지)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMarkdown(initialMarkdownRef.current || '');
                    setShowUnsavedDialog(false);
                    onClose();
                  }}
                  className="w-full py-2 px-3 bg-[#faf8f4] hover:bg-[#f1ede4] border border-[#ded6c8] text-[#57544e] rounded-xs transition-colors"
                >
                  <span>변경 취소 (원래 본문으로 되돌리기)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border-b border-red-200 px-5 py-2 text-xs text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              저장된 본문을 읽지 못했습니다(본문 없음과는 다른 상태입니다). 아래 내용을 저장하면 복구를 시도합니다. ({loadError})
            </span>
          </div>
        )}

        {/* Sub-header / View Mode Controls */}
        <div className="bg-[#faf8f4] border-b border-[#ded6c8] px-5 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="font-academic-mono text-[11px] text-[#57544e]">
              연결 과목: <strong>{subject ? subject.name : '과목 미지정'}</strong>
            </span>
            <span className="text-[#c8c2b5]">|</span>
            <span className="font-academic-mono text-[11px] text-[#57544e]">
              출처: <strong>{material.sourceRefs}</strong>
            </span>
            {material.lastEditedAt && (
              <>
                <span className="text-[#c8c2b5]">|</span>
                <span className="font-academic-mono text-[11px] text-[#827d73]">
                  최종 저장:{' '}
                  {new Date(material.lastEditedAt).toLocaleString('ko-KR', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center border border-[#ded6c8] rounded bg-white overflow-hidden text-[11px]">
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
                viewMode === 'split'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#faf8f4]'
              }`}
            >
              <Columns className="w-3 h-3" />
              <span>원문 대조 분할</span>
            </button>
            <button
              onClick={() => setViewMode('edit_only')}
              className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
                viewMode === 'edit_only'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#faf8f4]'
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>편집기 전체</span>
            </button>
            <button
              onClick={() => setViewMode('preview_only')}
              className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
                viewMode === 'preview_only'
                  ? 'bg-[#191817] text-white font-bold'
                  : 'text-[#57544e] hover:bg-[#faf8f4]'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>미리보기</span>
            </button>
          </div>
        </div>

        {/* Main Body */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-[#57544e]">
            <div className="w-6 h-6 border-2 border-[#c52828] border-t-transparent rounded-full animate-spin" />
            <span>학습 자료 원문 및 Markdown 내용을 불러오는 중입니다...</span>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* LEFT PANE: Original Source Viewer (PDF Page or Transcript) */}
            {(viewMode === 'split' || viewMode === 'edit_only' === false) && viewMode !== 'preview_only' && (
              <div className="w-1/2 border-r border-[#ded6c8] bg-[#fdfcfb] flex flex-col overflow-hidden">
                {/* Left Pane Navigation Header */}
                <div className="bg-[#f5f2eb] px-4 py-2 border-b border-[#ded6c8] flex items-center justify-between text-xs">
                  {material.kind === 'pdf' ? (
                    <div className="flex items-center gap-2 w-full justify-between">
                      <div className="flex items-center gap-1">
                        <span className="font-academic-mono text-[11px] font-bold text-[#191817]">
                          PDF 원본 페이지:
                        </span>
                        <button
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage <= 1}
                          className="p-1 hover:bg-[#e8e4dc] rounded disabled:opacity-30"
                          title="이전 페이지"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="font-academic-mono font-bold text-[11px] px-2 py-0.5 bg-white border border-[#ded6c8] rounded">
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                          disabled={currentPage >= totalPages}
                          className="p-1 hover:bg-[#e8e4dc] rounded disabled:opacity-30"
                          title="다음 페이지"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      <button
                        onClick={() => handleInsertPageRef(currentPage)}
                        className="px-2 py-1 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-[#c52828] hover:border-[#c52828] rounded font-academic-mono text-[11px] font-semibold flex items-center gap-1 transition-colors"
                        title="Markdown에 현재 페이지 출처 앵커 삽입"
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" />
                        <span>§ p.{currentPage} 참조 삽입</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className="font-academic-mono text-[11px] font-bold text-[#191817]">
                          전사본 원문 발화 대조:
                        </span>
                        {material.speakers && material.speakers.length > 0 && (
                          <span className="text-[10px] text-[#57544e] font-academic-mono">
                            화자 {material.speakers.join(', ')}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#827d73] font-academic-mono">
                        (원문 보존 상태)
                      </span>
                    </div>
                  )}
                </div>

                {/* Left Pane Content Body */}
                <div className="flex-1 p-4 overflow-y-auto font-academic-mono text-xs leading-relaxed text-[#2e2c29]">
                  {material.kind === 'pdf' ? (
                    <div>
                      {currentPageData ? (
                        <div>
                          {!currentPageData.hasText && (
                            <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 text-xs">
                              <div className="flex items-center gap-1.5 font-bold mb-1">
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                                <span>이 페이지에서는 텍스트를 감지하지 못했습니다.</span>
                              </div>
                              <p className="text-[11px] leading-relaxed">
                                도표, 수식 이미지, 또는 스캔 기반 페이지일 수 있습니다. 원본 PDF를 확인하거나 오른쪽 편집기에서 수동으로 내용을 보완해 주세요.
                              </p>
                            </div>
                          )}

                          <div className="p-4 bg-white border border-[#ded6c8] rounded shadow-2xs font-academic-mono whitespace-pre-wrap select-text">
                            {currentPageData.markdown || currentPageData.rawText || (
                              <span className="text-[#827d73] italic">
                                [제{currentPage}페이지에 추출된 텍스트가 없습니다]
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 bg-white border border-[#ded6c8] rounded font-academic-mono whitespace-pre-wrap select-text">
                          {rawText || (
                            <div className="text-[#827d73] italic">
                              페이지별 분할 정보가 저장되지 않았습니다. 전체 추출 텍스트를 표시합니다:
                              <div className="mt-3 pt-3 border-t border-[#ded6c8] font-sans text-xs">
                                {markdown}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Transcript Viewer */
                    <div className="space-y-3 font-sans">
                      <div className="p-3 bg-amber-50/50 border border-amber-200/60 rounded text-[11px] text-amber-900 leading-relaxed">
                        전사본의 원문 텍스트입니다. 원하는 발화 블록의 [참조 삽입]을 클릭하면 오른쪽 Markdown 편집기에 출처 앵커가 삽입됩니다.
                      </div>

                      <div className="p-4 bg-white border border-[#ded6c8] rounded whitespace-pre-wrap font-academic-mono text-xs select-text">
                        {rawText || markdown}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* RIGHT PANE: Markdown Editor & Live Preview */}
            <div
              className={`${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              } flex flex-col bg-white overflow-hidden`}
            >
              {/* Editor Toolbar */}
              <div className="bg-[#faf8f4] border-b border-[#ded6c8] px-4 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    onClick={() => insertAtCursor('## ')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded font-bold"
                    title="제목 (H2)"
                  >
                    H2
                  </button>
                  <button
                    onClick={() => insertAtCursor('### ')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded font-bold"
                    title="소제목 (H3)"
                  >
                    H3
                  </button>
                  <button
                    onClick={() => insertAtCursor('**강조**')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded font-bold"
                    title="굵게"
                  >
                    B
                  </button>
                  <button
                    onClick={() => insertAtCursor('*기울임*')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded italic"
                    title="기울임"
                  >
                    I
                  </button>
                  <button
                    onClick={() => insertAtCursor('$수식$')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded text-[#c52828] font-mono font-bold"
                    title="인라인 수식 ($...$)"
                  >
                    $f(x)$
                  </button>
                  <button
                    onClick={() => insertAtCursor('\n$$\nE[Y|X=x] = \\int y f(y|x) dy\n$$\n')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded text-[#c52828] font-mono font-bold"
                    title="블록 수식 ($$...$$)"
                  >
                    $$
                  </button>
                  <button
                    onClick={() => insertAtCursor('\n> 인용구 또는 핵심 요약\n')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded"
                    title="인용 블록"
                  >
                    &gt; 인용
                  </button>
                  <button
                    onClick={() => insertAtCursor('\n- 항목 1\n- 항목 2\n')}
                    className="px-2 py-0.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded"
                    title="목록"
                  >
                    • 목록
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#827d73] font-academic-mono">
                    KaTeX 수식 & Markdown 지원
                  </span>
                </div>
              </div>

              {/* Editor / Preview Area */}
              <div className="flex-1 flex overflow-hidden">
                {viewMode !== 'preview_only' && (
                  <div
                    className={`${
                      viewMode === 'split' ? 'w-1/2' : 'w-full'
                    } h-full border-r border-[#ded6c8] p-3 flex flex-col bg-[#fdfcfb]`}
                  >
                    <div className="text-[10px] font-academic-mono text-[#827d73] mb-1 font-semibold">
                      Markdown 소스 코드 입력:
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={markdown}
                      onChange={(e) => setMarkdown(e.target.value)}
                      placeholder="# 제목을 입력하고 본문 마크다운을 작성하세요..."
                      className="flex-1 w-full p-3 font-academic-mono text-xs leading-relaxed border border-[#ded6c8] rounded bg-white text-[#191817] resize-none focus:outline-none focus:border-[#c52828]"
                      spellCheck={false}
                    />
                  </div>
                )}

                {/* Live Preview Column */}
                <div
                  className={`${
                    viewMode === 'preview_only'
                      ? 'w-full'
                      : viewMode === 'split'
                      ? 'w-1/2'
                      : 'hidden'
                  } h-full p-4 overflow-y-auto bg-white`}
                >
                  <div className="text-[10px] font-academic-mono text-[#827d73] mb-2 font-semibold pb-1 border-b border-[#f1ede4]">
                    실시간 렌더링 미리보기 (출처 앵커 & 수식 검증):
                  </div>
                  <MarkdownRenderer
                    content={markdown}
                    onPageClick={(p) => setCurrentPage(p)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Footer */}
        <div className="bg-[#f5f2eb] px-5 py-2.5 border-t border-[#ded6c8] flex items-center justify-between text-xs font-academic-mono text-[#57544e]">
          <div className="flex items-center gap-2">
            <span>자료 ID: {material.id}</span>
            <span>•</span>
            <span>글자 수: {markdown.length}자</span>
            {material.kind === 'pdf' && (
              <>
                <span>•</span>
                <span>총 {totalPages}페이지 구조화 완료</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] rounded text-xs text-[#191817]"
            >
              닫기
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white rounded text-xs font-bold flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '저장 중...' : '저장하기'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
