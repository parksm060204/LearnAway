import { parseTranscript } from './transcriptParser';

export type MaterialTextKind = 'transcript' | 'handout';

export const MATERIAL_INPUT_LIMITS = {
  pdfBytes: 20 * 1024 * 1024,
  textBytes: 10 * 1024 * 1024,
} as const;

export type MaterialInputFile = { name: string; size: number };

export function validateMaterialInputFile(
  kind: 'pdf' | MaterialTextKind,
  file: MaterialInputFile
): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return '빈 파일은 등록할 수 없습니다.';
  const extension = file.name.toLowerCase().split('.').pop();
  if (kind === 'pdf') {
    if (extension !== 'pdf') return 'PDF 파일(.pdf)만 선택해 주세요.';
    if (file.size > MATERIAL_INPUT_LIMITS.pdfBytes) return 'PDF 파일은 20MB 이하만 등록할 수 있습니다.';
    return null;
  }
  if (extension !== 'txt' && extension !== 'md') return '텍스트 자료는 .txt 또는 .md 형식만 지원합니다.';
  if (file.size > MATERIAL_INPUT_LIMITS.textBytes) return '텍스트 자료는 10MB 이하만 등록할 수 있습니다.';
  return null;
}

export function validateMaterialText(text: string): string | null {
  if (!text.trim()) return '빈 텍스트는 자료로 등록할 수 없습니다.';
  if (text.includes('\u0000')) return '텍스트에 읽을 수 없는 바이너리 데이터가 포함되어 있습니다.';
  if (new TextEncoder().encode(text).byteLength > MATERIAL_INPUT_LIMITS.textBytes) {
    return '텍스트 자료는 10MB 이하만 등록할 수 있습니다.';
  }
  return null;
}

export function parseMaterialText(
  kind: MaterialTextKind,
  text: string,
  fallbackTitle: string
): {
  rawText: string;
  markdown: string;
  speakers: string[];
  hasTimestamps: boolean;
  blockCount: number;
} {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (kind === 'handout') {
    return {
      rawText: normalized,
      markdown: normalized,
      speakers: [],
      hasTimestamps: false,
      blockCount: 0,
    };
  }
  const parsed = parseTranscript(normalized, fallbackTitle);
  return {
    rawText: parsed.rawText,
    markdown: parsed.markdown,
    speakers: parsed.speakers,
    hasTimestamps: parsed.hasTimestamps,
    blockCount: parsed.blocks.length,
  };
}

export function normalizeContentForComparison(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function findDuplicateMaterial(
  candidates: Array<{ id: string; title: string; parsedMarkdown?: string; rawText?: string }>,
  targetMarkdown: string,
  targetRawText?: string
): { id: string; title: string } | null {
  const normMd = normalizeContentForComparison(targetMarkdown || '');
  const normRaw = normalizeContentForComparison(targetRawText || '');
  if (!normMd && !normRaw) return null;

  for (const candidate of candidates) {
    const candidateMd = normalizeContentForComparison(candidate.parsedMarkdown || '');
    const candidateRaw = normalizeContentForComparison(candidate.rawText || '');
    if (normMd && candidateMd && normMd === candidateMd) {
      return { id: candidate.id, title: candidate.title };
    }
    if (normRaw && candidateRaw && normRaw === candidateRaw) {
      return { id: candidate.id, title: candidate.title };
    }
  }
  return null;
}
