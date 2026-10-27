/**
 * Learn my way Academic Study Suite - Markdown & Citation Utilities
 * 
 * Provides:
 * 1. Deterministic hashing to track if source material has changed after extraction
 * 2. Intelligent chunking for long documents preserving page/speech context
 * 3. Server-side source citation verification
 */

import { ConceptEvidence } from './types';

/**
 * Universal deterministic FNV-1a 32-bit hash string representation
 */
export function computeMarkdownHash(content: string): string {
  if (!content) return 'empty_hash';
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `h_${hex}_l${content.length}`;
}

export type SourceMaterialStatus = 'identical' | 'changed' | 'unverifiable';

export interface SourceComparisonOutcome {
  status: SourceMaterialStatus;
  isOutdated: boolean;
  canVerify: boolean;
  sourceMarkdownHash: string;
  currentMarkdownHash?: string;
}

/**
 * Compares an analysis session's source markdown hash with the current markdown.
 * 
 * Strict invariants:
 * 1. Hashes compared MUST come from the same algorithm (computeMarkdownHash) and same input (markdown text).
 * 2. If the current markdown body is not present, status is 'unverifiable' (or 'changed' if client explicitly flags a differing hash).
 * 3. Never assume latest or clear review on unverifiable comparison alone.
 */
export function compareSourceMarkdown({
  sourceMarkdownHash,
  currentMarkdown,
  clientMarkdownHash,
}: {
  sourceMarkdownHash: string;
  currentMarkdown?: string | null;
  clientMarkdownHash?: string | null;
}): SourceComparisonOutcome {
  if (typeof currentMarkdown === 'string' && currentMarkdown.trim().length > 0) {
    const computed = computeMarkdownHash(currentMarkdown);
    const identical = computed === sourceMarkdownHash;
    return {
      status: identical ? 'identical' : 'changed',
      isOutdated: !identical,
      canVerify: true,
      sourceMarkdownHash,
      currentMarkdownHash: computed,
    };
  }

  // Current markdown body is not directly available to verify
  if (clientMarkdownHash && clientMarkdownHash !== sourceMarkdownHash) {
    // Client explicitly reported a changed markdown hash
    return {
      status: 'changed',
      isOutdated: true,
      canVerify: false,
      sourceMarkdownHash,
      currentMarkdownHash: clientMarkdownHash,
    };
  }

  // Neither verified body nor explicit changed hash: state is unverifiable
  return {
    status: 'unverifiable',
    isOutdated: false,
    canVerify: false,
    sourceMarkdownHash,
    currentMarkdownHash: clientMarkdownHash || undefined,
  };
}

export interface MarkdownChunk {
  chunkIndex: number;
  text: string;
  sourceContext: string;
}

/**
 * Splits a long markdown document into coherent chunks while preserving
 * page and speech block boundaries.
 */
