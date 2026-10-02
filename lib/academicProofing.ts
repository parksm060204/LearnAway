/**
 * Learn my way Academic Math & Logic Proofing Engine
 * 
 * Provides:
 * 1. Literal code display, including Lean 4 declarations and proofs
 * 2. Automatic detection and KaTeX wrapping of bare/unescaped LaTeX macros
 * 3. Normalization of double backslash serialization artifacts (\\frac -> \frac)
 * 4. Academic math typesetting and HTML rendering via KaTeX
 * 5. Clean display formatting for titles, prompts, hints, model answers, and feedbacks
 * 
 * Invariant: Internal data, calculations, and storage remain untouched;
 * this module strictly operates at the presentation and display layer.
 */

import katex from 'katex';

export function normalizeDoubleEscapes(str: string): string {
  if (!str) return '';
  // Convert double-escaped LaTeX macros e.g. \\frac -> \frac, \\int -> \int
  return str.replace(/\\\\([a-zA-Z{}()[\]_^\\])/g, '\\$1');
}

export function translateLeanTypesAndOperators(s: string): string {
  if (!s) return '';
  return s
    .replace(/\bNat\b/g, '\\mathbb{N}')
    .replace(/\bReal\b/g, '\\mathbb{R}')
    .replace(/\bInt\b/g, '\\mathbb{Z}')
    .replace(/\bComplex\b/g, '\\mathbb{C}')
    .replace(/\bRat\b/g, '\\mathbb{Q}')
    .replace(/\bBool\b/g, '\\text{Bool}')
    .replace(/\bProp\b/g, '\\text{Prop}')
    .replace(/<->|↔/g, ' \\iff ')
    .replace(/->|→/g, ' \\to ')
    .replace(/\/\\|∧/g, ' \\land ')
    .replace(/\\\/|∨/g, ' \\lor ')
    .replace(/~|¬/g, ' \\neg ')
    .replace(/\bforall\b|∀/g, ' \\forall ')
    .replace(/\bexists\b|∃/g, ' \\exists ')
    .replace(/!=|≠/g, ' \\neq ')
    .replace(/<=|≤/g, ' \\le ')
    .replace(/>=|≥/g, ' \\ge ')
    .replace(/:=/g, ' \\coloneqq ');
}

export interface ParsedLeanBlock {
  kind: string;
  name: string;
  condition: string;
  statement: string;
  fullFormula: string;
  proof: string;
}

export function parseLeanDeclaration(leanCode: string): ParsedLeanBlock | null {
  const clean = leanCode.trim();
  const headMatch = clean.match(/^(theorem|lemma|def|example|axiom)\s+([a-zA-Z0-9_']+)?\s*/);
  if (!headMatch) return null;

  const kind = headMatch[1];
  const name = headMatch[2] || '';
  const rest = clean.slice(headMatch[0].length);

  const assignIdx = rest.indexOf(':=');
  const signature = assignIdx >= 0 ? rest.slice(0, assignIdx) : rest;
  const proof = assignIdx >= 0 ? rest.slice(assignIdx + 2) : '';

  let depth = 0;
  let colonIdx = -1;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0) {
      colonIdx = i;
      break;
    }
  }

  const rawParams = colonIdx >= 0 ? signature.slice(0, colonIdx).trim() : '';
  const statement = colonIdx >= 0 ? signature.slice(colonIdx + 1).trim() : signature.trim();

  const conditions: string[] = [];
  if (rawParams && rawParams.trim()) {
    const paramRegex = /\(([^:]+):\s*([^\)]+)\)/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = paramRegex.exec(rawParams)) !== null) {
      const vars = pMatch[1].trim();
      const type = translateLeanTypesAndOperators(pMatch[2].trim());
      conditions.push(`${vars} \\in ${type}`);
    }
  }

  const kindLabel =
    kind === 'theorem'
      ? '정리 (Theorem)'
      : kind === 'lemma'
      ? '보조정리 (Lemma)'
      : kind === 'def'
      ? '정의 (Definition)'
      : kind === 'example'
      ? '예제 (Example)'
      : '공리 (Axiom)';

  const mathStatement = translateLeanTypesAndOperators(statement.trim());
  const conditionFormula = conditions.length > 0 ? conditions.join(',\\; ') : '';
  const fullFormula = conditionFormula ? `\\forall ${conditionFormula},\\quad ${mathStatement}` : mathStatement;

  let proofClean = '';
  if (proof) {
    const pTrim = proof.trim().replace(/^by\s+/, '').trim();
    if (pTrim === 'sorry') {
      proofClean = '증명 생략 (sorry)';
    } else {
      proofClean = pTrim;
    }
  }

  return {
    kind: kindLabel,
    name,
    condition: conditionFormula,
    statement: mathStatement,
    fullFormula,
    proof: proofClean,
  };
}

