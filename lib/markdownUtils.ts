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