export function chunkMarkdownForAnalysis(
  markdown: string,
  maxChunkChars: number = 4000
): MarkdownChunk[] {
  if (!markdown || markdown.length <= maxChunkChars) {
    return [
      {
        chunkIndex: 1,
        text: markdown || '',
        sourceContext: '전체 본문',
      },
    ];
  }

  // Check if document has page boundaries: <!-- [PAGE N] -->
  const hasPageMarkers = /<!--\s*\[PAGE\s+\d+\]\s*-->/i.test(markdown);
  // Check if document has speech block boundaries: <!-- [발화 #N] -->
  const hasSpeechMarkers = /<!--\s*\[발화\s+#?\d+\]\s*-->/i.test(markdown);

  if (hasPageMarkers) {
    const rawPages = markdown.split(/(?=<!--\s*\[PAGE\s+\d+\]\s*-->)/i);
    const chunks: MarkdownChunk[] = [];
    let currentChunkText = '';
    let currentPages: string[] = [];

    for (const pageSection of rawPages) {
      const pageMatch = pageSection.match(/<!--\s*\[PAGE\s+(\d+)\]\s*-->/i);
      const pageNum = pageMatch ? `p.${pageMatch[1]}` : '';

      if (currentChunkText.length + pageSection.length > maxChunkChars && currentChunkText.length > 0) {
        chunks.push({
          chunkIndex: chunks.length + 1,
          text: currentChunkText.trim(),
          sourceContext: currentPages.length > 0 ? currentPages.join(', ') : '페이지 구간',
        });
        currentChunkText = pageSection;
        currentPages = pageNum ? [pageNum] : [];
      } else {
        currentChunkText += (currentChunkText ? '\n\n' : '') + pageSection;
        if (pageNum) currentPages.push(pageNum);
      }
    }

    if (currentChunkText.trim()) {
      chunks.push({
        chunkIndex: chunks.length + 1,
        text: currentChunkText.trim(),
        sourceContext: currentPages.length > 0 ? currentPages.join(', ') : '페이지 구간',
      });
    }

    return chunks;
  }

  if (hasSpeechMarkers) {
    const rawBlocks = markdown.split(/(?=<!--\s*\[발화\s+#?\d+\]\s*-->)/i);
    const chunks: MarkdownChunk[] = [];
    let currentChunkText = '';
    let currentBlocks: string[] = [];

    for (const blockSection of rawBlocks) {
      const blockMatch = blockSection.match(/<!--\s*\[발화\s+#?(\d+)\]\s*-->/i);
      const blockId = blockMatch ? `#${blockMatch[1]}` : '';

      if (currentChunkText.length + blockSection.length > maxChunkChars && currentChunkText.length > 0) {
        chunks.push({
          chunkIndex: chunks.length + 1,
          text: currentChunkText.trim(),
          sourceContext: currentBlocks.length > 0 ? `발화 ${currentBlocks[0]}~${currentBlocks[currentBlocks.length - 1]}` : '발화 구간',
        });
        currentChunkText = blockSection;
        currentBlocks = blockId ? [blockId] : [];
      } else {
        currentChunkText += (currentChunkText ? '\n\n' : '') + blockSection;
        if (blockId) currentBlocks.push(blockId);
      }
    }

    if (currentChunkText.trim()) {
      chunks.push({
        chunkIndex: chunks.length + 1,
        text: currentChunkText.trim(),
        sourceContext: currentBlocks.length > 0 ? `발화 ${currentBlocks[0]}~${currentBlocks[currentBlocks.length - 1]}` : '발화 구간',
      });
    }

    return chunks;
  }

  // Fallback: split by double newlines / headers
  const paragraphs = markdown.split(/\n\n+/);
  const chunks: MarkdownChunk[] = [];
  let currentChunkText = '';

  for (const para of paragraphs) {
    if (currentChunkText.length + para.length > maxChunkChars && currentChunkText.length > 0) {
      chunks.push({
        chunkIndex: chunks.length + 1,
        text: currentChunkText.trim(),
        sourceContext: `구간 ${chunks.length + 1}`,
      });
      currentChunkText = para;
    } else {
      currentChunkText += (currentChunkText ? '\n\n' : '') + para;
    }
  }

  if (currentChunkText.trim()) {
    chunks.push({
      chunkIndex: chunks.length + 1,
      text: currentChunkText.trim(),
      sourceContext: `구간 ${chunks.length + 1}`,
    });
  }

  return chunks;
}

/**
 * Normalizes text for fuzzy containment checking:
 * removes whitespace, markdown punctuation, lowercases
 */
function normalizeForComparison(str?: string | null): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[\s\r\n\t_#*`$|>-]+/g, '')
    .toLowerCase();
}

/**
 * Rigorously verifies whether an AI-extracted citation actually exists
 * in the source Markdown.
 */
export function verifySourceCitation(
  markdown: string,
  evidence: ConceptEvidence
): { verified: boolean; verificationNote: string } {
  if (!markdown) {
    return {
      verified: false,
      verificationNote: '원문 Markdown 본문이 비어있어 인용 검증 불가',
    };
  }

  const normalizedMarkdown = normalizeForComparison(markdown);
  const normalizedQuote = evidence.quote ? normalizeForComparison(evidence.quote) : '';

  // Check 1: Quote containment (if quote is provided)
  const hasQuoteMatch = Boolean(
    normalizedQuote &&
      normalizedQuote.length >= 6 &&
      normalizedMarkdown.includes(normalizedQuote)
  );

  // Check 2: Page reference containment (PDF)
  if (evidence.type === 'page' && evidence.pageNumber) {
    const pageMarker = `[page ${evidence.pageNumber}]`;
    const hasPageMarker = normalizedMarkdown.includes(normalizeForComparison(pageMarker));

    if (hasPageMarker && hasQuoteMatch) {
      return {
        verified: true,
        verificationNote: `제${evidence.pageNumber}페이지 원문 및 인용문 일치 검증 완료`,
      };
    } else if (hasPageMarker) {
      return {
        verified: true,
        verificationNote: `제${evidence.pageNumber}페이지 위치 확인됨 (인용구 요약 표기)`,
      };
    } else if (hasQuoteMatch) {
      return {
        verified: true,
        verificationNote: `인용문은 원문에서 확인되었으나 페이지 번호(${evidence.pageNumber}) 확인 필요`,
      };
    } else {
      return {
        verified: false,
        verificationNote: `제${evidence.pageNumber}페이지 또는 인용구를 원문에서 찾지 못함 (사용자 검토 필요)`,
      };
    }
  }

  // Check 3: Transcript block or timestamp reference
  if (evidence.type === 'transcript_block') {
    let anchorMatched = false;
    if (evidence.blockIndex) {
      const blockMarker = `[발화 #${evidence.blockIndex}]`;
      anchorMatched = normalizedMarkdown.includes(normalizeForComparison(blockMarker));
    }
    if (!anchorMatched && evidence.timestamp) {
      anchorMatched = normalizedMarkdown.includes(normalizeForComparison(evidence.timestamp));
    }

    if (anchorMatched && hasQuoteMatch) {
      return {
        verified: true,
        verificationNote: `전사본 ${evidence.timestamp || `발화 #${evidence.blockIndex}`} 원문 및 인용 일치 확인됨`,
      };
    } else if (anchorMatched) {
      return {
        verified: true,
        verificationNote: `전사본 위치(${evidence.timestamp || `발화 #${evidence.blockIndex}`}) 확인됨`,
      };
    } else if (hasQuoteMatch) {
      return {
        verified: true,
        verificationNote: '인용문은 확인되었으나 발화 번호/시각 위치 확인 필요',
      };
    } else {
      return {
        verified: false,
        verificationNote: '전사본 발화 위치 및 인용구를 원문에서 확인하지 못함 (사용자 검토 필요)',
      };
    }
  }

  // Fallback check
  if (hasQuoteMatch) {
    return {
      verified: true,
      verificationNote: '원문 인용구 일치 검증 완료',
    };
  }

  return {
    verified: false,
    verificationNote: '원문에서 인용구를 명확히 확인하지 못함 (사용자 검토 필요)',
  };
}

/**
 * Authoritative page grounding verification:
 * Checks whether an excerpt/quote actually maps to a specific page in the source material.
 *
 * Rules:
 * 1. AI model outputs (raw.sourceRefs / raw.sourcePage) are strictly rejected as grounding evidence.
 * 2. Scans for real page boundaries in markdown (<!-- page 3 -->, [Page 3], # Page 3, etc.).
 * 3. If a quote appears multiple times across DIFFERENT pages, returns undefined (ambiguous).
 * 4. If no page boundaries exist in markdown, accepts ONLY an isolated, single-page specification
 *    in the authoritative sourceRefs (e.g. "p. 15", "15쪽"). Ranges ("pp. 10-20", "10~15") and titles return undefined.
 * 5. Candidate page (if provided) must match the grounded page; otherwise returns undefined.
 */
export function verifyPageGrounding(
  paramsOrMarkdown: { markdown: string; quote: string; candidatePage?: string; sourceRefs?: string } | string,
  maybeQuote?: string,
  maybeCandidatePage?: string,
  maybeSourceRefs?: string
): string | undefined {
  let markdown: string;
  let quote: string;
  let candidatePage: string | undefined;
  let sourceRefs: string | undefined;

  if (typeof paramsOrMarkdown === 'object' && paramsOrMarkdown !== null) {
    markdown = paramsOrMarkdown.markdown || '';
    quote = paramsOrMarkdown.quote || '';
    candidatePage = paramsOrMarkdown.candidatePage;
    sourceRefs = paramsOrMarkdown.sourceRefs;
  } else {
    markdown = typeof paramsOrMarkdown === 'string' ? paramsOrMarkdown : '';
    quote = typeof maybeQuote === 'string' ? maybeQuote : '';
    candidatePage = maybeCandidatePage;
    sourceRefs = maybeSourceRefs;
  }

  const normQuote = quote.replace(/\s+/g, ' ').trim();
  if (!normQuote) return undefined;

  const PAGE_BOUNDARY_REGEX = /(?:<!--\s*page\s*(\d+)\s*-->|\[\s*(?:page|p\.?)\s*(\d+)(?:\/\d+)?\s*\]|^#+\s*(?:page|페이지)\s*(\d+)\b)/gim;
  const pageMarkers: { offset: number; page: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = PAGE_BOUNDARY_REGEX.exec(markdown)) !== null) {
    const pageNum = match[1] || match[2] || match[3];
    if (pageNum) {
      pageMarkers.push({ offset: match.index, page: pageNum });
    }
  }

  const normMarkdown = markdown.replace(/\s+/g, ' ');

  // Find ALL positions of normQuote in normMarkdown to detect duplicate quotes across multiple pages
  const quotePositions: number[] = [];
  let searchPos = 0;
  while (searchPos < normMarkdown.length) {
    const foundIdx = normMarkdown.indexOf(normQuote, searchPos);
    if (foundIdx === -1) break;
    quotePositions.push(foundIdx);
    searchPos = foundIdx + normQuote.length;
  }

  // Quote does not exist in markdown
  if (quotePositions.length === 0) return undefined;

  if (pageMarkers.length > 0) {
    // For each occurrence of the quote, determine which page marker it falls under
    const matchedPages = new Set<string>();

    for (const qPos of quotePositions) {
      let pageForThisOccurrence: string | undefined = undefined;
      for (const marker of pageMarkers) {
        const markerPos = markdown.slice(0, marker.offset).replace(/\s+/g, ' ').length;
        if (markerPos <= qPos) {
          pageForThisOccurrence = marker.page;
        } else {
          break;
        }
      }
      if (pageForThisOccurrence) {
        matchedPages.add(pageForThisOccurrence);
      }
    }

    // If quote exists on MULTIPLE distinct pages, do not arbitrarily pick the first one: return undefined!
    if (matchedPages.size > 1) {
      return undefined;
    }

    if (matchedPages.size === 1) {
      const confirmedPage = Array.from(matchedPages)[0];
      const cleanCandidate = (candidatePage || '').replace(/\D/g, '');
      if (cleanCandidate && cleanCandidate !== confirmedPage) {
        // Candidate page contradicts confirmed page in markdown -> reject
        return undefined;
      }
      return confirmedPage;
    }
    return undefined;
  }

  // 2. If no page boundaries exist in markdown:
  // Only accept if authoritative sourceRefs explicitly specifies an ISOLATED single page number.
  // Reject page ranges (e.g. "pp. 10-20", "10~15", "Chapter 3-4"), titles, or unverified claims.
  if (sourceRefs && typeof sourceRefs === 'string') {
    const trimmedRefs = sourceRefs.trim();
    // Range indicators must be rejected
    if (/[-~,]|to|pp\b|pp\./i.test(trimmedRefs)) {
      return undefined;
    }

    // Strict single page match (e.g. "p. 15", "p 15", "page 15", "15쪽", "15페이지")
    const singlePageMatch = /^(?:p\.?|page|쪽|페이지)?\s*([0-9]+)\s*(?:쪽|페이지)?$/i.exec(trimmedRefs);
    if (singlePageMatch && singlePageMatch[1]) {
      const extractedPage = singlePageMatch[1];
      const cleanCandidate = (candidatePage || '').replace(/\D/g, '');
      if (!cleanCandidate || cleanCandidate === extractedPage) {
        return extractedPage;
      }
    }
  }

  return undefined;
}

/**
 * Canonical JSON serializer for deterministic hashing across all platforms.
 * Recursively sorts object keys so identical objects produce identical serialized strings.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalizeJson(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(content: string): string {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto');
      return nodeCrypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }
  } catch {
    // fallback below
  }

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const utf8: number[] = [];
  for (let i = 0; i < content.length; i++) {
    let charcode = content.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (content.charCodeAt(i) & 0x3ff));
      utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    }
  }
  const bitLength = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length % 64) !== 56) utf8.push(0);
  for (let i = 56; i >= 0; i -= 8) {
    utf8.push(Math.floor(bitLength / Math.pow(2, i)) & 0xff);
  }
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i += 4) {
    words.push((utf8[i] << 24) | (utf8[i + 1] << 16) | (utf8[i + 2] << 8) | utf8[i + 3]);
  }
  const rot = (n: number, b: number) => (n >>> b) | (n << (32 - b));
  const W = new Array<number>(64);
  for (let i = 0; i < words.length; i += 16) {
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      if (j < 16) {
        W[j] = words[i + j];
      } else {
        const s0 = rot(W[j - 15], 7) ^ rot(W[j - 15], 18) ^ (W[j - 15] >>> 3);
        const s1 = rot(W[j - 2], 17) ^ rot(W[j - 2], 19) ^ (W[j - 2] >>> 10);
        W[j] = (W[j - 16] + s0 + W[j - 7] + s1) | 0;
      }
      const s1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[j] + W[j]) | 0;
      const s0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

/**
 * Strong, versioned SHA-256 identifier for AI task inputs, caching, and recovery.
 * Guarantees collision-resistance across arbitrary input lengths and structures.
 */
export function computeAiTaskInputIdentifier(input: unknown, version = 'v1'): string {
  const serialized = canonicalizeJson(input);
  const hex = sha256Hex(serialized);
  return `sha256_${version}_${hex}`;
}
