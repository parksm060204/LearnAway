import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 250;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_CONVERSIONS = 2;
let activeConversions = 0;

async function readBoundedFormData(req: NextRequest): Promise<FormData> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) throw new Error('UPLOAD_TOO_LARGE');
  if (!req.body) throw new Error('EMPTY_BODY');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new Error('UPLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const replay = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: body.buffer as ArrayBuffer,
  });
  return replay.formData();
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    return NextResponse.json({ success: false, code: 'CONVERSION_BUSY', error: 'PDF 변환 작업이 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }
  activeConversions += 1;

  let tempFilePath: string | null = null;
  try {
    const formData = await readBoundedFormData(req);
    const candidate = formData.get('file');
    if (!(candidate instanceof File) || candidate.size === 0) {
      return NextResponse.json({ success: false, code: 'PDF_REQUIRED', error: '변환할 PDF 파일을 선택해 주세요.' }, { status: 400 });
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ success: false, code: 'PDF_TOO_LARGE', error: 'PDF는 20MB 이하만 변환할 수 있습니다.' }, { status: 413 });
    }
    if (!candidate.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ success: false, code: 'PDF_EXTENSION_INVALID', error: 'PDF 파일(.pdf)만 변환할 수 있습니다.' }, { status: 415 });
    }

    const buffer = Buffer.from(await candidate.arrayBuffer());
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ success: false, code: 'PDF_SIGNATURE_INVALID', error: '파일 내용이 올바른 PDF 형식이 아닙니다.' }, { status: 415 });
    }

    tempFilePath = path.join(os.tmpdir(), `learnaway-pdf-${randomUUID()}.pdf`);
    await fs.writeFile(tempFilePath, buffer, { flag: 'wx', mode: 0o600 });
    const scriptPath = path.join(process.cwd(), 'scripts', 'convert_pdf.py');
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';

    const result = await new Promise<{
      success: boolean;
      hasText: boolean;
      pageCount: number;
      pages: { pageNumber: number; markdown: string; hasText: boolean }[];
      fullMarkdown: string;
      error?: string | null;
      code?: string;
    }>((resolve, reject) => {
      const child = spawn(pythonCmd, [scriptPath, tempFilePath!, String(MAX_PDF_PAGES)], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdoutData = '';
      let stderrData = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.signal.removeEventListener('abort', onAbort);
        action();
      };
      const failWorker = (code: string) => {
        if (settled) return;
        child.kill('SIGKILL');
        finish(() => reject(new Error(code)));
      };
      const onAbort = () => failWorker('CLIENT_ABORTED');
      const timer = setTimeout(() => failWorker('CONVERSION_TIMEOUT'), CONVERSION_TIMEOUT_MS);
      req.signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          failWorker('OUTPUT_TOO_LARGE');
          return;
        }
        stdoutData += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes < MAX_STDERR_BYTES) {
          const remaining = MAX_STDERR_BYTES - stderrBytes;
          const clipped = chunk.subarray(0, remaining);
          stderrData += clipped.toString('utf-8');
          stderrBytes += clipped.byteLength;
        }
      });
      child.on('error', () => finish(() => reject(new Error('PYTHON_UNAVAILABLE'))));
      child.on('close', () => finish(() => {
        try {
          if (!stdoutData.trim()) {
            reject(new Error(stderrData ? 'CONVERSION_FAILED' : 'PYTHON_NO_OUTPUT'));
            return;
          }
          resolve(JSON.parse(stdoutData.trim()));
        } catch {
          reject(new Error('CONVERSION_INVALID_OUTPUT'));
        }
      }));
    });

    if (!result.success) {
      const status = result.code === 'PDF_PAGE_LIMIT' ? 413 : 422;
      return NextResponse.json({
        success: false,
        code: result.code ?? 'PDF_TEXT_EXTRACTION_FAILED',
        hasText: result.hasText,
        pageCount: result.pageCount,
        pages: result.pages,
        fullMarkdown: '',
        error: result.code === 'PDF_PAGE_LIMIT'
          ? `PDF는 ${MAX_PDF_PAGES}페이지 이하만 변환할 수 있습니다.`
          : result.error || 'PDF에서 텍스트를 추출하지 못했습니다. 원본을 확인해 주세요.',
      }, { status });
    }
    if (!Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > MAX_PDF_PAGES ||
        !Array.isArray(result.pages) || result.pages.length !== result.pageCount || result.fullMarkdown.length > MAX_OUTPUT_BYTES) {
      return NextResponse.json({ success: false, code: 'CONVERSION_OUTPUT_INVALID', error: '변환 결과를 검증하지 못했습니다.' }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CONVERSION_FAILED';
    const tooLarge = code === 'UPLOAD_TOO_LARGE';
    const timedOut = code === 'CONVERSION_TIMEOUT';
    const unavailable = code === 'PYTHON_UNAVAILABLE';
    const status = tooLarge ? 413 : timedOut ? 504 : unavailable ? 503 : 500;
    const message = tooLarge
      ? 'PDF 업로드는 20MB 이하만 허용됩니다.'
      : timedOut
        ? 'PDF 변환 시간이 제한을 넘었습니다. 파일을 줄여 다시 시도해 주세요.'
        : unavailable
          ? 'PDF 변환 기능이 현재 서버에 준비되지 않았습니다.'
          : code === 'CLIENT_ABORTED'
            ? '요청이 취소되었습니다.'
            : 'PDF를 변환하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요.';
    return NextResponse.json({ success: false, code, error: message }, { status });
  } finally {
    activeConversions = Math.max(0, activeConversions - 1);
    if (tempFilePath) {
      try { await fs.unlink(tempFilePath); } catch { /* Best-effort cleanup; path is unique and outside the workspace. */ }
    }
  }
}
