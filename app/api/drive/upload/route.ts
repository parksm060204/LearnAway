import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import { backupContainsSecrets, type MaterialBackupFile } from '@/lib/materialPolicy';
import {
  decryptPayload,
  DRIVE_SESSION_COOKIE_NAME,
  encryptPayload,
  findOrCreateBackupFolder,
  getGoogleDriveConfig,
  refreshGoogleAccessToken,
  uploadBackupToDrive,
  type DriveSessionData,
} from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';

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
          message: 'Google Drive 인증 정보가 유효하지 않습니다. 다시 연결해 주세요.',
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

  // 5. Parse request body
  let body: {
    backup?: MaterialBackupFile;
    jobId?: string;
    completeness?: 'complete' | 'partial';
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

  // 6. Security guard: Ensure no secrets exist in the backup
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

  // 7. Folder and file upload
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

    // 8. Update last backup info in session
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

    response.cookies.set({
      name: DRIVE_SESSION_COOKIE_NAME,
      value: updatedEncrypted,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

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
