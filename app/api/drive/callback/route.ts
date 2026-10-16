import { NextResponse, type NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/auth/apiAuth';
import {
  DRIVE_SESSION_COOKIE_NAME,
  DRIVE_STATE_COOKIE_NAME,
  encryptPayload,
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  getGoogleDriveConfig,
  verifyOAuthState,
  type DriveSessionData,
} from '@/lib/drive/googleDrive';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');

  const redirectTarget = new URL('/', origin);

  // 1. Handle user cancellation or denial from Google
  if (providerError) {
    redirectTarget.searchParams.set(
      'drive_error',
      providerError === 'access_denied' ? 'cancelled' : 'oauth_failed'
    );
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  if (!code || !state) {
    redirectTarget.searchParams.set('drive_error', 'invalid_request');
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  // 2. Verify LearnAway user session
  const auth = await requireApiUser();
  if (!auth.ok) {
    redirectTarget.searchParams.set('drive_error', 'auth_required');
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  // 3. Verify state token against cookie and user ID (CSRF protection)
  const storedState = request.cookies.get(DRIVE_STATE_COOKIE_NAME)?.value;
  if (!storedState || storedState !== state) {
    redirectTarget.searchParams.set('drive_error', 'state_mismatch');
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  const verified = verifyOAuthState(state, auth.user.id);
  if (!verified.valid) {
    redirectTarget.searchParams.set('drive_error', 'state_invalid');
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  const config = getGoogleDriveConfig();
  if (!config.configured) {
    redirectTarget.searchParams.set('drive_error', 'not_configured');
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }

  try {
    // 4. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, config);

    // 5. Fetch Google email for user display
    const googleEmail = await fetchGoogleUserEmail(tokens.accessToken);

    // 6. Encrypt session data
    const sessionData: DriveSessionData = {
      userId: auth.user.id,
      googleEmail,
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + Math.max(60, tokens.expiresIn - 60) * 1000,
      refreshToken: tokens.refreshToken,
    };

    const encryptedSession = encryptPayload(JSON.stringify(sessionData));

    redirectTarget.searchParams.set('drive_status', 'connected');
    const response = NextResponse.redirect(redirectTarget);

    // Set secure HTTP-only session cookie
    response.cookies.set({
      name: DRIVE_SESSION_COOKIE_NAME,
      value: encryptedSession,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    response.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return response;
  } catch (error) {
    redirectTarget.searchParams.set(
      'drive_error',
      error instanceof Error ? 'exchange_failed' : 'unknown'
    );
    const res = NextResponse.redirect(redirectTarget);
    res.cookies.delete(DRIVE_STATE_COOKIE_NAME);
    return res;
  }
}
