import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import {
  buildGoogleOAuthUrl,
  createOAuthState,
  DRIVE_STATE_COOKIE_NAME,
  getGoogleDriveConfig,
} from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  const origin = request.nextUrl.origin;

  if (!auth.ok) {
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('error', 'drive_auth_required');
    return NextResponse.redirect(loginUrl);
  }

  const config = getGoogleDriveConfig();
  if (!config.configured) {
    const settingsUrl = new URL('/', origin);
    settingsUrl.searchParams.set('drive_error', 'not_configured');
    return NextResponse.redirect(settingsUrl);
  }

  const state = createOAuthState(auth.user.id);
  const authUrl = buildGoogleOAuthUrl(config, state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set({
    name: DRIVE_STATE_COOKIE_NAME,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60, // 15 minutes
    path: '/',
  });

  return response;
}
