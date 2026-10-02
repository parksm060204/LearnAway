'use client';

import React from 'react';
import { safeRenderKaTeX, proofreadAcademicText, parseLeanDeclaration } from '../lib/academicProofing';

interface MathFormulaProps {
  math: string;
  displayMode?: boolean;
  className?: string;
}

export function MathFormula({ math, displayMode = false, className = '' }: MathFormulaProps) {
  if (!math) return null;

  const leanParsed = parseLeanDeclaration(math);
  const targetMath = leanParsed
    ? leanParsed.fullFormula
    : proofreadAcademicText(math.trim().replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([^\$]+)\$$/, '$1')).replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([^\$]+)\$$/, '$1');
  const html = safeRenderKaTeX(targetMath, displayMode);

  return (
    <span
      className={`inline-block ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
