'use client';

import React, { useMemo } from 'react';
import { renderAcademicMathHtml } from '../lib/academicProofing';

interface AcademicMathViewProps {
  content?: string | null;
  inline?: boolean;
  displayMode?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement | HTMLSpanElement>;
}

/**
 * AcademicMathView
 * 
 * Formats Markdown and LaTeX while preserving literal Lean and other code
 * into typeset KaTeX formulas and clean academic typography.
 */
export function AcademicMathView({
  content,
  inline = false,
  displayMode = false,
  className = '',
  onClick,
}: AcademicMathViewProps) {
  const html = useMemo(() => {
    if (!content) return '';
    return renderAcademicMathHtml(content, { inline, displayMode });
  }, [content, inline, displayMode]);

  if (!content) return null;

  if (inline) {
    return (
      <span
        onClick={onClick}
        className={`inline select-text ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div
      onClick={onClick}
      className={`prose prose-sm max-w-none text-[#191817] select-text ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default AcademicMathView;

