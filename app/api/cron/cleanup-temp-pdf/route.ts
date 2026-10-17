import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, hasAdminClientConfig } from '../../../../lib/supabase/admin';
import { validateTempStoragePath } from '../../../../lib/pdf/tempStorage';

export const dynamic = 'force-dynamic';

/**
 * Dedicated server/cron endpoint for scheduled cleanup of expired temporary PDF files.
 * Supports both GET (Vercel Cron standard) and POST (custom schedulers / curl).
 * Protected strictly via CRON_SECRET header authentication.
 */
async function handleCleanup(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, code: 'CRON_SECRET_UNCONFIGURED', error: 'CRON_SECRET 환경변수가 서버에 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization');
  const customHeader = req.headers.get('x-cron-secret');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : customHeader?.trim();

  if (token !== cronSecret) {
    return NextResponse.json(
      { success: false, code: 'UNAUTHORIZED_CRON', error: '스케줄러 호출 인증에 실패했습니다.' },
      { status: 401 }
    );
  }

  if (!hasAdminClientConfig()) {
    return NextResponse.json(
      { success: false, code: 'STORAGE_UNAVAILABLE', error: '서버 관리자 클라이언트가 구성되지 않았습니다.' },
      { status: 500 }
    );
  }

  const admin = createAdminClient();

  try {
    // Atomically claim expired and abandoned converting jobs using FOR UPDATE SKIP LOCKED
    const { data: claimedJobs, error: rpcErr } = await admin.rpc('claim_expired_temp_pdf_jobs', {
      p_limit: 50,
    });

    if (rpcErr) {
      return NextResponse.json(
        { success: false, code: 'CLAIM_FAILED', error: `만료 작업 선점 실패: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    const jobs = Array.isArray(claimedJobs) ? claimedJobs : [];
    let cleanedCount = 0;
    let quarantinedCount = 0;
    let failedCount = 0;
    const cleanedIds: string[] = [];
    const quarantinedIds: string[] = [];
    const failedIds: string[] = [];

    for (const job of jobs) {
      const jobId = String(job.job_id || '');
      const userId = String(job.user_id || '');
      const storagePath = String(job.storage_path || '');
      const leaseToken = typeof job.lease_token === 'string' ? job.lease_token.trim() : '';
      const attempts = typeof job.cleanup_attempts === 'number' ? job.cleanup_attempts : 0;

      // 1. Strict Path Validation: Never trust stored storage_path blindly!
      const pathCheck = validateTempStoragePath(userId, jobId, storagePath);
      if (!pathCheck.valid) {
        // Path is invalid, poisoned, or foreign. Do NOT delete file! Quarantine the ledger row.
        quarantinedCount++;
        quarantinedIds.push(jobId);
        await admin
          .from('temp_pdf_conversion_jobs')
          .update({
            status: 'quarantined',
            cleanup_attempts: attempts + 1,
            cleanup_error: `POISONED_OR_INVALID_PATH: ${pathCheck.reason}`,
            lease_token: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', jobId);
        continue;
      }

      // 2. Safe Deletion: storage_path is mathematically guaranteed to belong strictly
      // to this user's isolated temporary folder: `${userId}/temp-convert/${jobId}/...`
      let isObjectRemoved = false;
      let removeError: string | null = null;
      try {
        const { error: remErr } = await admin.storage.from('materials').remove([storagePath]);
        if (remErr) {
          const msg = remErr.message.toLowerCase();
          // Idempotent deletion: if file is already deleted or not found, treat as successfully removed
          if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('404')) {
            isObjectRemoved = true;
          } else {
            removeError = remErr.message;
          }
        } else {
          isObjectRemoved = true;
        }
      } catch (e) {
        removeError = e instanceof Error ? e.message : '스토리지 파일 삭제 예외';
      }

      if (isObjectRemoved) {
        // 3. Atomically finalize to 'cleaned' with fencing token verification
        let updateQuery = admin
          .from('temp_pdf_conversion_jobs')
          .update({
            status: 'cleaned',
            cleanup_attempts: attempts + 1,
            cleanup_error: null,
            lease_token: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', jobId);

        if (leaseToken) {
          updateQuery = updateQuery.eq('lease_token', leaseToken);
        }

        const { data: updatedRows, error: updateErr } = await updateQuery.select();

        // Strict result validation: if DB update fails or 0 rows updated (stale lease), do not count as cleaned!
        if (updateErr || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
          failedCount++;
          failedIds.push(jobId);
        } else {
          cleanedCount++;
          cleanedIds.push(jobId);
        }
      } else {
        failedCount++;
        failedIds.push(jobId);
        const isExhausted = attempts + 1 >= 5;
        await admin
          .from('temp_pdf_conversion_jobs')
          .update({
            status: isExhausted ? 'quarantined' : 'failed',
            cleanup_attempts: attempts + 1,
            cleanup_error: removeError,
            lease_token: null,
            lease_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('job_id', jobId);
      }
    }

    return NextResponse.json({
      success: true,
      claimedCount: jobs.length,
      cleanedCount,
      quarantinedCount,
      failedCount,
      cleanedIds,
      quarantinedIds,
      failedIds,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '정리 작업 중 오류 발생' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleCleanup(req);
}

export async function POST(req: NextRequest) {
  return handleCleanup(req);
}
