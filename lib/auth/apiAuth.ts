import { NextResponse } from 'next/server';
import type { AppUser, AuthState } from './session';

export type RequireApiUserResult =
  | { ok: true; user: AppUser }
  | { ok: false; response: NextResponse };

/** Maps a server auth state to the consistent API failure response. */
export function authFailureResponse(state: Exclude<AuthState, { status: 'authenticated' }>): NextResponse {
  if (state.status === 'unconfigured') {
    return NextResponse.json(
      {
        success: false,
        authError: true,
        code: 'AUTH_NOT_CONFIGURED',
        error: '서버 인증이 설정되지 않아 요청을 처리할 수 없습니다. 관리자에게 Supabase 환경변수 설정을 요청하세요.',
      },
      { status: 503 }
    );
  }

  if (state.status === 'error') {
    return NextResponse.json(
      {
        success: false,
        authError: true,
        code: 'AUTH_CHECK_FAILED',
        error: '인증 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
      },
      { status: 401 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      authError: true,
      code: 'UNAUTHENTICATED',
      error: '로그인이 필요합니다. Google 로그인 후 다시 시도하세요.',
    },
    { status: 401 }
  );
}

/**
 * Server-side gate for API Route Handlers.
 *
 * The session module is imported lazily so callers (and tests) can replace this
 * module without pulling in request-only dependencies. Production code always
 * verifies the user on the server; there is no bypass flag.
 */
export async function requireApiUser(): Promise<RequireApiUserResult> {
  const { getAuthState } = await import('./session');
  const state = await getAuthState();
  if (state.status === 'authenticated') {
    return { ok: true, user: state.user };
  }
  return { ok: false, response: authFailureResponse(state) };
}
