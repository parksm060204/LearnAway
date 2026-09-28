'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Material, MaterialPage, Subject } from '../lib/types';
import { loadMaterialContent, saveMaterialContent } from '../lib/materialStorage';
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
  Maximize2,
  Minimize2,
  BookmarkPlus,
  HelpCircle,
} from 'lucide-react';

interface MaterialEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: Material | null;
  subject?: Subject | null;
  onSave: (
    updatedMaterial: Material,
    updatedContent: { markdown: string; pages?: MaterialPage[] }
  ) => void;
}

export function MaterialEditorModal({
  isOpen,
  onClose,
  material,
  subject,
  onSave,
}: MaterialEditorModalProps) {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [markdown, setMarkdown] = useState<string>('');
  const [pages, setPages] = useState<MaterialPage[]>([]);
  const [rawText, setRawText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'edit_only' | 'preview_only'>('split');
  const [activeTabLeft, setActiveTabLeft] = useState<'source' | 'summary'>('source');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load decoupled content when modal opens or material changes
  useEffect(() => {
    if (!isOpen || !material) return;

    let isMounted = true;
    setIsLoading(true);
    setSaveSuccessMsg(null);
    setCurrentPage(1);

    loadMaterialContent(material.id).then((content) => {
      if (!isMounted) return;

      if (content) {
        setMarkdown(content.markdown || material.parsedMarkdown || '');
        setRawText(content.rawText || material.rawText || '');
        setPages(content.pages || material.pages || []);
      } else {
        // Fallback to material object
        setMarkdown(material.parsedMarkdown || '');
        setRawText(material.rawText || '');
        setPages(material.pages || []);
      }
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

  const handleInsertSpeechRef = (blockIndex: number, speaker?: string, timestamp?: string) => {
    const tsStr = timestamp ? `⏱️ **${timestamp}** | ` : '';
    const spkStr = speaker ? `👤 **${speaker}**` : '';
    const snippet = `\n<!-- [발화 #${blockIndex}] -->\n> ${tsStr}${spkStr}\n`;
    insertAtCursor(snippet);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Save heavy content into decoupled storage
      await saveMaterialContent(material.id, {
        markdown,
        rawText,
        pages,
      });

      // 2. Update lightweight material metadata
      const updatedMaterial: Material = {
        ...material,
        parsedMarkdown: markdown,
        lastEditedAt: new Date().toISOString(),
        isConverted: true,
        // If it was failed, allow user manual edit to promote it to needs_review or ready
        status: material.status === 'failed' ? 'needs_review' : material.status,
      };

      onSave(updatedMaterial, { markdown, pages });

      const now = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      setSaveSuccessMsg(`저장 완료 (${now})`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (e: any) {
      alert(`저장 중 오류가 발생했습니다: ${e.message}`);
    } finally {
      setIsSaving(false);
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

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3.5 py-1.5 bg-[#c52828] hover:bg-[#a52020] text-white text-xs font-bold rounded-xs flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '저장 중...' : '변경사항 저장'}</span>
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
