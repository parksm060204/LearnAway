'use client';

import React, { useState, useEffect } from 'react';
import { Material } from '../lib/types';
import { loadMaterialContent } from '../lib/materialStorage';
import { MarkdownRenderer } from './MarkdownRenderer';
import { X, BookOpen, ExternalLink, FileText, Mic, AlertTriangle } from 'lucide-react';

interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceRef: string;
  conceptTitle?: string;
  material?: Material | null;
  onOpenEditor?: (material: Material) => void;
}

export function PdfViewerModal({
  isOpen,
  onClose,
  sourceRef,
  conceptTitle,
  material,
  onOpenEditor,
}: PdfViewerModalProps) {
  const [contentMarkdown, setContentMarkdown] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    if (material) {
      setIsLoading(true);
      loadMaterialContent(material.id)
        .then((saved) => {
          setContentMarkdown(saved?.markdown || material.parsedMarkdown || '');
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setContentMarkdown('');
    }
  }, [isOpen, material]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-3xl bg-white border border-[#c8c2b5] rounded-xs shadow-2xl my-auto overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#191817] text-white px-5 py-3 flex items-center justify-between border-b border-[#33302b]">
          <div className="flex items-center gap-2 overflow-hidden">
            {material?.kind === 'transcript' ? (
              <Mic className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <BookOpen className="w-4 h-4 text-[#c52828] shrink-0" />
            )}
            <h3 className="font-academic-serif text-sm font-bold truncate max-w-[450px]">
              {material ? material.title : `자료 열람: ${sourceRef}`}
            </h3>
          </div>
          <button onClick={onClose} className="text-[#ded6c8] hover:text-white" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Reference Meta */}
        <div className="border-b border-[#ded6c8] bg-[#faf8f4] px-5 py-2 flex items-center justify-between text-xs text-[#57544e] font-academic-mono">
          <span>참조 위치: § {material ? material.sourceRefs : sourceRef}</span>
          <span>연결 개념: {conceptTitle || (material?.isDemo ? '데모 학습 자료' : '사용자 등록 자료')}</span>
        </div>

        {/* Reader Document Body */}
        <div className="p-6 overflow-y-auto space-y-4 font-sans text-xs sm:text-sm text-[#191817] leading-relaxed bg-[#fdfcfb] min-h-[300px]">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-xs text-[#57544e]">
              <div className="w-6 h-6 border-2 border-[#c52828] border-t-transparent rounded-full animate-spin" />
              <span>자료를 불러오는 중입니다...</span>
            </div>
          ) : contentMarkdown ? (
            <MarkdownRenderer content={contentMarkdown} />
          ) : (
            <div className="py-16 text-center text-[#827d73] space-y-2">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <div className="font-bold text-sm text-[#191817]">저장된 Markdown 본문이 없습니다.</div>
              <p className="text-xs max-w-sm mx-auto leading-relaxed">
                원본 PDF에서 아직 텍스트를 추출하지 못했거나 작성 중인 자료입니다. 원문 대조 편집기에서 내용을 입력하고 확인해 보세요.
              </p>
              {material && onOpenEditor && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenEditor(material);
                  }}
                  className="mt-3 px-3.5 py-1.5 bg-[#191817] text-white rounded text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>원문 대조 편집기 열기</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#faf8f4] border-t border-[#ded6c8] px-5 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {material && onOpenEditor && (
              <button
                onClick={() => {
                  onClose();
                  onOpenEditor(material);
                }}
                className="px-3 py-1.5 bg-white hover:bg-[#e8e4dc] border border-[#ded6c8] text-[#191817] rounded-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#c52828]" />
                <span>원문 대조 편집기에서 열기</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#191817] text-white hover:bg-[#33302b] rounded-xs font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
