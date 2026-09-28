'use client';

import React, { useState, useRef } from 'react';
import { Material, MaterialKind, MaterialPage, Subject } from '../lib/types';
import { parseTranscript } from '../lib/transcriptParser';
import { saveMaterialContent } from '../lib/materialStorage';
import {
  X,
  Upload,
  FileText,
  Mic,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Info,
  Loader2,
  ArrowRight,
  FileUp,
  ClipboardPaste,
} from 'lucide-react';

interface MaterialUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  activeSubject: Subject;
  onAddMaterial: (material: Material) => void;
  onOpenEditor?: (material: Material) => void;
}

export function MaterialUploadModal({
  isOpen,
  onClose,
  subjects,
  activeSubject,
  onAddMaterial,
  onOpenEditor,
}: MaterialUploadModalProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(activeSubject.id);
  const [kind, setKind] = useState<MaterialKind>('pdf');
  const [title, setTitle] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');

  // PDF conversion state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [pdfConvertStatus, setPdfConvertStatus] = useState<
    'idle' | 'converting' | 'success' | 'needs_review' | 'error'
  >('idle');
  const [pdfConvertMessage, setPdfConvertMessage] = useState<string>('');
  const [pdfPages, setPdfPages] = useState<MaterialPage[]>([]);
  const [pdfFullMarkdown, setPdfFullMarkdown] = useState<string>('');
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);

  // Transcript state
  const [transcriptInputMode, setTranscriptInputMode] = useState<'file' | 'paste'>('file');
  const [transcriptRawText, setTranscriptRawText] = useState('');
  const [transcriptFileName, setTranscriptFileName] = useState('');
  const [transcriptSpeakers, setTranscriptSpeakers] = useState<string[]>([]);
  const [transcriptHasTimestamps, setTranscriptHasTimestamps] = useState(false);
  const [transcriptParsedMarkdown, setTranscriptParsedMarkdown] = useState('');

  const [activeTab, setActiveTab] = useState<'upload' | 'preview'>('upload');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Handle PDF file selection
  const handlePdfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일(.pdf)만 선택해 주세요.');
      return;
    }

    setPdfFile(file);
    if (!title.trim()) {
      setTitle(file.name);
    }

    // Auto-trigger PyMuPDF4LLM conversion
    await runPdfConversion(file);
  };

  const runPdfConversion = async (file: File) => {
    setIsConvertingPdf(true);
    setPdfConvertStatus('converting');
    setPdfConvertMessage('PyMuPDF4LLM 변환 파이프라인 구동 중...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.hasText === false && data.pageCount > 0) {
          // Image-only PDF or zero extractable text
          setPdfConvertStatus('needs_review');
          setPdfConvertMessage(
            data.error ||
              '이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다. 원본 확인이 필요합니다.'
          );
          setPdfPages(data.pages || []);
          setPageCount(data.pageCount || 1);
        } else {
          setPdfConvertStatus('error');
          setPdfConvertMessage(data.error || 'PDF 변환 처리 중 오류가 발생했습니다.');
        }
        return;
      }

      // Success
      setPdfConvertStatus('success');
      setPdfConvertMessage(
        `PyMuPDF4LLM 변환 완료: 총 ${data.pageCount}페이지 구조화 성공`
      );
      setPdfPages(data.pages || []);
      setPdfFullMarkdown(data.fullMarkdown || '');
      setPageCount(data.pageCount);

      if (!sourceRefs.trim()) {
        setSourceRefs(`제1페이지 ~ 제${data.pageCount}페이지`);
      }
    } catch (err: any) {
      setPdfConvertStatus('error');
      setPdfConvertMessage(`변환 요청 실패: ${err.message}`);
    } finally {
      setIsConvertingPdf(false);
    }
  };

  // Handle Transcript file selection (.txt or .md)
  const handleTranscriptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.md')) {
      alert('전사본 파일은 .txt 또는 .md 형식만 지원합니다.');
      return;
    }

    setTranscriptFileName(file.name);
    if (!title.trim()) {
      setTitle(file.name);
    }

    const text = await file.text();
    processTranscriptText(text, file.name);
  };

  const processTranscriptText = (text: string, defaultTitle: string) => {
    setTranscriptRawText(text);
    const parsed = parseTranscript(text, defaultTitle || title || '강의 전사본');
    setTranscriptSpeakers(parsed.speakers);
    setTranscriptHasTimestamps(parsed.hasTimestamps);
    setTranscriptParsedMarkdown(parsed.markdown);

    if (!sourceRefs.trim()) {
      setSourceRefs(
        parsed.hasTimestamps
          ? '타임스탬프 전사본'
          : `전사본 (${parsed.blocks.length}개 발화 블록)`
      );
    }
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    processTranscriptText(text, title || '강의 직접 입력 전사본');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('자료 제목을 입력해 주세요.');
      return;
    }

    let status: 'ready' | 'needs_review' | 'failed' = 'ready';
    let statusMsg: string | undefined = undefined;
    let finalMarkdown = '';
    let finalRawText = '';

    if (kind === 'pdf') {
      if (pdfConvertStatus === 'error') {
        status = 'failed';
        statusMsg = pdfConvertMessage;
      } else if (pdfConvertStatus === 'needs_review') {
        status = 'needs_review';
        statusMsg = pdfConvertMessage;
      } else if (pdfConvertStatus === 'success') {
        status = 'ready';
        statusMsg = 'PyMuPDF4LLM 변환 완료';
      } else {
        // If user submitted without file
        status = 'needs_review';
        statusMsg = 'PDF 원본 파일이 첨부되지 않았습니다.';
      }
      finalMarkdown = pdfFullMarkdown;
    } else {
      // Transcript
      if (!transcriptRawText.trim()) {
        alert('전사본 텍스트를 입력하거나 파일을 선택해 주세요.');
        return;
      }
      finalMarkdown = transcriptParsedMarkdown;
      finalRawText = transcriptRawText;
      status = 'ready';
    }

    const newMaterial: Material = {
      id: `mat-${Date.now()}`,
      subjectId: selectedSubjectId,
      kind,
      title: title.trim(),
      sourceRefs: sourceRefs.trim() || (kind === 'pdf' ? `p.1 ~ p.${pageCount || 1}` : '전사본'),
      pageCount: kind === 'pdf' ? pageCount || 1 : undefined,
      parsedMarkdown: finalMarkdown || undefined,
      rawText: finalRawText || undefined,
      pages: kind === 'pdf' && pdfPages.length > 0 ? pdfPages : undefined,
      status,
      statusMessage: statusMsg,
      isConverted: status === 'ready',
      isDemo: false, // User uploaded material
      uploadedAt: new Date().toISOString(),
      speakerCount: transcriptSpeakers.length > 0 ? transcriptSpeakers.length : undefined,
      speakers: transcriptSpeakers.length > 0 ? transcriptSpeakers : undefined,
      hasAiConcepts: false, // Transparent: AI concept extraction deferred to next stage
      hasAiProblems: false,
    };

    // 1. Save heavy content to decoupled storage
    await saveMaterialContent(newMaterial.id, {
      markdown: finalMarkdown,
      rawText: finalRawText,
      pages: kind === 'pdf' ? pdfPages : undefined,
    });

    // 2. Add material metadata
    onAddMaterial(newMaterial);
    onClose();

    // 3. Option to immediately open editor
    if (onOpenEditor) {
      onOpenEditor(newMaterial);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3.5 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">
              학습 교재 및 전사본 실제 자료 등록
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans overflow-y-auto">
          {/* Subject selector */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
              등록 대상 과목:
            </label>
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817] font-medium"
            >
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name} ({sub.code})
                </option>
              ))}
            </select>
          </div>

          {/* Material Kind */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
              자료 종류 선택:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('pdf')}
                className={`p-3 rounded-xs border flex items-center justify-center gap-2 text-xs font-medium transition-all ${
                  kind === 'pdf'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>PDF 강의 교재 (PyMuPDF4LLM)</span>
              </button>

              <button
                type="button"
                onClick={() => setKind('transcript')}
                className={`p-3 rounded-xs border flex items-center justify-center gap-2 text-xs font-medium transition-all ${
                  kind === 'transcript'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span>녹음 전사본 (.txt / .md / 직접입력)</span>
              </button>
            </div>
          </div>

          {/* CONDITIONAL BODY: PDF vs Transcript */}
          {kind === 'pdf' ? (
            /* PDF Upload & Conversion Section */
            <div className="space-y-3 p-4 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
              <div className="flex items-center justify-between">
                <span className="font-academic-mono text-[11px] font-bold text-[#191817] flex items-center gap-1.5">
                  <FileUp className="w-4 h-4 text-[#c52828]" />
                  실제 PDF 파일 선택 및 PyMuPDF4LLM 변환
                </span>
                <span className="text-[10px] text-[#827d73] font-academic-mono">.pdf 파일 전용</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handlePdfFileChange}
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#c8c2b5] hover:border-[#c52828] rounded-xs p-5 text-center cursor-pointer bg-white transition-colors flex flex-col items-center justify-center gap-1"
              >
                <Upload className="w-6 h-6 text-[#827d73]" />
                <span className="font-semibold text-xs text-[#191817]">
                  {pdfFile ? pdfFile.name : '클릭하여 PDF 파일 선택 또는 여기로 드래그'}
                </span>
                <span className="text-[10px] text-[#827d73]">
                  {pdfFile
                    ? `${(pdfFile.size / 1024 / 1024).toFixed(2)} MB • 다른 파일 선택하려면 클릭`
                    : 'PyMuPDF4LLM 엔진이 페이지별 Markdown과 수식을 보존하며 변환합니다.'}
                </span>
              </div>

              {/* Conversion State Indicators */}
              {isConvertingPdf && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-blue-900 text-xs flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>PyMuPDF4LLM으로 PDF 페이지를 분석하고 Markdown을 추출하는 중입니다...</span>
                </div>
              )}

              {pdfConvertStatus === 'success' && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-emerald-900 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <div>
                    <span className="font-bold">{pdfConvertMessage}</span>
                    <div className="text-[11px] text-emerald-800 mt-0.5">
                      변환된 Markdown과 페이지 원본 대조가 등록 후 편집 화면에 바로 연결됩니다.
                    </div>
                  </div>
                </div>
              )}

              {pdfConvertStatus === 'needs_review' && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">⚠️ 원본 확인 필요 (스캔/이미지 기반 PDF)</span>
                    <p className="text-[11px] leading-relaxed mt-0.5">
                      {pdfConvertMessage}
                      <br />
                      임의의 가짜 텍스트를 만들지 않으며, 자료 등록 후 원문 대조 화면에서 직접 검토·입력할 수 있습니다.
                    </p>
                  </div>
                </div>
              )}

              {pdfConvertStatus === 'error' && (
                <div className="p-3 bg-red-50 border border-red-300 rounded text-red-900 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>{pdfConvertMessage}</span>
                </div>
              )}
            </div>
          ) : (
            /* Transcript Upload & Parse Section */
            <div className="space-y-3 p-4 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
              <div className="flex items-center justify-between border-b border-[#ded6c8] pb-2">
                <span className="font-academic-mono text-[11px] font-bold text-[#191817]">
                  전사본 입력 방식 선택:
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTranscriptInputMode('file')}
                    className={`px-2.5 py-1 rounded text-[11px] font-academic-mono transition-colors ${
                      transcriptInputMode === 'file'
                        ? 'bg-[#191817] text-white font-bold'
                        : 'bg-white border border-[#ded6c8] text-[#57544e]'
                    }`}
                  >
                    파일 업로드 (.txt/.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptInputMode('paste')}
                    className={`px-2.5 py-1 rounded text-[11px] font-academic-mono transition-colors ${
                      transcriptInputMode === 'paste'
                        ? 'bg-[#191817] text-white font-bold'
                        : 'bg-white border border-[#ded6c8] text-[#57544e]'
                    }`}
                  >
                    텍스트 직접 붙여넣기
                  </button>
                </div>
              </div>

              {transcriptInputMode === 'file' ? (
                <div>
                  <input
                    type="file"
                    accept=".txt,.md"
                    onChange={handleTranscriptFileChange}
                    className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-xs file:border-0 file:text-xs file:font-semibold file:bg-[#191817] file:text-white hover:file:bg-[#33302b]"
                  />
                  {transcriptFileName && (
                    <div className="mt-2 text-[11px] text-[#57544e] font-academic-mono">
                      선택된 파일: <strong>{transcriptFileName}</strong> ({transcriptRawText.length}자)
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <textarea
                    value={transcriptRawText}
                    onChange={handlePasteChange}
                    placeholder="[00:15:30] 교수: 오늘 강의는 중심극한정리와 대수의 법칙을 다룹니다.&#10;학생: 질문 있습니다...&#10;&#10;(화자명이나 타임스탬프가 있으면 자동으로 인식하여 구조화합니다)"
                    rows={5}
                    className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-white text-[#191817] text-xs font-academic-mono resize-y"
                  />
                </div>
              )}

              {/* Transcript Analysis Result Preview */}
              {transcriptRawText.trim() && (
                <div className="p-3 bg-white border border-[#ded6c8] rounded text-xs space-y-1">
                  <div className="font-bold text-[#191817] flex items-center justify-between">
                    <span>전사본 자동 구조화 분석:</span>
                    <span className="font-academic-mono text-[10px] text-[#827d73]">
                      {transcriptRawText.length}자 입력됨
                    </span>
                  </div>
                  <div className="text-[11px] text-[#57544e] space-y-0.5">
                    <div>
                      • 감지된 화자 ({transcriptSpeakers.length}명):{' '}
                      <strong>{transcriptSpeakers.length > 0 ? transcriptSpeakers.join(', ') : '단일 화자 / 일반 본문'}</strong>
                    </div>
                    <div>
                      • 타임스탬프 정보:{' '}
                      {transcriptHasTimestamps ? (
                        <span className="text-emerald-700 font-semibold">✓ 원본 시각 정보 보존됨</span>
                      ) : (
                        <span className="text-[#827d73]">
                          시각 정보 없음 (원문에 시각 정보가 없어 임의 생성하지 않음)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Title & Source Refs */}
          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
              자료명 (제목):
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 통계학원론_3장_조건부분포.pdf 또는 4차시_녹취본.txt"
              required
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
            />
          </div>

          <div>
            <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1 font-semibold">
              출처 범위 / 참조 표기:
            </label>
            <input
              type="text"
              value={sourceRefs}
              onChange={(e) => setSourceRefs(e.target.value)}
              placeholder={kind === 'pdf' ? '예: 제3장 p.40 ~ p.58' : '예: 4차시 22:15'}
              className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
            />
          </div>

          {/* Disclaimer regarding Stage 2 */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs text-[11px] text-[#57544e] leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold text-[#827d73] mb-0.5">
              <Info className="w-3.5 h-3.5 text-blue-600" />
              <span>자료 등록 및 보관 정책 안내</span>
            </div>
            등록된 자료는 과목별로 안전하게 보관되며 원문 대조 편집기를 통해 자유롭게 확인·수정할 수 있습니다.
            AI 개념 추출 및 문제 자동 생성은 다음 단계에서 연결되며, 거짓 완료 표시를 하지 않습니다.
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isConvertingPdf}
              className="px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>자료 등록 완료</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