/**
 * Proofreads and normalizes raw text containing Lean code, bare LaTeX,
 * or Markdown into clean Markdown with math delimiters, preserving code and explicit formulas.
 */
export function proofreadAcademicText(text: string): string {
  if (!text) return '';
  // Transform prose only. Code and explicitly delimited mathematics are literal.
  const protectedPattern = /```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^\$\n]+\$/g;
  let cursor = 0;
  let output = '';
  for (const match of text.matchAll(protectedPattern)) {
    output += proofreadAcademicSegment(text.slice(cursor, match.index));
    output += match[0];
    cursor = match.index! + match[0].length;
  }
  return output + proofreadAcademicSegment(text.slice(cursor));
}

function proofreadAcademicSegment(text: string): string {
  let res = normalizeDoubleEscapes(text);
  // 3. Protect existing display and inline math
  const preservedMath: string[] = [];
  res = res.replace(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g, (m) => {
    preservedMath.push(m);
    return `__PRESERVED_MATH_${preservedMath.length - 1}__`;
  });

  // 4. Protect code fences and inline code
  const preservedCode: string[] = [];
  res = res.replace(/(```[\s\S]*?```|`[^`\n]+?`)/g, (m) => {
    preservedCode.push(m);
    return `__PRESERVED_CODE_${preservedCode.length - 1}__`;
  });

  // 5. Detect Step-by-Step Derivation lines starting with '='
  // e.g. "= \int_{-\infty}^\infty g(x) f_X(x) dx"
  res = res.replace(/^(\s*=\s*.*)$/gm, (match) => {
    const trimmed = match.trim();
    if (trimmed.length > 2) {
      return `$$${trimmed}$$`;
    }
    return match;
  });

  // 6. Detect Bare LaTeX math expressions
  // e.g. \frac{a}{b}, \int_{-\infty}^\infty ..., \mu_Y + \rho \frac{\sigma_Y}{\sigma_X} (x - \mu_X)
  const latexMacro = '\\\\[a-zA-Z]+';
  const mathChars = '[a-zA-Z0-9+\\-*/=<>~|_.,;()\\[\\]\\^\\s\\{\\}]';
  const bareMathRegex = new RegExp(
    `((?:${mathChars}|${latexMacro})*?${latexMacro}(?:\\{[^\\}]*\\})*(?:${mathChars}|${latexMacro})*)`,
    'g'
  );

  res = res.replace(bareMathRegex, (match) => {
    let clean = match.trim();
    // Strip trailing Korean particle boundary punctuation
    clean = clean.replace(/[,;.]\s*$/, '').trim();
    if (!clean) return match;
    // Must contain an actual LaTeX command
    if (!clean.includes('\\')) return match;
    return `$${clean}$`;
  });

  // 7. Detect isolated Expectation / Probability equations like E[E[Y|X]] = E[Y]
  const nestedBracketPattern = 'E\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]';
  const expEquationRegex = new RegExp(`(${nestedBracketPattern}\\s*=\\s*(?:${nestedBracketPattern}|[a-zA-Z0-9_]+))`, 'g');
  res = res.replace(expEquationRegex, '$$$1$$');
  res = res.replace(/\b(g\(x\)\s*=\s*E\[[^\]]+\])/g, '$$$1$$');

  // 8. Restore preserved math and code
  res = res.replace(/__PRESERVED_CODE_(\d+)__/g, (_, idx) => preservedCode[Number(idx)]);
  res = res.replace(/__PRESERVED_MATH_(\d+)__/g, (_, idx) => preservedMath[Number(idx)]);

  return res;
}

export function escapeAcademicHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface RenderAcademicMathOptions {
  inline?: boolean;
  displayMode?: boolean;
  throwOnError?: boolean;
  sourceAnchors?: boolean;
}

/**
 * Safely renders a LaTeX math string with KaTeX
 */
