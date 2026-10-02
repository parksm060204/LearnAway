'use client';

import React, { useMemo } from 'react';
import { renderAcademicMathHtml } from '../lib/academicProofing';

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
  const renderedHtml = useMemo(() => renderAcademicMathHtml(content, { sourceAnchors: true }), [content]);

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

