'use client';

import React, { useState } from 'react';
import { Material, MaterialKind, Subject } from '../lib/types';
import {
  X,
  Upload,
  FileText,
  Mic,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Info,
} from 'lucide-react';

interface MaterialUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjects: Subject[];
  activeSubject: Subject;
  onAddMaterial: (material: Material) => void;
}

export function MaterialUploadModal({
  isOpen,
  onClose,
  subjects,
  activeSubject,
  onAddMaterial,
}: MaterialUploadModalProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(activeSubject.id);
  const [kind, setKind] = useState<MaterialKind>('pdf');
  const [title, setTitle] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');
  const [pageOrDuration, setPageOrDuration] = useState('');
  const [parsedMarkdown, setParsedMarkdown] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'markdown_preview'>('upload');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('자료 제목을 입력해 주세요.');
      return;
    }

    const newMaterial: Material = {
      id: `mat-${Date.now()}`,
      subjectId: selectedSubjectId,
      kind,
      title: title.trim(),
      sourceRefs: sourceRefs.trim() || (kind === 'pdf' ? '전체 페이지' : '전체 녹취'),
      pageCount: kind === 'pdf' ? Number(pageOrDuration) || 10 : undefined,
      durationMinutes: kind === 'transcript' ? Number(pageOrDuration) || 60 : undefined,
      parsedMarkdown: parsedMarkdown.trim() || undefined,
      isConverted: false, // Transparent: server conversion not yet triggered
      uploadedAt: new Date().toISOString(),
    };

    onAddMaterial(newMaterial);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-[#c8c2b5] rounded-xs shadow-xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#c52828]" />
            <h3 className="font-academic-serif text-sm font-bold">
              학습 교재 및 전사본 자료 등록
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-[#ded6c8] bg-[#faf8f4] px-5 pt-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-[#c52828] text-[#c52828] font-bold bg-white'
                : 'border-transparent text-[#57544e] hover:text-[#191817]'
            }`}
          >
            자료 메타데이터 등록
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('markdown_preview')}
            className={`px-3 py-1.5 font-medium border-b-2 transition-colors ${
              activeTab === 'markdown_preview'
                ? 'border-[#c52828] text-[#c52828] font-bold bg-white'
                : 'border-transparent text-[#57544e] hover:text-[#191817]'
            }`}
          >
            Markdown 검토 & 변환 규격
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans overflow-y-auto">
          {activeTab === 'upload' ? (
            <>
              {/* Subject selector */}
              <div>
                <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                  대상 과목 연결:
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="w-full p-2 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
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
                <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                  자료 포맷 유형:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setKind('pdf')}
                    className={`p-2.5 rounded-xs border flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                      kind === 'pdf'
                        ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                        : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    <span>PDF 원문 교재</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKind('transcript')}
                    className={`p-2.5 rounded-xs border flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                      kind === 'transcript'
                        ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                        : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>전사본 텍스트</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKind('handout')}
                    className={`p-2.5 rounded-xs border flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
                      kind === 'handout'
                        ? 'border-[#c52828] bg-[#fef2f2] text-[#c52828] font-bold'
                        : 'border-[#ded6c8] bg-[#faf8f4] text-[#57544e]'
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>강의 핸드아웃/필기</span>
                  </button>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                  자료 파일명 / 제목:
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 통계학원론_3장_조건부분포.pdf 또는 4차시_녹취본.txt"
                  required
                  className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
                />
              </div>

              {/* Source Reference & Page/Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                    출처 위치 / 범위 참조:
                  </label>
                  <input
                    type="text"
                    value={sourceRefs}
                    onChange={(e) => setSourceRefs(e.target.value)}
                    placeholder={kind === 'pdf' ? '예: 제3장 p.40 ~ p.58' : '예: 4차시 22:15'}
                    className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
                  />
                </div>

                <div>
                  <label className="block font-academic-mono text-[11px] text-[#57544e] mb-1">
                    {kind === 'pdf' ? '총 페이지 수:' : '재생 분량(분):'}
                  </label>
                  <input
                    type="number"
                    value={pageOrDuration}
                    onChange={(e) => setPageOrDuration(e.target.value)}
                    placeholder={kind === 'pdf' ? '예: 19' : '예: 75'}
                    className="w-full p-2 border border-[#ded6c8] rounded-xs bg-[#fefefe] text-[#191817]"
                  />
                </div>
              </div>

              {/* Backend Converter Adapter Notice */}
              <div className="bg-[#faf8f4] border border-[#ded6c8] p-3 rounded-xs space-y-1.5 text-xs text-[#57544e]">
                <div className="flex items-center gap-1.5 font-academic-mono text-[11px] font-bold text-[#827d73]">
                  <Info className="w-3.5 h-3.5 text-blue-600" />
                  <span>PyMuPDF4LLM 변환 파이프라인 어댑터 규격</span>
                </div>
                <p className="leading-relaxed text-[11px]">
                  본 프론트엔드는 차후 백엔드의 <strong>PyMuPDF4LLM</strong> 기반 Markdown 파싱 서비스와 연동될 수 있도록 인터페이스 규격이 분리되어 있습니다.
                  현재 환경에서는 서버 PDF 파싱이 수행된 것처럼 거짓 표시하지 않으며, 클라이언트 메타데이터 등록 상태로 보존됩니다.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-academic-mono text-[11px] text-[#57544e] font-bold">
                  Markdown 원문 검토 및 수식 입력:
                </span>
                <span className="text-[10px] font-academic-mono text-[#827d73]">
                  (PyMuPDF4LLM 출력 예상 형태)
                </span>
              </div>

              <textarea
                value={parsedMarkdown}
                onChange={(e) => setParsedMarkdown(e.target.value)}
                placeholder={`# ${title || '자료 제목'}\n\n## 1. 주요 정의 및 수식\n$$E[Y|X=x] = \\int_{-\\infty}^{\\infty} y f_{Y|X}(y|x) dy$$\n\n- 본문 해설 및 개념 설명이 이곳에 마크다운으로 렌더링됩니다.`}
                rows={9}
                className="w-full p-3 font-academic-mono text-xs border border-[#ded6c8] rounded-xs bg-[#faf8f4] text-[#191817] leading-relaxed resize-y"
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1ede4]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-[#ded6c8] text-[#57544e] hover:bg-[#faf8f4] rounded-xs"
            >
              닫기
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs shadow-xs"
            >
              자료 등록 완료
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
