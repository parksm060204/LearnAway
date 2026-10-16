import type { MaterialPage } from '../types';
import type {
  PdfConversionOptions,
  PdfConversionResult,
} from './types';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_PDF_PAGES = 250;
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

const MATH_SYMBOLS_REGEX = /[∑∫√αβγδθλμπσφω∂∇≤≥≠≈±×÷∈∉⊂⊆∪∩∀∃→⇒⇔∞]/;

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
}

interface FormattedLine {
  y: number;
  height: number;
  text: string;
  isHeading: boolean;
  headingLevel?: number;
  isListItem: boolean;
}

/**
 * Computes SHA-256 hex digest of an ArrayBuffer in the browser.
 */
async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback simple hash if subtle crypto is unavailable
  let hash = 0;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash * 31 + bytes[i]) >>> 0;
  }
  return `h_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Reconstructs layout lines from raw PDF.js text items using spatial coordinates.
 */
function reconstructPageMarkdown(
  items: RawTextItem[],
  pageWidth: number
): { markdown: string; hasMath: boolean; hasTable: boolean; isMultiColumn: boolean } {
  if (items.length === 0) {
    return { markdown: '', hasMath: false, hasTable: false, isMultiColumn: false };
  }

  // 1. Detect math characters
  let hasMath = false;
  for (const item of items) {
    if (MATH_SYMBOLS_REGEX.test(item.str)) {
      hasMath = true;
      break;
    }
  }

  // 2. Detect multi-column heuristic
  const midX = pageWidth / 2;
  let leftCount = 0;
  let rightCount = 0;
  for (const it of items) {
    if (it.x + it.width < midX) leftCount++;
    else if (it.x > midX) rightCount++;
  }
  const isMultiColumn = leftCount > 15 && rightCount > 15 && Math.abs(leftCount - rightCount) < (leftCount + rightCount) * 0.6;

  // 3. Compute median font size across the page
  const fontSizes = items.map((it) => it.fontSize).filter((sz) => sz > 0).sort((a, b) => a - b);
  const medianFontSize = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 12;

  // 4. Sort items top-to-bottom (PDF y is inverted: top has higher y), then left-to-right (x ascending)
  // If multi-column is detected, we process column-by-column
  let sortedItems: RawTextItem[];
  if (isMultiColumn) {
    const leftCol = items.filter((it) => it.x < midX);
    const rightCol = items.filter((it) => it.x >= midX);
    const sortCol = (colItems: RawTextItem[]) =>
      [...colItems].sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > Math.min(a.height, b.height) * 0.4) {
          return yDiff;
        }
        return a.x - b.x;
      });
    sortedItems = [...sortCol(leftCol), ...sortCol(rightCol)];
  } else {
    sortedItems = [...items].sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > Math.min(a.height, b.height) * 0.4) {
        return yDiff;
      }
      return a.x - b.x;
    });
  }

  // 5. Group items into lines
  const lines: FormattedLine[] = [];
  let currentLineItems: RawTextItem[] = [];
  let currentLineY = sortedItems[0].y;
  let currentLineHeight = sortedItems[0].height;

  for (const item of sortedItems) {
    const yTolerance = Math.max(item.height, currentLineHeight) * 0.45;
    if (Math.abs(item.y - currentLineY) <= yTolerance) {
      currentLineItems.push(item);
      currentLineHeight = Math.max(currentLineHeight, item.height);
    } else {
      // Finalize previous line
      lines.push(buildLine(currentLineItems, currentLineY, currentLineHeight, medianFontSize));
      currentLineItems = [item];
      currentLineY = item.y;
      currentLineHeight = item.height;
    }
  }
  if (currentLineItems.length > 0) {
    lines.push(buildLine(currentLineItems, currentLineY, currentLineHeight, medianFontSize));
  }

  // 6. Detect potential tabular rows
  let hasTable = false;
  let alignedRowsCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1].text;
    const curr = lines[i].text;
    if (prev.includes('\t') && curr.includes('\t')) {
      alignedRowsCount++;
      if (alignedRowsCount >= 2) hasTable = true;
    }
  }

  // 7. Group lines into paragraphs with vertical spacing
  const paragraphs: string[] = [];
  let currentPara: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.isHeading) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
      }
      const prefix = '#'.repeat(line.headingLevel || 2);
      paragraphs.push(`${prefix} ${line.text}`);
      continue;
    }

    if (line.isListItem) {
      if (currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
      }
      paragraphs.push(line.text);
      continue;
    }

    if (i > 0) {
      const prevLine = lines[i - 1];
      const gap = prevLine.y - line.y;
      const normalGap = Math.max(prevLine.height, line.height) * 1.5;
      if (gap > normalGap && currentPara.length > 0) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
      }
    }

    // Handle end-of-line hyphenation (e.g. "com-", "puter")
    if (currentPara.length > 0 && currentPara[currentPara.length - 1].endsWith('-')) {
      const last = currentPara.pop()!;
      currentPara.push(last.slice(0, -1) + line.text);
    } else {
      currentPara.push(line.text);
    }
  }

  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '));
  }

  return {
    markdown: paragraphs.join('\n\n').trim(),
    hasMath,
    hasTable,
    isMultiColumn,
  };
}

/**
 * Builds a single line string from sorted line items, inserting spaces where gaps occur.
 */
function buildLine(
  items: RawTextItem[],
  y: number,
  height: number,
  medianFontSize: number
): FormattedLine {
  items.sort((a, b) => a.x - b.x);

  let lineText = '';
  let prevRight = -1;
  let maxFontSize = 0;

  for (const item of items) {
    maxFontSize = Math.max(maxFontSize, item.fontSize);
    if (prevRight >= 0) {
      const gap = item.x - prevRight;
      const spaceWidth = (item.fontSize || medianFontSize) * 0.25;
      if (gap > spaceWidth * 2.5) {
        lineText += '\t'; // Tab for potential columns
      } else if (gap > spaceWidth * 0.5) {
        lineText += ' ';
      }
    }
    lineText += item.str;
    prevRight = item.x + item.width;
  }

  const trimmed = lineText.trim();
  const isHeading = maxFontSize >= medianFontSize * 1.3 && trimmed.length < 100 && !trimmed.endsWith('.');
  const headingLevel = maxFontSize >= medianFontSize * 1.7 ? 1 : maxFontSize >= medianFontSize * 1.4 ? 2 : 3;
  const isListItem = /^[•\-*]\s+|^\d+\.\s+/.test(trimmed);

  return {
    y,
    height,
    text: trimmed,
    isHeading,
    headingLevel,
    isListItem,
  };
}

/**
 * Validates a PDF file buffer for magic signature (%PDF-), size, and format.
 */
export function validatePdfBuffer(buffer: ArrayBuffer, maxBytes = MAX_PDF_BYTES): { ok: true } | { ok: false; code: string; error: string } {
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, code: 'PDF_EMPTY', error: '변환할 PDF 파일이 비어 있습니다.' };
  }
  if (buffer.byteLength > maxBytes) {
    const mbLimit = (maxBytes / (1024 * 1024)).toFixed(0);
    return { ok: false, code: 'PDF_TOO_LARGE', error: `PDF 파일 크기가 허용 범위(${mbLimit}MB)를 초과했습니다.` };
  }
  if (buffer.byteLength < 5) {
    return { ok: false, code: 'PDF_SIGNATURE_INVALID', error: '올바른 PDF 형식이 아닙니다 (시그니처 누락).' };
  }

  const bytes = new Uint8Array(buffer.slice(0, 5));
  for (let i = 0; i < PDF_MAGIC_BYTES.length; i++) {
    if (bytes[i] !== PDF_MAGIC_BYTES[i]) {
      return { ok: false, code: 'PDF_SIGNATURE_INVALID', error: '파일 확장자 또는 내용이 올바른 PDF 형식이 아닙니다.' };
    }
  }

  return { ok: true };
}

/**
 * Converts a PDF file in the browser using PDF.js without sending any bytes to a server.
 *
 * Guarantees:
 * - 100% Client-side execution (zero network egress).
 * - Sequential page processing with cleanup to prevent memory bloat.
 * - Strict cancellation support via AbortSignal.
 * - Spatial coordinate analysis for heading, list, and line reconstruction.
 * - Accurate detection of empty/scanned documents without extractable text.
 */
export async function convertPdfInBrowser(
  fileOrBuffer: File | Blob | ArrayBuffer,
  options: PdfConversionOptions = {}
): Promise<PdfConversionResult> {
  if (typeof window === 'undefined') {
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: 'unknown',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash: '',
      fileSize: 0,
      code: 'SSR_NOT_SUPPORTED',
      errorCode: 'SSR_NOT_SUPPORTED',
      error: '브라우저 PDF.js 변환기는 클라이언트 환경에서만 실행할 수 있습니다.',
    };
  }

  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  const signal = options.signal;

  let buffer: ArrayBuffer;
  let fileSize = 0;
  if (fileOrBuffer instanceof ArrayBuffer) {
    buffer = fileOrBuffer;
    fileSize = buffer.byteLength;
  } else {
    fileSize = fileOrBuffer.size;
    buffer = await fileOrBuffer.arrayBuffer();
  }

  // Pre-flight signature & size validation
  const validation = validatePdfBuffer(buffer, maxBytes);
  if (!validation.ok) {
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: '4.10.38',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash: '',
      fileSize,
      code: validation.code,
      errorCode: validation.code,
      error: validation.error,
    };
  }

  if (signal?.aborted) {
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: '4.10.38',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash: '',
      fileSize,
      code: 'CONVERSION_ABORTED',
      errorCode: 'CONVERSION_ABORTED',
      error: 'PDF 변환이 사용자에 의해 취소되었습니다.',
    };
  }

  // Compute original document hash
  const originalHash = await computeSha256(buffer);

  // Dynamically import pdfjs-dist
  type PdfJsModule = typeof import('pdfjs-dist');
  let pdfjsLib: PdfJsModule;
  try {
    pdfjsLib = await import('pdfjs-dist');
  } catch (err) {
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: 'unknown',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash,
      fileSize,
      code: 'PDFJS_LOAD_FAILED',
      errorCode: 'PDFJS_LOAD_FAILED',
      error: `PDF.js 라이브러리를 로드하지 못했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    };
  }

  // Configure local worker
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const origin = window.location.origin;
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.min.mjs`;
    } catch {
      // Fallback
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }
  }

  type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;
  let pdfDoc: PdfDocument | null = null;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const abortHandler = () => {
    try {
      loadingTask.destroy();
    } catch {
      // ignore
    }
  };
  if (signal) {
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    options.onProgress?.({ page: 0, totalPages: 1, percent: 5, stage: 'loading' });
    pdfDoc = await loadingTask.promise;
  } catch (err: unknown) {
    const errorObj = err as { name?: string; message?: string };
    if (signal?.aborted) {
      return {
        success: false,
        engine: 'pdfjs',
        engineVersion: pdfjsLib.version || '4.10.38',
        hasText: false,
        pageCount: 0,
        pages: [],
        fullMarkdown: '',
        markdown: '',
        originalHash,
        fileSize,
        code: 'CONVERSION_ABORTED',
        errorCode: 'CONVERSION_ABORTED',
        error: 'PDF 변환이 취소되었습니다.',
      };
    }

    if (errorObj?.name === 'PasswordException') {
      return {
        success: false,
        engine: 'pdfjs',
        engineVersion: pdfjsLib.version || '4.10.38',
        hasText: false,
        pageCount: 0,
        pages: [],
        fullMarkdown: '',
        markdown: '',
        originalHash,
        fileSize,
        code: 'PDF_ENCRYPTED',
        errorCode: 'PDF_ENCRYPTED',
        error: '암호로 보호된 PDF 문서입니다. 암호를 해제한 후 다시 등록해 주세요.',
      };
    }

    if (errorObj?.name === 'InvalidPDFException') {
      return {
        success: false,
        engine: 'pdfjs',
        engineVersion: pdfjsLib.version || '4.10.38',
        hasText: false,
        pageCount: 0,
        pages: [],
        fullMarkdown: '',
        markdown: '',
        originalHash,
        fileSize,
        code: 'PDF_CORRUPT',
        errorCode: 'PDF_CORRUPT',
        error: '손상되었거나 올바르지 않은 PDF 파일입니다.',
      };
    }

    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: pdfjsLib.version || '4.10.38',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash,
      fileSize,
      code: 'PDF_PARSE_FAILED',
      errorCode: 'PDF_PARSE_FAILED',
      error: `PDF 문서를 열지 못했습니다: ${errorObj?.message || '알 수 없는 형식'}`,
    };
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }

  const totalPages = pdfDoc.numPages || 0;
  if (totalPages === 0) {
    try { await pdfDoc.destroy(); } catch {}
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: pdfjsLib.version || '4.10.38',
      hasText: false,
      pageCount: 0,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash,
      fileSize,
      code: 'PDF_EMPTY',
      errorCode: 'PDF_EMPTY',
      error: '페이지가 없는 빈 PDF 문서입니다.',
    };
  }

  if (totalPages > maxPages) {
    try { await pdfDoc.destroy(); } catch {}
    return {
      success: false,
      engine: 'pdfjs',
      engineVersion: pdfjsLib.version || '4.10.38',
      hasText: false,
      pageCount: totalPages,
      pages: [],
      fullMarkdown: '',
      markdown: '',
      originalHash,
      fileSize,
      code: 'PDF_PAGE_LIMIT',
      errorCode: 'PDF_PAGE_LIMIT',
      error: `PDF 페이지 수(${totalPages}쪽)가 허용 한도(${maxPages}쪽)를 초과했습니다.`,
    };
  }

  const pages: MaterialPage[] = [];
  const warnings: Set<string> = new Set();
  let totalExtractedLength = 0;

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (signal?.aborted) {
        return {
          success: false,
          engine: 'pdfjs',
          engineVersion: pdfjsLib.version || '4.10.38',
          hasText: false,
          pageCount: totalPages,
          pages: [],
          fullMarkdown: '',
          markdown: '',
          originalHash,
          fileSize,
          code: 'CONVERSION_ABORTED',
          errorCode: 'CONVERSION_ABORTED',
          error: 'PDF 변환이 취소되었습니다.',
        };
      }

      const percent = Math.min(95, Math.round((pageNum / totalPages) * 90) + 5);
      options.onProgress?.({
        page: pageNum,
        totalPages,
        percent,
        stage: 'parsing',
      });

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      const rawItems: RawTextItem[] = [];
      let rawPageText = '';

      for (const item of textContent.items) {
        if ('str' in item && typeof item.str === 'string') {
          const str = item.str;
          rawPageText += str + ' ';
          const transform = item.transform; // [scaleX, skewY, skewX, scaleY, tx, ty]
          const x = transform[4];
          const y = transform[5];
          const fontSize = Math.hypot(transform[0], transform[1]) || 12;
          rawItems.push({
            str,
            x,
            y,
            width: item.width || 0,
            height: item.height || fontSize,
            fontSize,
            fontName: item.fontName,
          });
        }
      }

      const { markdown, hasMath, hasTable, isMultiColumn } = reconstructPageMarkdown(
        rawItems,
        viewport.width
      );

      if (hasMath) {
        warnings.add('수식 기호가 포함되어 있습니다. 분수·첨자·특수기호의 Markdown 수식 표현을 검토해 주세요.');
      }
      if (hasTable) {
        warnings.add('표 또는 정렬된 데이터 열이 감지되었습니다. Markdown 표 서식을 검토해 주세요.');
      }
      if (isMultiColumn) {
        warnings.add('다단(2단 이상) 레이아웃이 감지되었습니다. 문단 읽기 순서를 확인해 주세요.');
      }

      const trimmedText = markdown.trim();
      totalExtractedLength += trimmedText.length;

      pages.push({
        pageNumber: pageNum,
        markdown,
        hasText: trimmedText.length > 0,
        rawText: rawPageText.trim(),
      });

      // Cleanup page resources to avoid memory leaks in the browser
      try {
        page.cleanup();
      } catch {
        // ignore
      }
    }
  } finally {
    try {
      await pdfDoc.destroy();
    } catch {
      // ignore
    }
  }

  // Construct combined markdown with standard page anchors
  const fullMarkdownParts = pages.map(
    (p) => `<!-- [PAGE ${p.pageNumber}] -->\n` + p.markdown
  );
  const fullMarkdown = fullMarkdownParts.join('\n\n').trim();

  const hasText = totalExtractedLength > 0;
  let needsReview = false;
  let reviewReason: string | undefined = undefined;

  if (!hasText) {
    needsReview = true;
    reviewReason = '스캔된 이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다 (OCR 미지원). 텍스트가 포함된 원본 PDF를 등록해 주세요.';
  } else if (totalExtractedLength < 30 * totalPages) {
    needsReview = true;
    warnings.add('페이지당 텍스트 추출량이 적습니다. 이미지 중심 문서인지 확인해 주세요.');
    reviewReason = '텍스트 추출 밀도가 낮아 원본 검토가 필요합니다.';
  }

  options.onProgress?.({
    page: totalPages,
    totalPages,
    percent: 100,
    stage: 'formatting',
  });

  return {
    success: hasText,
    engine: 'pdfjs',
    engineVersion: pdfjsLib.version || '4.10.38',
    hasText,
    pageCount: totalPages,
    pages,
    fullMarkdown,
    markdown: fullMarkdown,
    originalHash,
    fileSize,
    warnings: Array.from(warnings),
    needsReview,
    reviewReason,
    code: !hasText ? 'PDF_NO_TEXT' : undefined,
    errorCode: !hasText ? 'PDF_NO_TEXT' : undefined,
    error: !hasText ? reviewReason : null,
  };
}
