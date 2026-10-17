import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { backupContainsSecrets, type MaterialBackupFile } from '@/lib/materialPolicy';
import {
  createResumableUploadSession,
  decryptPayload,
  DRIVE_SESSION_COOKIE_NAME,
  encryptPayload,
  findExistingBackupByJobId,
  findOrCreateBackupFolder,
  getGoogleDriveConfig,
  refreshGoogleAccessToken,
  uploadBackupToDrive,
  uploadResumableChunk,
  type DriveSessionData,
} from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ResumableUploadTokenData {
  userId: string;
  jobId: string;
  resumableUri: string;
  totalBytes: number;
  fileName: string;
  completeness: 'complete' | 'partial';
  totalMaterials: number;
  withFiles: number;
  createdAt: number;
}

export async function POST(request: NextRequest) {
  // 1. Authenticate user
  const auth = await requireApiUser();
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: '로그인이 필요합니다. 로그인 후 다시 시도해 주세요.',
        },
      },
      { status: 401 }
    );
  }

  // 2. Read Drive session cookie
  const sessionCookie = request.cookies.get(DRIVE_SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'AUTH_EXPIRED',
          message: 'Google Drive가 연결되어 있지 않습니다. Google Drive를 연결해 주세요.',
        },
      },
      { status: 401 }
    );
  }

  const decrypted = decryptPayload(sessionCookie);
  if (!decrypted) {
    const res = NextResponse.json(
      {
        ok: false,
        error: {
          code: 'AUTH_EXPIRED',
          message: 'Google Drive 인증 정보가 유효하지 않거나 암호화 키가 변경되었습니다. Google 계정을 다시 연결해 주세요.',
        },
      },
      { status: 401 }
    );
    res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
    return res;
  }

  let sessionData: DriveSessionData;
  try {
    sessionData = JSON.parse(decrypted) as DriveSessionData;
  } catch {
    const res = NextResponse.json(
      {
        ok: false,
        error: {
          code: 'AUTH_EXPIRED',
          message: 'Google Drive 세션을 읽을 수 없습니다. 다시 연결해 주세요.',
        },
      },
      { status: 401 }
    );
    res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
    return res;
  }

  // 3. Prevent cross-user credential leaking
  if (sessionData.userId !== auth.user.id) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'AUTH_EXPIRED',
          message: '현재 계정과 일치하지 않는 Google Drive 세션입니다. 다시 연결해 주세요.',
        },
      },
      { status: 403 }
    );
  }

  // 4. Token expiration & refresh check
  const config = getGoogleDriveConfig();
  let accessToken = sessionData.accessToken;

  if (Date.now() >= sessionData.expiresAt) {
    if (sessionData.refreshToken && config.configured) {
      try {
        const refreshed = await refreshGoogleAccessToken(sessionData.refreshToken, config);
        accessToken = refreshed.accessToken;
        sessionData.accessToken = refreshed.accessToken;
        sessionData.expiresAt = Date.now() + Math.max(60, refreshed.expiresIn - 60) * 1000;
      } catch {
        const res = NextResponse.json(
          {
            ok: false,
            error: {
              code: 'AUTH_EXPIRED',
              message: 'Google Drive 인증이 만료되었습니다. Google 계정을 다시 연결해 주세요.',
            },
          },
          { status: 401 }
        );
        res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
        return res;
      }
    } else {
      const res = NextResponse.json(
        {
          ok: false,
          error: {
            code: 'AUTH_EXPIRED',
            message: 'Google Drive 인증이 만료되었습니다. Google 계정을 다시 연결해 주세요.',
          },
        },
        { status: 401 }
      );
      res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
      return res;
    }
  }

  // Check if this is a chunk upload via x-upload-session header
  const uploadSessionHeader = request.headers.get('x-upload-session');
  const contentRangeHeader = request.headers.get('content-range') || request.headers.get('Content-Range');

  // ========================================================
  // CASE A: CHUNK UPLOAD
  // ========================================================
  if (uploadSessionHeader && contentRangeHeader) {
    const sessionDecrypted = decryptPayload(uploadSessionHeader);
    if (!sessionDecrypted) {
      return NextResponse.json(
        { ok: false, error: { code: 'SESSION_INVALID', message: '업로드 세션이 유효하지 않습니다.' } },
        { status: 400 }
      );
    }

    let tokenData: ResumableUploadTokenData;
    try {
      tokenData = JSON.parse(sessionDecrypted) as ResumableUploadTokenData;
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'SESSION_INVALID', message: '업로드 세션을 해석할 수 없습니다.' } },
        { status: 400 }
      );
    }

    if (tokenData.userId !== auth.user.id) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: '다른 사용자의 업로드 세션입니다.' } },
        { status: 403 }
      );
    }

    // SSRF prevention: verify resumableUri domain strictly
    if (!tokenData.resumableUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      return NextResponse.json(
        { ok: false, error: { code: 'SECURITY_VIOLATION', message: '유효하지 않은 업로드 주소입니다.' } },
        { status: 400 }
      );
    }

    // Parse Content-Range: bytes start-end/total
    const match = contentRangeHeader.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_RANGE', message: 'Content-Range 헤더 형식이 올바르지 않습니다.' } },
        { status: 400 }
      );
    }

    const rangeStart = Number(match[1]);
    const rangeEnd = Number(match[2]);
    const rangeTotal = Number(match[3]);

    if (rangeTotal !== tokenData.totalBytes || rangeStart > rangeEnd || rangeEnd >= rangeTotal) {
      return NextResponse.json(
        { ok: false, error: { code: 'RANGE_MISMATCH', message: '전송 바이트 범위가 세션 정보와 일치하지 않습니다.' } },
        { status: 400 }
      );
    }

    const chunkArrayBuffer = await request.arrayBuffer();
    const chunkBuffer = Buffer.from(chunkArrayBuffer);

    if (chunkBuffer.length !== rangeEnd - rangeStart + 1) {
      return NextResponse.json(
        { ok: false, error: { code: 'CHUNK_SIZE_MISMATCH', message: '청크 실제 바이트 크기가 지정된 범위와 일치하지 않습니다.' } },
        { status: 400 }
      );
    }

    try {
      const result = await uploadResumableChunk(tokenData.resumableUri, chunkBuffer, rangeStart, rangeEnd, rangeTotal);

      if (result.complete && result.fileId) {
        // Final chunk complete! Update last backup in session cookie
        const timestamp = new Date().toISOString();
        sessionData.lastBackup = {
          timestamp,
          fileId: result.fileId,
          fileName: result.fileName || tokenData.fileName,
          completeness: tokenData.completeness,
          totalMaterials: tokenData.totalMaterials,
          withFiles: tokenData.withFiles,
        };

        const updatedEncrypted = encryptPayload(JSON.stringify(sessionData));
        const res = NextResponse.json({
          ok: true,
          complete: true,
          fileId: result.fileId,
          fileName: result.fileName || tokenData.fileName,
          timestamp,
          completeness: tokenData.completeness,
          totalMaterials: tokenData.totalMaterials,
          withFiles: tokenData.withFiles,
        });

        if (updatedEncrypted) {
          res.cookies.set({
            name: DRIVE_SESSION_COOKIE_NAME,
            value: updatedEncrypted,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60,
            path: '/',
          });
        }

        return res;
      }

      return NextResponse.json({
        ok: true,
        complete: false,
        range: result.range,
      });
    } catch (chunkErr) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'UPLOAD_FAILED',
            message: chunkErr instanceof Error ? chunkErr.message : 'Google Drive 청크 전송 중 오류가 발생했습니다.',
          },
        },
        { status: 500 }
      );
    }
  }

  // Parse JSON body for init or legacy direct upload
  let body: {
    action?: 'init';
    jobId?: string;
    completeness?: 'complete' | 'partial';
    totalBytes?: number;
    totalMaterials?: number;
    withFiles?: number;
    backup?: MaterialBackupFile;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: '잘못된 요청 형식입니다.',
        },
      },
      { status: 400 }
    );
  }

  // ========================================================
  // CASE B: INIT RESUMABLE UPLOAD SESSION
  // ========================================================
  if (body.action === 'init') {
    const jobId = body.jobId || '';
    const completeness = body.completeness === 'partial' ? 'partial' : 'complete';
    const totalBytes = Number(body.totalBytes);
    const totalMaterials = Number(body.totalMaterials) || 0;
    const withFiles = Number(body.withFiles) || 0;

    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TOTAL_BYTES', message: '유효한 전체 전송 바이트 크기가 필요합니다.' } },
        { status: 400 }
      );
    }

    try {
      const folderId = await findOrCreateBackupFolder(accessToken);

      // Check idempotency guard
      if (jobId) {
        const existing = await findExistingBackupByJobId(accessToken, folderId, jobId);
        if (existing) {
          const timestamp = new Date().toISOString();
          return NextResponse.json({
            ok: true,
            existing: true,
            complete: true,
            fileId: existing.id,
            fileName: existing.name,
            timestamp,
            completeness,
            totalMaterials,
            withFiles,
          });
        }
      }

      const now = new Date();
      const stamp = now.toISOString().slice(0, 10).replace(/-/g, '') +
        '_' +
        now.toTimeString().slice(0, 8).replace(/:/g, '');
      const fileName = `learnaway-materials-backup-${stamp}.json`;

      const resumableUri = await createResumableUploadSession(accessToken, folderId, {
        fileName,
        totalBytes,
        jobId,
        completeness,
        totalMaterials,
        withFiles,
      });

      const tokenData: ResumableUploadTokenData = {
        userId: auth.user.id,
        jobId,
        resumableUri,
        totalBytes,
        fileName,
        completeness,
        totalMaterials,
        withFiles,
        createdAt: Date.now(),
      };

      const sessionToken = encryptPayload(JSON.stringify(tokenData));
      if (!sessionToken) {
        return NextResponse.json(
          { ok: false, error: { code: 'ENCRYPTION_FAILED', message: '서버 암호화 키가 설정되지 않아 업로드 세션을 생성할 수 없습니다.' } },
          { status: 503 }
        );
      }

      return NextResponse.json({
        ok: true,
        sessionToken,
        chunkSize: 2 * 1024 * 1024, // 2MB chunks well under Vercel 4.5MB limit
        fileName,
      });
    } catch (initErr) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INIT_FAILED',
            message: initErr instanceof Error ? initErr.message : 'Google Drive 업로드 세션 생성 중 오류가 발생했습니다.',
          },
        },
        { status: 500 }
      );
    }
  }

  // ========================================================
  // CASE C: LEGACY SINGLE PAYLOAD UPLOAD (Small Backups)
  // ========================================================
  const { backup, jobId = '', completeness = 'complete' } = body;
  if (!backup || (backup.version !== 1 && backup.version !== 2) || !Array.isArray(backup.materials)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: '유효한 백업 데이터 형식이 아닙니다.',
        },
      },
      { status: 400 }
    );
  }

  if (backupContainsSecrets(backup)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: '백업에 인증 정보로 보이는 필드가 포함되어 있어 업로드를 중단했습니다.',
        },
      },
      { status: 400 }
    );
  }

  try {
    const folderId = await findOrCreateBackupFolder(accessToken);
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10).replace(/-/g, '') +
      '_' +
      now.toTimeString().slice(0, 8).replace(/:/g, '');
    const fileName = `learnaway-materials-backup-${stamp}.json`;

    const totalMaterials = backup.materials.length;
    const withFiles = backup.materials.filter((m) => m.body != null || m.original != null).length;

    const uploadResult = await uploadBackupToDrive(accessToken, folderId, {
      fileName,
      content: JSON.stringify(backup),
      jobId,
      completeness,
      totalMaterials,
      withFiles,
    });

    if (!uploadResult.ok || !uploadResult.fileId) {
      return NextResponse.json(
        {
          ok: false,
          error: uploadResult.error || {
            code: 'UNKNOWN_ERROR',
            message: 'Google Drive 업로드에 실패했습니다.',
          },
        },
        { status: uploadResult.error?.statusCode || 500 }
      );
    }

    sessionData.lastBackup = {
      timestamp: uploadResult.timestamp || new Date().toISOString(),
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName || fileName,
      completeness,
      totalMaterials,
      withFiles,
    };

    const updatedEncrypted = encryptPayload(JSON.stringify(sessionData));
    const response = NextResponse.json({
      ok: true,
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName || fileName,
      timestamp: uploadResult.timestamp || new Date().toISOString(),
      completeness,
      totalMaterials,
      withFiles,
    });

    if (updatedEncrypted) {
      response.cookies.set({
        name: DRIVE_SESSION_COOKIE_NAME,
        value: updatedEncrypted,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });
    }

    return response;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: err instanceof Error ? err.message : 'Google Drive 업로드 처리 중 오류가 발생했습니다.',
        },
      },
      { status: 500 }
    );
  }
}
