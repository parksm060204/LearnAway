import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import {
  decryptPayload,
  DRIVE_SESSION_COOKIE_NAME,
  encryptPayload,
  getGoogleDriveConfig,
  refreshGoogleAccessToken,
  type DriveSessionData,
} from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = getGoogleDriveConfig();
  if (!config.configured) {
    return NextResponse.json({
      configured: false,
      connected: false,
    });
  }

  const auth = await requireApiUser();
  if (!auth.ok) {
    return NextResponse.json({
      configured: true,
      connected: false,
    });
  }

  const sessionCookie = request.cookies.get(DRIVE_SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return NextResponse.json({
      configured: true,
      connected: false,
    });
  }

  const decrypted = decryptPayload(sessionCookie);
  if (!decrypted) {
    const res = NextResponse.json({
      configured: true,
      connected: false,
    });
    res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
    return res;
  }

  let sessionData: DriveSessionData;
  try {
    sessionData = JSON.parse(decrypted) as DriveSessionData;
  } catch {
    const res = NextResponse.json({
      configured: true,
      connected: false,
    });
    res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
    return res;
  }

  // Cross-account guard: Session must belong to THIS authenticated user
  if (sessionData.userId !== auth.user.id) {
    return NextResponse.json({
      configured: true,
      connected: false,
    });
  }

  // Token expiration check & refresh
  if (Date.now() >= sessionData.expiresAt) {
    if (sessionData.refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(sessionData.refreshToken, config);
        sessionData.accessToken = refreshed.accessToken;
        sessionData.expiresAt = Date.now() + Math.max(60, refreshed.expiresIn - 60) * 1000;

        const updatedEncrypted = encryptPayload(JSON.stringify(sessionData));
        const res = NextResponse.json({
          configured: true,
          connected: true,
          email: sessionData.googleEmail,
          lastBackup: sessionData.lastBackup || null,
        });

        res.cookies.set({
          name: DRIVE_SESSION_COOKIE_NAME,
          value: updatedEncrypted,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
          path: '/',
        });

        return res;
      } catch {
        const res = NextResponse.json({
          configured: true,
          connected: false,
          error: 'AUTH_EXPIRED',
        });
        res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
        return res;
      }
    } else {
      const res = NextResponse.json({
        configured: true,
        connected: false,
        error: 'AUTH_EXPIRED',
      });
      res.cookies.delete(DRIVE_SESSION_COOKIE_NAME);
      return res;
    }
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    email: sessionData.googleEmail,
    lastBackup: sessionData.lastBackup || null,
  });
}
