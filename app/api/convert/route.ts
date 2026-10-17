import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../lib/auth/apiAuth';
import { createAdminClient, hasAdminClientConfig } from '../../../lib/supabase/admin';
import { createPdfJobToken } from '../../../lib/pdf/token';
import { validateTempStoragePath, buildTempStoragePath } from '../../../lib/pdf/tempStorage';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;
const MAX_PDF_PAGES = 250;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_CONVERSIONS = 3;
let activeConversions = 0;

async function readBoundedFormData(req: NextRequest): Promise<FormData> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) throw new Error('UPLOAD_TOO_LARGE');
  if (!req.body) throw new Error('EMPTY_BODY');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
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
  try {
    return await replay.formData();
  } catch {
    throw new Error('FORM_DATA_INVALID');
  }
}

/**
 * Health check endpoint for precision conversion service.
 * Pings the external microservice if configured, without leaking credentials or internal paths.
 */
export async function GET() {
  const externalServiceUrl = (process.env.PDF_CONVERT_SERVICE_URL || '').trim().replace(/\/+$/, '');
  const serviceToken = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
  if (!externalServiceUrl || !serviceToken) {
    return NextResponse.json({
      available: false,
      configured: false,
      engine: 'unavailable',
      message: '정밀 변환 서버(PDF_CONVERT_SERVICE_URL) 또는 인증 토큰(PDF_CONVERT_SERVICE_TOKEN)이 구성되지 않았습니다. 기본 엔진인 "이 기기에서 변환 (브라우저 PDF.js)"을 사용할 수 있습니다.',
    });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const headers: Record<string, string> = {
      'X-Service-Token': serviceToken,
    };

    const res = await fetch(`${externalServiceUrl}/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const isAvailable = Boolean(data?.available && data?.ready);
      return NextResponse.json({
        available: isAvailable,
        configured: Boolean(data?.configured),
        engine: data?.engine || 'pymupdf4llm',
        version: data?.version || '1.1.0',
        maxPages: data?.maxPages || MAX_PDF_PAGES,
        message: isAvailable ? '정밀 변환 서버가 준비되어 있습니다.' : '정밀 변환 서버 의존성 또는 설정이 준비되지 않았습니다.',
      });
    }

    return NextResponse.json({
      available: false,
      configured: true,
      engine: 'unavailable',
      message: `정밀 변환 서버 상태 확인 실패 (HTTP ${res.status})`,
    });
  } catch (err) {
    return NextResponse.json({
      available: false,
      configured: true,
      engine: 'unavailable',
      message: `정밀 변환 서버와 통신할 수 없습니다: ${err instanceof Error ? err.message : '네트워크 오류'}`,
    });
  }
}

/**
 * PDF conversion route.
 * Handles both direct multipart uploads and Storage-backed ticket conversions.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const contentType = req.headers.get('content-type') || '';

  // --------------------------------------------------------------------------
  // JSON Request: Large PDF direct storage tickets & operations
  // --------------------------------------------------------------------------
  if (contentType.includes('application/json')) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, code: 'INVALID_JSON', error: '올바른 JSON 요청이 아닙니다.' }, { status: 400 });
    }

    const action = String(body.action || '');

    // Action 1: Create a secured temporary storage upload ticket
    if (action === 'create_storage_ticket') {
      const fileName = typeof body.fileName === 'string' ? body.fileName : 'document.pdf';
      const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;

      if (!fileName.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ success: false, code: 'PDF_EXTENSION_INVALID', error: 'PDF 파일(.pdf)만 등록할 수 있습니다.' }, { status: 415 });
      }
      if (fileSize > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ success: false, code: 'PDF_TOO_LARGE', error: 'PDF는 20MB 이하만 등록할 수 있습니다.' }, { status: 413 });
      }

      if (!hasAdminClientConfig()) {
        return NextResponse.json({
          success: false,
          code: 'STORAGE_UNAVAILABLE',
          error: '서버 관리자 클라이언트가 구성되지 않아 업로드 티켓을 발급할 수 없습니다.',
        }, { status: 500 });
      }

      const jobId = randomUUID();
      const storagePath = buildTempStoragePath(auth.user.id, jobId, fileName);

      try {
        const admin = createAdminClient();
        const { error: insErr } = await admin.from('temp_pdf_conversion_jobs').insert({
          job_id: jobId,
          user_id: auth.user.id,
          storage_path: storagePath,
          file_name: fileName,
          file_size: fileSize,
          status: 'ticket_issued',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });

        if (insErr) {
          return NextResponse.json({
            success: false,
            code: 'TICKET_REGISTRATION_FAILED',
            error: `임시 변환 작업 장부 등록 실패: ${insErr.message}`,
          }, { status: 500 });
        }
      } catch (trackErr) {
        return NextResponse.json({
          success: false,
          code: 'TICKET_REGISTRATION_FAILED',
          error: `임시 변환 작업 장부 등록 예외: ${trackErr instanceof Error ? trackErr.message : '알 수 없는 오류'}`,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        jobId,
        storagePath,
        bucket: 'materials',
      });
    }

    // Action: Cancel and immediately delete an unneeded or aborted upload
    if (action === 'cancel_storage_ticket') {
      const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
      if (!jobId) {
        return NextResponse.json({ success: false, code: 'INVALID_PARAMETERS', error: 'jobId가 필요합니다.' }, { status: 400 });
      }

      if (!hasAdminClientConfig()) {
        return NextResponse.json({ success: false, code: 'STORAGE_UNAVAILABLE', error: '스토리지 클라이언트를 사용할 수 없습니다.' }, { status: 500 });
      }

      const admin = createAdminClient();
      let jobRecord: { job_id: string; user_id: string; storage_path: string } | null = null;
      try {
        const { data: job, error: jobErr } = await admin
          .from('temp_pdf_conversion_jobs')
          .select('job_id, user_id, storage_path')
          .eq('job_id', jobId)
          .eq('user_id', auth.user.id)
          .maybeSingle();

        if (jobErr || !job) {
          return NextResponse.json({ success: false, code: 'JOB_NOT_FOUND', error: '작업 내역을 찾을 수 없습니다.' }, { status: 404 });
        }
        jobRecord = job as { job_id: string; user_id: string; storage_path: string };
      } catch {
        return NextResponse.json({ success: false, code: 'DB_ERROR', error: '작업 조회 중 오류가 발생했습니다.' }, { status: 500 });
      }

      // Validate storage path against server ledger
      const pathCheck = validateTempStoragePath(auth.user.id, jobId, jobRecord.storage_path);
      if (!pathCheck.valid) {
        // Poisoned path: quarantine row without calling Storage remove
        await admin.from('temp_pdf_conversion_jobs').update({
          status: 'quarantined',
          cleanup_error: `POISONED_OR_INVALID_PATH: ${pathCheck.reason}`,
          updated_at: new Date().toISOString(),
        }).eq('job_id', jobId);

        return NextResponse.json({
          success: false,
          code: 'STORAGE_ACCESS_DENIED',
          error: '오염되었거나 허용되지 않은 임시 파일 경로입니다.',
        }, { status: 400 });
      }

      let removeError: string | null = null;
      try {
        const { error: remErr } = await admin.storage.from('materials').remove([jobRecord.storage_path]);
        if (remErr) removeError = remErr.message;
        await admin.from('temp_pdf_conversion_jobs').update({
          status: 'cancelled',
          cleanup_attempts: 1,
          cleanup_error: removeError,
          updated_at: new Date().toISOString(),
        }).eq('job_id', jobId).eq('user_id', auth.user.id);
      } catch (e) {
        removeError = e instanceof Error ? e.message : '스토리지 삭제 실패';
      }

      return NextResponse.json({ success: true, cancelled: true, cleanupError: removeError });
    }

    // Action 2: Convert a pre-uploaded PDF from Supabase Storage
    if (action === 'convert_storage') {
      const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
      if (!jobId) {
        return NextResponse.json({ success: false, code: 'INVALID_PARAMETERS', error: 'jobId가 필요합니다.' }, { status: 400 });
      }

      if (!hasAdminClientConfig()) {
        return NextResponse.json({
          success: false,
          code: 'STORAGE_UNAVAILABLE',
          error: '서버 스토리지 클라이언트 설정이 준비되지 않았습니다.',
        }, { status: 500 });
      }

      const adminClient = createAdminClient();

      // Look up server ledger row and strictly verify ownership
      const { data: job, error: jobErr } = await adminClient
        .from('temp_pdf_conversion_jobs')
        .select('*')
        .eq('job_id', jobId)
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (jobErr || !job) {
        return NextResponse.json({
          success: false,
          code: 'STORAGE_ACCESS_DENIED',
          error: '임시 작업 내역을 찾을 수 없거나 접근 권한이 없습니다.',
        }, { status: 403 });
      }

      const pathCheck = validateTempStoragePath(auth.user.id, jobId, job.storage_path);
      if (!pathCheck.valid) {
        return NextResponse.json({
          success: false,
          code: 'STORAGE_ACCESS_DENIED',
          error: '유효하지 않거나 오염된 임시 파일 경로입니다.',
        }, { status: 403 });
      }

      const validatedStoragePath = job.storage_path;

      const externalServiceUrl = (process.env.PDF_CONVERT_SERVICE_URL || '').trim().replace(/\/+$/, '');
      const serviceToken = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
      if (!externalServiceUrl || !serviceToken) {
        return NextResponse.json({
          success: false,
          code: 'PDF_SERVICE_UNCONFIGURED',
          errorCode: 'PDF_SERVICE_UNCONFIGURED',
          error: '정밀 변환 서비스(PDF_CONVERT_SERVICE_URL) 또는 인증 토큰이 설정되지 않았습니다. 브라우저 내 "이 기기에서 변환 (브라우저 PDF.js)"을 이용해 주세요.',
        }, { status: 503 });
      }

      // Update ledger to converting
      await adminClient.from('temp_pdf_conversion_jobs').update({
        status: 'converting',
        updated_at: new Date().toISOString(),
      }).eq('job_id', jobId).eq('user_id', auth.user.id);

      let signedUrl = '';
      try {
        const { data: signData, error: signError } = await adminClient.storage
          .from('materials')
          .createSignedUrl(validatedStoragePath, 300); // 5 min TTL
        if (signError || !signData?.signedUrl) {
          // Immediately clean up storage object on sign failure to avoid abandoned objects
          await adminClient.storage.from('materials').remove([validatedStoragePath]);
          await adminClient.from('temp_pdf_conversion_jobs').update({
            status: 'failed',
            cleanup_attempts: 1,
            cleanup_error: `스토리지 원본 서명 URL 생성 실패: ${signError?.message || '알 수 없는 오류'}`,
            updated_at: new Date().toISOString(),
          }).eq('job_id', jobId).eq('user_id', auth.user.id);

          return NextResponse.json({
            success: false,
            code: 'STORAGE_SIGN_FAILED',
            error: `스토리지 원본 서명 URL 생성 실패: ${signError?.message || '알 수 없는 오류'}`,
          }, { status: 502 });
        }
        signedUrl = signData.signedUrl;
      } catch (e) {
        await adminClient.storage.from('materials').remove([validatedStoragePath]);
        await adminClient.from('temp_pdf_conversion_jobs').update({
          status: 'failed',
          cleanup_attempts: 1,
          cleanup_error: `스토리지 서명 생성 예외: ${e instanceof Error ? e.message : '알 수 없는 오류'}`,
          updated_at: new Date().toISOString(),
        }).eq('job_id', jobId).eq('user_id', auth.user.id);

        return NextResponse.json({
          success: false,
          code: 'STORAGE_SIGN_FAILED',
          error: `스토리지 서명 생성 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`,
        }, { status: 502 });
      }

      // Call Python service convert/storage inside try/finally to strictly guarantee cleanup
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Service-Token': serviceToken,
        };
        const jobToken = createPdfJobToken(auth.user.id, jobId, MAX_PDF_PAGES, 300, validatedStoragePath);
        if (jobToken) {
          headers['X-Job-Token'] = jobToken;
        }

        const extRes = await fetch(`${externalServiceUrl}/convert/storage`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            signedUrl,
            jobId,
            userId: auth.user.id,
            storagePath: validatedStoragePath,
          }),
        });

        const rawData = (await extRes.json().catch(() => null)) as Record<string, unknown> | null;
        if (!rawData || typeof rawData !== 'object') {
          return NextResponse.json(
            { success: false, code: 'SERVICE_RESPONSE_INVALID', error: 'PDF 변환 서비스 응답을 해석하지 못했습니다.' },
            { status: 502 }
          );
        }

        const fullMarkdown = typeof rawData.fullMarkdown === 'string'
          ? rawData.fullMarkdown
          : typeof rawData.markdown === 'string'
          ? rawData.markdown
          : '';
        const pageCount = Number.isInteger(rawData.pageCount) && (rawData.pageCount as number) > 0
          ? (rawData.pageCount as number)
          : 1;
        const pages = Array.isArray(rawData.pages) && rawData.pages.length === pageCount
          ? (rawData.pages as { pageNumber: number; markdown: string; hasText: boolean }[])
          : [{ pageNumber: 1, markdown: fullMarkdown, hasText: Boolean(fullMarkdown.trim()) }];

        return NextResponse.json({
          success: rawData.success !== undefined ? Boolean(rawData.success) : extRes.ok,
          hasText: rawData.hasText !== undefined ? Boolean(rawData.hasText) : Boolean(fullMarkdown.trim()),
          pageCount,
          pages,
          fullMarkdown,
          markdown: fullMarkdown,
          error: (rawData.error as string) || null,
          code: (rawData.code as string) || (rawData.errorCode as string) || undefined,
          errorCode: (rawData.errorCode as string) || (rawData.code as string) || undefined,
        });
      } catch (extErr) {
        return NextResponse.json({
          success: false,
          code: 'SERVICE_CONNECTION_FAILED',
          error: `정밀 변환 서비스 통신 실패: ${extErr instanceof Error ? extErr.message : '알 수 없는 오류'}`,
        }, { status: 502 });
      } finally {
        // Enforce cleanup: Delete temporary PDF object from Storage after conversion
        let cleanupErr: string | null = null;
        try {
          const { error: remErr } = await adminClient.storage.from('materials').remove([validatedStoragePath]);
          if (remErr) cleanupErr = remErr.message;
        } catch (e) {
          cleanupErr = e instanceof Error ? e.message : '스토리지 삭제 실패';
        }
        try {
          await adminClient.from('temp_pdf_conversion_jobs').update({
            status: cleanupErr ? 'failed' : 'cleaned',
            cleanup_attempts: 1,
            cleanup_error: cleanupErr,
            updated_at: new Date().toISOString(),
          }).eq('job_id', jobId).eq('user_id', auth.user.id);
        } catch {
          // best effort
        }
      }
    }

    return NextResponse.json({ success: false, code: 'UNKNOWN_ACTION', error: '지원하지 않는 액션입니다.' }, { status: 400 });
  }

  // --------------------------------------------------------------------------
  // Multipart Form Data Request: Direct file proxy
  // --------------------------------------------------------------------------
  if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    return NextResponse.json({ success: false, code: 'CONVERSION_BUSY', error: 'PDF 변환 작업이 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }
  activeConversions += 1;

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

    const externalServiceUrl = (process.env.PDF_CONVERT_SERVICE_URL || '').trim().replace(/\/+$/, '');

    // Serverless deployment without external Python service
    if (!externalServiceUrl) {
      return NextResponse.json({
        success: false,
        code: 'PDF_SERVICE_UNCONFIGURED',
        errorCode: 'PDF_SERVICE_UNCONFIGURED',
        hasText: false,
        pageCount: 0,
        pages: [],
        fullMarkdown: '',
        markdown: '',
        error: 'PDF 변환 서비스가 설정되지 않았습니다. PDF_CONVERT_SERVICE_URL 환경변수를 설정하거나 브라우저 내 "이 기기에서 변환 (브라우저 PDF.js)" 기능을 이용해 주세요.',
      }, { status: 503 });
    }

    const extForm = new FormData();
    extForm.append('file', new Blob([buffer], { type: 'application/pdf' }), candidate.name);

    const headers: Record<string, string> = {};
    const serviceToken = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
    if (serviceToken) {
      headers['X-Service-Token'] = serviceToken;
    }
    const jobId = randomUUID();
    const jobToken = createPdfJobToken(auth.user.id, jobId, MAX_PDF_PAGES, 120);
    if (jobToken) {
      headers['X-Job-Token'] = jobToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);
    req.signal.addEventListener('abort', () => controller.abort(), { once: true });

    let rawData: Record<string, unknown> | null = null;
    let extStatus = 200;

    try {
      const extRes = await fetch(`${externalServiceUrl}/convert`, {
        method: 'POST',
        headers,
        body: extForm,
        signal: controller.signal,
      });
      clearTimeout(timer);
      extStatus = extRes.status;
      rawData = (await extRes.json().catch(() => null)) as Record<string, unknown> | null;
    } catch (extErr) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        return NextResponse.json(
          { success: false, code: 'CONVERSION_TIMEOUT', error: 'PDF 변환 서비스 응답 시간이 초과되었습니다.' },
          { status: 504 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          code: 'SERVICE_CONNECTION_FAILED',
          error: `PDF 변환 서비스(${externalServiceUrl})에 연결하지 못했습니다: ${extErr instanceof Error ? extErr.message : '네트워크 오류'}`,
        },
        { status: 502 }
      );
    }

    if (!rawData || typeof rawData !== 'object') {
      return NextResponse.json(
        { success: false, code: 'SERVICE_RESPONSE_INVALID', error: 'PDF 변환 서비스 응답을 해석하지 못했습니다.' },
        { status: 502 }
      );
    }

    const fullMarkdown = typeof rawData.fullMarkdown === 'string'
      ? rawData.fullMarkdown
      : typeof rawData.markdown === 'string'
      ? rawData.markdown
      : '';
    const pageCount = Number.isInteger(rawData.pageCount) && (rawData.pageCount as number) > 0
      ? (rawData.pageCount as number)
      : 1;
    const pages = Array.isArray(rawData.pages) && rawData.pages.length === pageCount
      ? (rawData.pages as { pageNumber: number; markdown: string; hasText: boolean }[])
      : [{ pageNumber: 1, markdown: fullMarkdown, hasText: Boolean(fullMarkdown.trim()) }];

    const result = {
      success: rawData.success !== undefined ? Boolean(rawData.success) : extStatus >= 200 && extStatus < 300,
      hasText: rawData.hasText !== undefined ? Boolean(rawData.hasText) : Boolean(fullMarkdown.trim()),
      pageCount,
      pages,
      fullMarkdown,
      markdown: fullMarkdown,
      error: (rawData.error as string) || null,
      code: (rawData.code as string) || (rawData.errorCode as string) || undefined,
      errorCode: (rawData.errorCode as string) || (rawData.code as string) || undefined,
    };

    if (!result.success) {
      const status = result.code === 'PDF_PAGE_LIMIT' ? 413 : 422;
      const errCode = result.code ?? 'PDF_TEXT_EXTRACTION_FAILED';
      return NextResponse.json({
        success: false,
        code: errCode,
        errorCode: errCode,
        hasText: result.hasText,
        pageCount: result.pageCount,
        pages: result.pages || [],
        fullMarkdown: '',
        markdown: '',
        error: result.code === 'PDF_PAGE_LIMIT'
          ? `PDF는 ${MAX_PDF_PAGES}페이지 이하만 변환할 수 있습니다.`
          : result.code === 'PDF_NO_TEXT'
          ? '스캔된 이미지 기반 PDF이거나 텍스트 레이어가 없어 텍스트를 추출하지 못했습니다 (OCR 미지원). 텍스트가 포함된 원본 PDF를 등록해 주세요.'
          : result.error || 'PDF에서 텍스트를 추출하지 못했습니다. 원본을 확인해 주세요.',
      }, { status });
    }

    if (!Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > MAX_PDF_PAGES ||
        !Array.isArray(result.pages) || result.pages.length !== result.pageCount || result.fullMarkdown.length > MAX_OUTPUT_BYTES) {
      return NextResponse.json({ success: false, code: 'CONVERSION_OUTPUT_INVALID', errorCode: 'CONVERSION_OUTPUT_INVALID', error: '변환 결과를 검증하지 못했습니다.' }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CONVERSION_FAILED';
    const tooLarge = code === 'UPLOAD_TOO_LARGE';
    const timedOut = code === 'CONVERSION_TIMEOUT';
    const invalidForm = code === 'FORM_DATA_INVALID' || code === 'EMPTY_BODY';
    const status = tooLarge ? 413 : timedOut ? 504 : invalidForm ? 400 : 500;
    const message = tooLarge
      ? 'PDF 업로드는 20MB 이하만 허용됩니다.'
      : timedOut
        ? 'PDF 변환 시간이 제한을 넘었습니다. 파일을 줄여 다시 시도해 주세요.'
        : invalidForm
          ? 'PDF 업로드 형식을 확인해 주세요.'
          : code === 'CLIENT_ABORTED'
          ? '요청이 취소되었습니다.'
          : 'PDF를 변환하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요.';
    return NextResponse.json({ success: false, code, error: message }, { status });
  } finally {
    activeConversions = Math.max(0, activeConversions - 1);
  }
}
