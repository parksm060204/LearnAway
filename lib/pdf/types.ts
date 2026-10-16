import type { MaterialPage } from '../types';

export type PdfConversionEngine = 'pdfjs' | 'pymupdf4llm';

export interface PdfConversionProgress {
  page: number;
  totalPages: number;
  percent: number;
  stage?: 'loading' | 'parsing' | 'rendering' | 'formatting';
}

export interface PdfConversionOptions {
  engine?: PdfConversionEngine;
  maxPages?: number;
  maxBytes?: number;
  onProgress?: (progress: PdfConversionProgress) => void;
  signal?: AbortSignal;
}

export interface PdfConversionWarning {
  code: 'MATH_FORMULA_DETECTED' | 'TABLE_DETECTED' | 'MULTI_COLUMN_DETECTED' | 'LOW_TEXT_DENSITY';
  message: string;
}

export interface PdfConversionResult {
  success: boolean;
  engine: PdfConversionEngine;
  engineVersion: string;
  hasText: boolean;
  pageCount: number;
  pages: MaterialPage[];
  fullMarkdown: string;
  markdown: string;
  originalHash: string;
  fileSize: number;
  code?: string;
  errorCode?: string;
  error?: string | null;
  warnings?: string[];
  needsReview?: boolean;
  reviewReason?: string;
}

export interface PdfServiceHealth {
  available: boolean;
  service?: string;
  engine?: string;
  version?: string;
  configured?: boolean;
  message?: string;
  maxPages?: number;
  maxBytes?: number;
  error?: string;
}
