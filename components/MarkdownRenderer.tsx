'use client';

import React, { useMemo } from 'react';
import { proofreadAcademicText, safeRenderKaTeX } from '../lib/academicProofing';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onPageClick?: (pageNumber: number) => void;
  onBlockClick?: (blockIndex: number) => void;
}

export function MarkdownRenderer({
  content,
  className = '',
  onPageClick,
  onBlockClick,
}: MarkdownRendererProps) {
  const renderedHtml = useMemo(() => {
    if (!content) return '';

    // Proofread text: converts Lean blocks, bare LaTeX, and double-escape artifacts
    let text = proofreadAcademicText(content);

    // 1. Process display math blocks: $$ ... $$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, equation) => {
      return `<div class="my-3 py-2 px-3 bg-[#faf8f5] border border-[#e8e4dc] rounded text-center overflow-x-auto select-text">${safeRenderKaTeX(
        equation,
        true
      )}</div>`;
    });

    // 2. Process inline math: $ ... $
    text = text.replace(/\$([^\$\n]+?)\$/g, (_, equation) => {
      return safeRenderKaTeX(equation, false);
    });

    // 3. Process Page & Speech anchors
    // <!-- [PAGE 3] --> -> visual badge
    text = text.replace(/<!--\s*\[PAGE\s+(\d+)\]\s*-->/gi, (_, pageNum) => {
      return `<div class="my-4 pt-3 border-t border-[#ded6c8] flex items-center justify-between text-[#827d73] text-[11px] font-mono">
        <span class="inline-flex items-center gap-1.5 font-bold text-[#c52828] bg-[#fef2f2] px-2 py-0.5 rounded border border-[#fca5a5]/40 cursor-pointer hover:bg-red-100" data-page="${pageNum}">
          § 원본 PDF 제${pageNum}페이지
        </span>
        <span>출처 앵커</span>
      </div>`;
    });

    // <!-- [발화 #3] --> -> visual badge
    text = text.replace(/<!--\s*\[발화\s+#?(\d+)\]\s*-->/gi, (_, blockNum) => {
      return `<div class="mt-3 pt-2 text-[#827d73] text-[11px] font-mono">
        <span class="inline-flex items-center gap-1 font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60" data-block="${blockNum}">
          § 발화 #${blockNum}
        </span>
      </div>`;
    });

    // 4. Process Headings
    text = text.replace(/^### (.*$)/gim, '<h3 class="text-sm font-bold font-serif text-[#191817] mt-4 mb-2">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 class="text-base font-bold font-serif text-[#191817] mt-5 mb-2 pb-1 border-b border-[#e2ded6]">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 class="text-lg font-bold font-serif text-[#191817] mt-2 mb-3 pb-1 border-b-2 border-[#191817]">$1</h1>');

    // 5. Process Blockquotes: > ...
    text = text.replace(/^>\s?(.*$)/gim, '<blockquote class="border-l-3 border-[#c52828] pl-3 py-1 my-2 bg-[#fdfcfb] text-[#33302b] italic text-xs">$1</blockquote>');

    // 6. Process Bold and Italic
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 7. Process Horizontal Rules
    text = text.replace(/^---$/gim, '<hr class="my-4 border-[#e2ded6]" />');

    // 8. Process Lists
    text = text.replace(/^\s*-\s+(.*$)/gim, '<li class="ml-4 list-disc text-xs text-[#2e2c29] leading-relaxed">$1</li>');
    text = text.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="ml-4 list-decimal text-xs text-[#2e2c29] leading-relaxed">$2</li>');

    // 9. Process Paragraphs (double newlines)
    const paragraphs = text.split(/\n\n+/);
    text = paragraphs
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (
          trimmed.startsWith('<h1') ||
          trimmed.startsWith('<h2') ||
          trimmed.startsWith('<h3') ||
          trimmed.startsWith('<div') ||
          trimmed.startsWith('<blockquote') ||
          trimmed.startsWith('<hr') ||
          trimmed.startsWith('<li')
        ) {
          return trimmed;
        }
        return `<p class="my-2 leading-relaxed text-xs text-[#2e2c29]">${trimmed.replace(/\n/g, '<br/>')}</p>`;
      })
      .join('\n');

    return text;
  }, [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const pageEl = target.closest('[data-page]');
    if (pageEl && onPageClick) {
      const page = parseInt(pageEl.getAttribute('data-page') || '1', 10);
      onPageClick(page);
    }

    const blockEl = target.closest('[data-block]');
    if (blockEl && onBlockClick) {
      const block = parseInt(blockEl.getAttribute('data-block') || '1', 10);
      onBlockClick(block);
    }
  };

  return (
    <div
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
      className={`prose prose-sm max-w-none text-[#191817] ${className}`}
    />
  );
}