export function safeRenderKaTeX(math: string, displayMode: boolean = false): string {
  try {
    const clean = math.trim();
    return katex.renderToString(clean, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch (e) {
    console.warn('KaTeX render error:', e);
    return `<span class="font-academic-mono text-xs bg-amber-50 text-amber-900 px-1 py-0.5 rounded border border-amber-200">${escapeAcademicHtml(math)}</span>`;
  }
}

/**
 * Converts academic text (with Lean, LaTeX, and Markdown) into styled HTML with KaTeX formulas.
 */
export function renderAcademicMathHtml(
  content: string,
  options: RenderAcademicMathOptions = {}
): string {
  if (!content) return '';

  const { inline = false, displayMode = false } = options;

  // If displayMode is requested on a single equation string without markdown
  if (displayMode && !content.includes('\n\n') && !content.startsWith('#')) {
    const stripped = content.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([^\$]+)\$$/, '$1');
    return safeRenderKaTeX(stripped, true);
  }

  // 1. Proofread and normalize syntax
  let text = proofreadAcademicText(content);

  const fragments: string[] = [];
  let marker = 'ACADEMICFRAGMENT';
  while (text.includes(marker)) marker += 'X';
  const preserve = (html: string) => {
    fragments.push(html);
    return `${marker}${fragments.length - 1}END`;
  };
  const restore = (value: string) => value.replace(new RegExp(`${marker}(\\d+)END`, 'g'), (_, idx) => fragments[Number(idx)]);
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, language, code) =>
    preserve(`<pre class="my-2 overflow-x-auto"><code data-language="${escapeAcademicHtml(language.trim())}">${escapeAcademicHtml(code)}</code></pre>`));
  text = text.replace(/`([^`\n]+)`/g, (_, code) => preserve(`<code>${escapeAcademicHtml(code)}</code>`));
  if (options.sourceAnchors) {
    text = text.replace(/<!--\s*\[PAGE\s+(\d+)\]\s*-->/gi, (_, page) =>
      preserve(`<div class="my-3"><button type="button" class="text-xs text-[#c52828]" data-page="${page}">§ 원본 PDF 제${page}페이지</button></div>`));
    text = text.replace(/<!--\s*\[발화\s+#?(\d+)\]\s*-->/gi, (_, block) =>
      preserve(`<div class="my-3"><button type="button" class="text-xs text-indigo-700" data-block="${block}">§ 발화 #${block}</button></div>`));
  }

  // 2. Process Display Math: $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, equation) => {
    return preserve(`<div class="my-3 py-2 px-3 bg-[#faf8f5] border border-[#e8e4dc] rounded text-center overflow-x-auto select-text">${safeRenderKaTeX(
      equation,
      true
    )}</div>`);
  });

  // 3. Process Inline Math: $...$
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, equation) => {
    return preserve(safeRenderKaTeX(equation, false));
  });

  text = escapeAcademicHtml(text);

  // If inline rendering is requested, strip headings, lists, blockquotes and only keep bold/italic
  if (inline) {
    text = text.replace(/^#+\s+/gm, '');
    text = text.replace(/^&gt;\s*/gm, '');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/\n+/g, ' ');
    return restore(text.trim());
  }

  // 4. Headings
  text = text.replace(/^### (.*$)/gim, '<h3 class="text-sm font-bold font-serif text-[#191817] mt-3 mb-1.5">$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2 class="text-base font-bold font-serif text-[#191817] mt-4 mb-2 pb-1 border-b border-[#e2ded6]">$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1 class="text-lg font-bold font-serif text-[#191817] mt-2 mb-3 pb-1 border-b-2 border-[#191817]">$1</h1>');

  // 5. Blockquotes
  text = text.replace(/^&gt;\s?(.*$)/gim, '<blockquote class="border-l-3 border-[#c52828] pl-3 py-1 my-2 bg-[#fdfcfb] text-[#33302b] italic text-xs leading-relaxed">$1</blockquote>');

  // 6. Bold and Italic
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-[#191817]">$1</strong>');
  text = text.replace(/\*(.*?)\*/g, '<em class="text-[#57544e]">$1</em>');

  // 7. Horizontal Rules
  text = text.replace(/^---$/gim, '<hr class="my-3 border-[#e2ded6]" />');

  // 8. Lists
  text = text.replace(/^\s*-\s+(.*$)/gim, '<li class="ml-4 list-disc text-xs text-[#2e2c29] leading-relaxed">$1</li>');
  text = text.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="ml-4 list-decimal text-xs text-[#2e2c29] leading-relaxed">$2</li>');

  // 9. Paragraphs
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
      return `<p class="my-1.5 leading-relaxed text-xs text-[#2e2c29]">${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return restore(text);
}

/**
 * Strips raw markdown syntax for single-line badges/titles while preserving math formulas.
 */
export function cleanDisplayTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^#+\s*/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

