'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Material, MaterialKind, MaterialPage, Subject } from '../lib/types';
import { MATERIAL_INPUT_LIMITS, findDuplicateMaterial, parseMaterialText, validateMaterialInputFile, validateMaterialText } from '../lib/materialIngestion';
import { saveMaterialContent, saveMaterialOriginal } from '../lib/materialStorage';
import { convertPdfInBrowser } from '../lib/pdf/browserPdfConverter';
import type { PdfServiceHealth } from '../lib/pdf/types';
import { createClient as createBrowserSupabaseClient } from '../lib/supabase/client';
import {
  X,
  Upload,
  FileText,
  Mic,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  ArrowRight,
  FileUp,
  ExternalLink,
  Monitor,
  Server,
} from 'lucide-react';

interface MaterialUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  activeSubject?: Subject | null;
  existingMaterials?: Material[];
  /** Resolves true only after the server confirmed the save. */
  onAddMaterial: (material: Material, originalFile?: File, jobId?: string) => Promise<boolean>;
  onOpenEditor?: (material: Material) => void;
}

/** New material ids are UUIDs; legacy string ids remain valid in the schema. */
function createMaterialId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `mat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function MaterialUploadModal({
  isOpen,
  onClose,
  subjects,
  activeSubject,
  existingMaterials,
  onAddMaterial,
  onOpenEditor,
}: MaterialUploadModalProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(activeSubject?.id || subjects[0]?.id || '');
  const [kind, setKind] = useState<MaterialKind>('pdf');
  const [title, setTitle] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');

  // Engine choice: 'browser' (PDF.js, default, zero-upload) vs 'precision' (PyMuPDF4LLM service)
  const [engineMode, setEngineMode] = useState<'browser' | 'precision'>('browser');
  const [serverHealth, setServerHealth] = useState<PdfServiceHealth>({ available: false, configured: false });

  // PDF conversion state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [pdfConvertStatus, setPdfConvertStatus] = useState<
    'idle' | 'converting' | 'success' | 'needs_review' | 'error'
  >('idle');
  const [pdfConvertMessage, setPdfConvertMessage] = useState<string>('');
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [pdfPages, setPdfPages] = useState<MaterialPage[]>([]);
  const [pdfFullMarkdown, setPdfFullMarkdown] = useState<string>('');
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>('loading');
  const [progressPage, setProgressPage] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [previewTab, setPreviewTab] = useState<'preview' | 'edit'>('preview');

  // Duplicate detection state
  const [duplicateMatch, setDuplicateMatch] = useState<{ id: string; title: string } | null>(null);

  // Transcript state
  const [transcriptInputMode, setTranscriptInputMode] = useState<'file' | 'paste'>('file');
  const [transcriptRawText, setTranscriptRawText] = useState('');
  const [transcriptFileName, setTranscriptFileName] = useState('');
  const [transcriptSpeakers, setTranscriptSpeakers] = useState<string[]>([]);
  const [transcriptHasTimestamps, setTranscriptHasTimestamps] = useState(false);
  const [transcriptParsedMarkdown, setTranscriptParsedMarkdown] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const externalMdInputRef = useRef<HTMLInputElement>(null);
  const textReadIdRef = useRef(0);
  const pdfAbortRef = useRef<AbortController | null>(null);
  const pdfConversionIdRef = useRef(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const materialIdRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Check health of precision convert service when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    fetch('/api/convert')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setServerHealth({
            available: Boolean(data?.available),
            engine: data?.engine,
            version: data?.version,
            configured: Boolean(data?.configured),
            message: data?.message,
          });
        }
      })
      .catch(() => {
        if (isMounted) {
          setServerHealth({ available: false, configured: false, message: '서버 확인 불가' });
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const checkDuplicates = (targetMd: string, targetRaw: string) => {
    if (!existingMaterials || existingMaterials.length === 0) {
      setDuplicateMatch(null);
      return;
    }
    const match = findDuplicateMaterial(existingMaterials, targetMd, targetRaw);
    setDuplicateMatch(match);
  };

  const handleAttachExternalMarkdown = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const validationError = validateMaterialInputFile('handout', file);
    if (validationError) {
      alert(validationError);
      return;
    }
    try {
      const text = await file.text();
      const textError = validateMaterialText(text);
      if (textError) {
        alert(textError);
        return;
      }
      const parsed = parseMaterialText('handout', text, title || file.name);
      setPdfFullMarkdown(parsed.markdown);
      setPdfConvertStatus('success');
      setPdfConvertMessage(`외부 Markdown 파일(${file.name})이 PDF와 연결되었습니다.`);
      checkDuplicates(parsed.markdown, '');
    } catch {
      alert('Markdown 파일을 읽지 못했습니다. 파일을 확인해 주세요.');
    }
  };

  if (!isOpen) return null;

  const cancelPdfConversion = () => {
    pdfConversionIdRef.current += 1;
    pdfAbortRef.current?.abort();
    pdfAbortRef.current = null;
    setIsConvertingPdf(false);
    setPdfConvertStatus('idle');
    setPdfConvertMessage('');
    setProgressPercent(0);
    setProgressPage({ current: 0, total: 0 });
    setPdfPages([]);
    setPdfWarnings([]);
    setPdfFullMarkdown('');
    setPageCount(undefined);
    setDuplicateMatch(null);
  };

  const handleClose = () => {
    cancelPdfConversion();
    onClose();
  };

  // Handle PDF file selection
  const handlePdfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    pdfAbortRef.current?.abort();
    const conversionId = ++pdfConversionIdRef.current;
    pdfAbortRef.current = null;
    setIsConvertingPdf(false);
    const validationError = validateMaterialInputFile('pdf', file);
    if (validationError) {
      setPdfFile(null);
      setPdfPages([]);
      setPdfWarnings([]);
      setPdfFullMarkdown('');
      setPageCount(undefined);
      setPdfConvertStatus('error');
      setPdfConvertMessage(validationError);
      alert(validationError);
      return;
    }

    const controller = new AbortController();
    pdfAbortRef.current = controller;
    setPdfFile(file);
    setPdfPages([]);
    setPdfWarnings([]);
    setPdfFullMarkdown('');
    setPageCount(undefined);
    if (!title.trim()) {
      setTitle(file.name);
    }

    // Auto-trigger conversion with the selected engine
    await runPdfConversion(file, conversionId, controller, engineMode);
  };

  const runPdfConversion = async (
    file: File,
    conversionId: number,
    controller: AbortController,
    mode: 'browser' | 'precision'
  ) => {
    setIsConvertingPdf(true);
    setPdfConvertStatus('converting');
    setProgressPercent(5);
    setProgressStage('loading');
    setPdfWarnings([]);

    try {
      if (mode === 'browser') {
        // --- 1. Browser Client-Side Conversion (PDF.js) ---
        setPdfConvertMessage('이 기기(브라우저)에서 PDF.js로 페이지와 텍스트 구조를 분석하는 중...');

        const result = await convertPdfInBrowser(file, {
          signal: controller.signal,
          onProgress: (p) => {
            if (conversionId !== pdfConversionIdRef.current) return;
            setProgressPercent(p.percent);
            setProgressStage(p.stage || 'parsing');
            setProgressPage({ current: p.page, total: p.totalPages });
          },
        });

        if (conversionId !== pdfConversionIdRef.current) return;

        if (!result.success) {
          if (result.code === 'PDF_NO_TEXT') {
            setPdfConvertStatus('needs_review');
            setPdfConvertMessage(
              result.error ||
                '스캔된 이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다 (OCR 미지원).'
            );
            setPdfPages(result.pages || []);
            setPageCount(result.pageCount || 1);
          } else {
            setPdfConvertStatus('error');
            setPdfConvertMessage(result.error || '브라우저 PDF 변환 중 오류가 발생했습니다.');
          }
          return;
        }

        // Success
        setPdfConvertStatus('success');
        setPdfConvertMessage(
          `브라우저 변환 완료 (PDF.js): 총 ${result.pageCount}페이지 구조화 성공`
        );
        setPdfPages(result.pages || []);
        setPdfFullMarkdown(result.fullMarkdown || '');
        setPageCount(result.pageCount);
        setPdfWarnings(result.warnings || []);
        checkDuplicates(result.fullMarkdown || '', '');

        if (!sourceRefs.trim()) {
          setSourceRefs(`제1페이지 ~ 제${result.pageCount}페이지`);
        }
      } else {
        // --- 2. Server Precision Conversion (PyMuPDF4LLM) ---
        setPdfConvertMessage('PyMuPDF4LLM 정밀 변환 마이크로서비스로 전송 및 분석 중...');

        let data: {
          success: boolean;
          hasText: boolean;
          pageCount: number;
          pages?: MaterialPage[];
          fullMarkdown?: string;
          markdown?: string;
          code?: string;
          errorCode?: string;
          error?: string | null;
        };

        let currentTicket: { jobId: string; storagePath: string } | null = null;
        try {
          // For large PDFs (> 4.5MB), use direct Supabase Storage ticket path to bypass Vercel limits
          if (file.size > 4.5 * 1024 * 1024) {
            setPdfConvertMessage('대용량 PDF (4.5MB 초과): 임시 스토리지 전송 후 정밀 변환 중...');
            const ticketRes = await fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'create_storage_ticket',
                fileName: file.name,
                fileSize: file.size,
              }),
              signal: controller.signal,
            });
            const ticket = await ticketRes.json();
            if (!ticketRes.ok || !ticket.success) {
              throw new Error(ticket.error || '스토리지 변환 티켓 발급 실패');
            }
            currentTicket = { jobId: ticket.jobId, storagePath: ticket.storagePath };

            let supabaseClient;
            try {
              supabaseClient = createBrowserSupabaseClient();
            } catch {
              throw new Error('스토리지 클라이언트를 생성할 수 없습니다. "이 기기에서 변환"을 이용해 주세요.');
            }

            const { error: uploadErr } = await supabaseClient.storage
              .from(ticket.bucket || 'materials')
              .upload(ticket.storagePath, file, { upsert: true });

            if (uploadErr) {
              throw new Error(`임시 스토리지 업로드 실패: ${uploadErr.message}`);
            }

            const convertRes = await fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'convert_storage',
                jobId: ticket.jobId,
                storagePath: ticket.storagePath,
              }),
              signal: controller.signal,
            });
            data = await convertRes.json();
          } else {
            // Standard size direct form proxy
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/convert', {
              method: 'POST',
              body: formData,
              signal: controller.signal,
            });
            data = await res.json();
          }
        } catch (convertErr) {
          if (currentTicket) {
            fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'cancel_storage_ticket',
                jobId: currentTicket.jobId,
                storagePath: currentTicket.storagePath,
              }),
            }).catch(() => {});
          }
          throw convertErr;
        }

        if (conversionId !== pdfConversionIdRef.current) {
          if (currentTicket) {
            fetch('/api/convert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'cancel_storage_ticket',
                jobId: currentTicket.jobId,
                storagePath: currentTicket.storagePath,
              }),
            }).catch(() => {});
          }
          return;
        }

        if (!data.success) {
          const errCode = data.code || data.errorCode;
          if (errCode === 'PDF_NO_TEXT') {
            setPdfConvertStatus('needs_review');
            setPdfConvertMessage(
              data.error ||
                '스캔된 이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다 (OCR 미지원).'
            );
            setPdfPages(data.pages || []);
            setPageCount(data.pageCount || 1);
          } else {
            setPdfConvertStatus('error');
            setPdfConvertMessage(data.error || '정밀 변환 중 오류가 발생했습니다.');
          }
          return;
        }

        // Success
        setPdfConvertStatus('success');
        setPdfConvertMessage(
          `PyMuPDF4LLM 정밀 변환 완료: 총 ${data.pageCount}페이지 구조화 성공`
        );
        const pagesList = data.pages || [];
        setPdfPages(pagesList);
        const fullMd = data.fullMarkdown || data.markdown || '';
        setPdfFullMarkdown(fullMd);
        setPageCount(data.pageCount);
        checkDuplicates(fullMd, '');

        if (!sourceRefs.trim()) {
          setSourceRefs(`제1페이지 ~ 제${data.pageCount}페이지`);
        }
      }
    } catch (err) {
      if (conversionId !== pdfConversionIdRef.current) return;
      setPdfConvertStatus('error');
      setPdfConvertMessage(`변환 요청 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      if (conversionId === pdfConversionIdRef.current) {
        pdfAbortRef.current = null;
        setIsConvertingPdf(false);
      }
    }
  };

  // Handle transcript or Markdown handout file selection.
  const handleTranscriptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    const textKind = kind === 'handout' ? 'handout' : 'transcript';
    const validationError = validateMaterialInputFile(textKind, file);
    if (validationError) {
      alert(validationError);
      return;
    }

    setTranscriptFileName(file.name);
    if (!title.trim()) {
      setTitle(file.name);
    }

    const readId = ++textReadIdRef.current;
    try {
      const text = await file.text();
      if (readId !== textReadIdRef.current) return;
      if (text.includes('\u0000')) {
        alert('텍스트 파일을 읽을 수 없습니다. UTF-8 텍스트 또는 Markdown 파일을 선택해 주세요.');
        return;
      }
      processTranscriptText(text, file.name, textKind);
    } catch {
      if (readId !== textReadIdRef.current) return;
      alert('텍스트 파일을 읽지 못했습니다. 파일을 확인하고 다시 선택해 주세요.');
    }
  };

  const processTranscriptText = (
    text: string,
    defaultTitle: string,
    targetKind: 'transcript' | 'handout' = kind === 'handout' ? 'handout' : 'transcript'
  ) => {
    const textKind = targetKind;
    const parsed = parseMaterialText(textKind, text, defaultTitle || title || '강의 전사본');
    setTranscriptRawText(parsed.rawText);
    setTranscriptSpeakers(parsed.speakers);
    setTranscriptHasTimestamps(parsed.hasTimestamps);
    setTranscriptParsedMarkdown(parsed.markdown);
    checkDuplicates(parsed.markdown, parsed.rawText);

    if (!sourceRefs.trim() && textKind === 'transcript') {
      setSourceRefs(
        parsed.hasTimestamps
          ? '타임스탬프 전사본'
          : `전사본 (${parsed.blockCount}개 발화 블록)`
      );
    }
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    textReadIdRef.current += 1;
    const text = e.target.value;
    processTranscriptText(text, title || '강의 직접 입력 전사본');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!title.trim()) {
      alert('자료 제목을 입력해 주세요.');
      return;
    }
    if (kind === 'pdf' && !pdfFile) {
      alert('등록할 PDF 파일을 먼저 선택해 주세요.');
      return;
    }
    if (kind === 'pdf' && pdfConvertStatus === 'idle') {
      alert('PDF 변환 상태를 확인할 수 없습니다. 파일을 다시 선택해 주세요.');
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
        statusMsg = engineMode === 'browser' ? 'PDF.js 브라우저 변환 완료' : 'PyMuPDF4LLM 정밀 변환 완료';
      } else {
        status = 'needs_review';
        statusMsg = 'PDF 원본 파일이 첨부되지 않았습니다.';
      }
      finalMarkdown = pdfFullMarkdown;
    } else {
      const textError = validateMaterialText(transcriptRawText);
      if (textError) {
        alert(textError);
        return;
      }
      finalMarkdown = transcriptParsedMarkdown;
      finalRawText = transcriptRawText;
      status = 'ready';
    }

    if (!materialIdRef.current) {
      materialIdRef.current = createMaterialId();
    }
    if (!jobIdRef.current) {
      jobIdRef.current = createMaterialId();
    }
    const newMaterial: Material = {
      id: materialIdRef.current,
      subjectId: selectedSubjectId,
      kind,
      title: title.trim(),
      sourceRefs: sourceRefs.trim() || (
        kind === 'pdf' ? `p.1 ~ p.${pageCount || 1}` : kind === 'handout' ? 'Markdown/텍스트 자료' : '전사본'
      ),
      pageCount: kind === 'pdf' ? pageCount || 1 : undefined,
      parsedMarkdown: finalMarkdown || undefined,
      rawText: finalRawText || undefined,
      pages: kind === 'pdf' && pdfPages.length > 0 ? pdfPages : undefined,
      status,
      statusMessage: statusMsg,
      isConverted: status === 'ready',
      isDemo: false,
      uploadedAt: new Date().toISOString(),
      speakerCount: transcriptSpeakers.length > 0 ? transcriptSpeakers.length : undefined,
      speakers: transcriptSpeakers.length > 0 ? transcriptSpeakers : undefined,
      hasAiConcepts: false,
      hasAiProblems: false,
    };

    setIsSubmitting(true);
    try {
      // 1. Save heavy content to the local IndexedDB cache
      const saveResult = await saveMaterialContent(newMaterial.id, {
        markdown: finalMarkdown,
        rawText: finalRawText,
        pages: kind === 'pdf' ? pdfPages : undefined,
      });

      // 1.1 Persist local original PDF in IndexedDB
      if (kind === 'pdf' && pdfFile) {
        try {
          await saveMaterialOriginal(newMaterial.id, pdfFile, 'application/pdf');
        } catch {
          // IndexedDB storage of original is best effort
        }
      }

      // 2. Persist metadata + server copy
      const serverOk = await onAddMaterial(
        newMaterial,
        kind === 'pdf' ? pdfFile ?? undefined : undefined,
        jobIdRef.current ?? undefined
      );

      if (!serverOk) {
        alert('서버에 자료를 저장하지 못했습니다. 입력 내용은 그대로 유지됩니다. 다시 시도해 주세요.');
        return;
      }

      if (!saveResult.persisted) {
        alert(`서버 저장은 완료됐지만 브라우저 캐시에는 메모리로만 보관되었습니다.\n사유: ${saveResult.error}`);
      }

      materialIdRef.current = null;
      jobIdRef.current = null;
      onClose();

      if (onOpenEditor) {
        onOpenEditor(newMaterial);
      }
    } finally {
      setIsSubmitting(false);
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
          <button type="button" onClick={handleClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans overflow-y-auto">
          {/* Duplicate Content Detection Banner */}
          {duplicateMatch && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold">동일한 본문 내용의 자료가 이미 등록되어 있습니다.</span>
                  <div className="text-[11px] text-amber-800">
                    기존 등록 자료: <strong className="underline">{duplicateMatch.title}</strong>
                  </div>
                </div>
              </div>
              {onOpenEditor && (
                <button
                  type="button"
                  onClick={() => {
                    const target = existingMaterials?.find((m) => m.id === duplicateMatch.id);
                    if (target) {
                      onClose();
                      onOpenEditor(target);
                    }
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-1 shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  기존 자료 열기
                </button>
              )}
            </div>
          )}

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
            <div className="grid grid-cols-3 gap-2">
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
                <span>PDF 강의 교재</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  textReadIdRef.current += 1;
                  setKind('transcript');
                  if (transcriptRawText) processTranscriptText(transcriptRawText, title || '강의 전사본', 'transcript');
                }}
                className={`p-3 rounded-xs border flex items-center justify-center gap-2 text-xs font-medium transition-all ${
                  kind === 'transcript'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span>녹음 전사본 (.txt / .md / 직접입력)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  textReadIdRef.current += 1;
                  setKind('handout');
                  if (transcriptRawText) processTranscriptText(transcriptRawText, title || '강의 자료', 'handout');
                }}
                className={`p-3 rounded-xs border flex items-center justify-center gap-2 text-xs font-medium transition-all ${
                  kind === 'handout'
                    ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold shadow-2xs'
                    : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Markdown / 텍스트</span>
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
                  PDF 변환 방식 선택
                </span>
                <span className="text-[10px] text-[#827d73] font-academic-mono">.pdf · 최대 {(MATERIAL_INPUT_LIMITS.pdfBytes / 1024 / 1024).toFixed(0)}MB</span>
              </div>

              {/* Conversion Engine Toggle (Browser vs Precision) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEngineMode('browser');
                    if (pdfFile && !isConvertingPdf) {
                      const controller = new AbortController();
                      pdfAbortRef.current = controller;
                      const conversionId = ++pdfConversionIdRef.current;
                      void runPdfConversion(pdfFile, conversionId, controller, 'browser');
                    }
                  }}
                  className={`p-2.5 rounded-xs border text-left flex flex-col gap-1 transition-all ${
                    engineMode === 'browser'
                      ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] shadow-2xs'
                      : 'border-[#ded6c8] bg-white text-[#57544e] hover:bg-[#faf8f4]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5" />
                      이 기기에서 변환 (권장)
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-academic-mono">
                      PDF.js 로컬
                    </span>
                  </div>
                  <span className="text-[10px] text-[#827d73] leading-tight">
                    서버로 원본을 전송하지 않고 브라우저에서 안전하고 빠르게 변환합니다.
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!serverHealth.available}
                  onClick={() => {
                    if (!serverHealth.available) return;
                    setEngineMode('precision');
                    if (pdfFile && !isConvertingPdf) {
                      const controller = new AbortController();
                      pdfAbortRef.current = controller;
                      const conversionId = ++pdfConversionIdRef.current;
                      void runPdfConversion(pdfFile, conversionId, controller, 'precision');
                    }
                  }}
                  className={`p-2.5 rounded-xs border text-left flex flex-col gap-1 transition-all ${
                    !serverHealth.available
                      ? 'opacity-60 bg-[#f5f3ef] border-[#ded6c8] cursor-not-allowed text-[#827d73]'
                      : engineMode === 'precision'
                      ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] shadow-2xs'
                      : 'border-[#ded6c8] bg-white text-[#57544e] hover:bg-[#faf8f4]'
                  }`}
                  title={
                    !serverHealth.available
                      ? '정밀 변환 마이크로서비스가 설정되지 않았거나 오프라인 상태입니다.'
                      : 'PyMuPDF4LLM 서버 정밀 변환'
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" />
                      정밀 변환
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-academic-mono ${
                        serverHealth.available
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {serverHealth.available ? 'PyMuPDF4LLM' : '서버 미연결'}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#827d73] leading-tight">
                    {serverHealth.available
                      ? '수식·표·레이아웃 구조를 정밀 분석합니다. (마이크로서비스 연결됨)'
                      : '정밀 변환 서버가 준비되지 않아 브라우저 변환을 기본 사용합니다.'}
                  </span>
                </button>
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
                    : engineMode === 'browser'
                    ? '선택한 파일은 외부 서버로 전송되지 않고 이 기기에서 안전하게 변환됩니다.'
                    : 'PyMuPDF4LLM 독립 서비스가 페이지별 Markdown과 수식을 정밀 분석합니다.'}
                </span>
              </div>

              {/* Conversion Progress Indicator */}
              {isConvertingPdf && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-blue-900 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      <span className="font-bold">
                        {engineMode === 'browser'
                          ? '브라우저(PDF.js)에서 페이지 분석 및 Markdown 구성 중...'
                          : 'PyMuPDF4LLM 서버에서 문서 정밀 분석 중...'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={cancelPdfConversion}
                      className="px-2 py-0.5 text-[11px] bg-white border border-blue-300 rounded text-blue-800 hover:bg-blue-100 font-academic-mono"
                    >
                      변환 취소
                    </button>
                  </div>
                  <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-blue-700 font-academic-mono">
                    <span>
                      진행 상태:{' '}
                      {progressStage === 'loading'
                        ? '문서 로딩'
                        : progressStage === 'parsing'
                        ? '페이지 파싱'
                        : '서식 구성'}
                    </span>
                    <span>
                      {progressPercent}%{' '}
                      {progressPage.total > 0
                        ? `(${progressPage.current}/${progressPage.total}페이지)`
                        : ''}
                    </span>
                  </div>
                </div>
              )}

              {/* Warnings / Quality Notice Badges */}
              {pdfWarnings.length > 0 && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-amber-900 text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>학습 자료 구조 검토 권장 항목:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-amber-800 pl-1">
                    {pdfWarnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Success Result Status */}
              {pdfConvertStatus === 'success' && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-emerald-900 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold">{pdfConvertMessage}</span>
                    <div className="text-[11px] text-emerald-800 mt-0.5">
                      변환된 Markdown과 원본 페이지 번호가 연결되었습니다. 아래에서 내용을 미리 보고 필요 시 수정할 수 있습니다.
                    </div>
                  </div>
                </div>
              )}

              {/* Scanned/No Text Notice */}
              {pdfConvertStatus === 'needs_review' && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 text-xs flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">⚠️ 원본 확인 필요 (스캔/이미지 기반 PDF - OCR 미지원)</span>
                      <p className="text-[11px] leading-relaxed mt-0.5">
                        {pdfConvertMessage}
                        <br />
                        자체 OCR 기능은 지원되지 않으므로, 외부 OCR/변환 도구로 생성한 Markdown(.md) 파일을 직접 연결할 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-amber-200">
                    <input
                      ref={externalMdInputRef}
                      type="file"
                      accept=".md,.txt"
                      onChange={handleAttachExternalMarkdown}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => externalMdInputRef.current?.click()}
                      className="px-2.5 py-1 text-[11px] font-bold bg-[#191817] text-white rounded hover:bg-[#33302b] flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      외부 변환 Markdown 파일(.md) 연결하기
                    </button>
                    <span className="text-[10px] text-amber-800">
                      선택한 Markdown이 이 PDF의 정규 본문으로 연결됩니다.
                    </span>
                  </div>
                </div>
              )}

              {/* Error Status */}
              {pdfConvertStatus === 'error' && (
                <div className="p-3 bg-red-50 border border-red-300 rounded text-red-900 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{pdfConvertMessage}</span>
                </div>
              )}

              {/* Markdown Preview & Live Editor before save */}
              {(pdfConvertStatus === 'success' || pdfFullMarkdown.trim().length > 0) && (
                <div className="space-y-1.5 pt-1 border-t border-[#ded6c8]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewTab('preview')}
                        className={`px-2.5 py-1 text-[11px] rounded font-academic-mono transition-colors ${
                          previewTab === 'preview'
                            ? 'bg-[#191817] text-white font-bold'
                            : 'bg-white border border-[#ded6c8] text-[#57544e]'
                        }`}
                      >
                        본문 미리보기
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTab('edit')}
                        className={`px-2.5 py-1 text-[11px] rounded font-academic-mono transition-colors ${
                          previewTab === 'edit'
                            ? 'bg-[#191817] text-white font-bold'
                            : 'bg-white border border-[#ded6c8] text-[#57544e]'
                        }`}
                      >
                        Markdown 원문 직접 수정
                      </button>
                    </div>
                    <span className="text-[10px] text-[#827d73] font-academic-mono">
                      총 {pageCount || 1}페이지 · {pdfFullMarkdown.length}자
                    </span>
                  </div>

                  {previewTab === 'edit' ? (
                    <textarea
                      value={pdfFullMarkdown}
                      onChange={(e) => {
                        setPdfFullMarkdown(e.target.value);
                        checkDuplicates(e.target.value, '');
                      }}
                      rows={6}
                      className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-white text-[#191817] text-xs font-academic-mono resize-y"
                      placeholder="변환된 Markdown 본문을 검토하고 필요 시 직접 수정할 수 있습니다."
                    />
                  ) : (
                    <div className="p-3 bg-white border border-[#ded6c8] rounded-xs max-h-40 overflow-y-auto">
                      <pre className="whitespace-pre-wrap break-words font-academic-mono text-[11px] text-[#33302b]">
                        {pdfFullMarkdown.slice(0, 3000)}
                        {pdfFullMarkdown.length > 3000 ? '\n\n... (더 많은 내용이 있습니다) ...' : ''}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Transcript Upload & Parse Section */
            <div className="space-y-3 p-4 bg-[#faf8f4] border border-[#ded6c8] rounded-xs">
              <div className="flex items-center justify-between border-b border-[#ded6c8] pb-2">
                <span className="font-academic-mono text-[11px] font-bold text-[#191817]">
                  {kind === 'handout' ? 'Markdown / 텍스트 입력 방식 선택:' : '전사본 입력 방식 선택:'}
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
                    {kind === 'handout' ? '자료 파일 (.md/.txt)' : '전사본 파일 (.txt/.md)'}
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
                    placeholder={kind === 'handout'
                      ? '# 3장 조건부분포\n\nMarkdown 내용을 붙여넣으면 원문 형식을 그대로 보존합니다.'
                      : '[00:15:30] 교수: 오늘 강의는 중심극한정리와 대수의 법칙을 다룹니다.\n학생: 질문 있습니다...\n\n(원문에 있는 화자명과 타임스탬프만 인식합니다)'}
                    rows={5}
                    className="w-full p-2.5 border border-[#ded6c8] rounded-xs bg-white text-[#191817] text-xs font-academic-mono resize-y"
                  />
                </div>
              )}

              {/* Transcript Analysis Result Preview */}
              {kind === 'handout' && transcriptRawText.trim() && (
                <div className="p-3 bg-white border border-[#ded6c8] rounded text-xs space-y-1">
                  <div className="font-bold text-[#191817] flex items-center justify-between">
                    <span>Markdown 원문 미리보기:</span>
                    <span className="font-academic-mono text-[10px] text-[#827d73]">{transcriptRawText.length}자 입력됨</span>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[#57544e]">{transcriptRawText.slice(0, 4000)}</pre>
                </div>
              )}
              {kind === 'transcript' && transcriptRawText.trim() && (
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

          {/* Disclaimer regarding Storage and AI Processing Policy */}
          <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs text-[11px] text-[#57544e] leading-relaxed space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-[#827d73]">
              <Info className="w-3.5 h-3.5 text-blue-600" />
              <span>보관 정책 및 데이터 전송 안내</span>
            </div>
            <div className="text-[11px] text-[#57544e]">
              • <strong>보관 방식:</strong> 원본 파일과 본문 텍스트는 브라우저 로컬 저장소(IndexedDB)에 우선 보관되며, 클라우드 동기화 사용 시에만 안전하게 백업됩니다.
            </div>
            <div className="text-[11px] text-[#57544e]">
              • <strong>로컬 변환 보장:</strong> &apos;이 기기에서 변환&apos;을 선택하면 PDF 원본 파일이 서버나 외부로 전송되지 않고 브라우저 내에서만 안전하게 변환됩니다.
            </div>
            <div className="text-[10px] text-[#827d73]">
              ※ 대학 시험 수준의 엄밀성을 위해 숫자만 바꾼 문제가 아닌 복합 개념 문제가 생성되며, 가짜 성공이나 임의 완료 처리를 하지 않습니다.
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={handleClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isConvertingPdf || isSubmitting}
              className="px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>{isSubmitting ? '서버 저장 중...' : '자료 등록 완료'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
