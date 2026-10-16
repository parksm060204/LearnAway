import { cache } from 'react';
import { createClient } from '../supabase/server';
import { readSupabaseEnv, SUPABASE_SETUP_MESSAGE } from '../supabase/config';
import type { AppUser } from './types';

export type { AppUser } from './types';

/**
 * Server-resolved authentication state.
 *
 * `getClaims()` verifies the access token signature (locally against the cached
 * JWKS when the project uses asymmetric signing keys, otherwise against the
 * Auth server). The cookie value alone is never trusted.
 */
export type AuthState =
  | { status: 'authenticated'; user: AppUser }
  | { status: 'unauthenticated' }
  | { status: 'unconfigured'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

export const getAuthState = cache(async (): Promise<AuthState> => {
  if (!readSupabaseEnv()) {
    return { status: 'unconfigured', message: SUPABASE_SETUP_MESSAGE };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      const name = (error as { name?: string }).name;
      // Missing session is the normal "not logged in" case, not a failure.
      if (name === 'AuthSessionMissingError') {
        return { status: 'unauthenticated' };
      }
      return { status: 'unauthenticated' };
    }

    const claims = data?.claims as Record<string, unknown> | null | undefined;
    const id = typeof claims?.sub === 'string' ? claims.sub : null;
    if (!id) {
      return { status: 'unauthenticated' };
    }

    const email = typeof claims?.email === 'string' ? (claims.email as string) : null;

    if (email?.toLowerCase() === 'guest@learnaway.ai') {
      return {
        status: 'forbidden',
        message: '공용 게스트 계정은 보안 및 데이터 격리를 위해 서비스가 종료되었습니다. 간편 회원가입 또는 Google 로그인을 이용해 주세요.',
      };
    }

    return { status: 'authenticated', user: { id, email } };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '인증 상태를 확인하는 중 오류가 발생했습니다.',
    };
  }
});

export function isSharedLegacyGuestUser(user?: { email?: string | null } | null): boolean {
  if (!user || !user.email) return false;
  return user.email.toLowerCase() === 'guest@learnaway.ai';
}

export interface SupabaseAuthClientLike {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
}

export async function getSessionUser(supabaseClient?: SupabaseAuthClientLike): Promise<
  | { user: AppUser; errorCode?: undefined }
  | { user: null; errorCode: string; message: string }
> {
  try {
    const client = (supabaseClient as unknown as { auth: { getUser: () => Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }> } }) || (await createClient());
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      return { user: null, errorCode: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' };
    }
    if (isSharedLegacyGuestUser(data.user)) {
      return {
        user: null,
        errorCode: 'FORBIDDEN_SHARED_ACCOUNT',
        message: '공용 게스트 계정은 보안 및 데이터 격리를 위해 이용이 중단되었습니다.',
      };
    }
    return { user: { id: data.user.id, email: data.user.email || null } };
  } catch (err) {
    return { user: null, errorCode: 'AUTH_ERROR', message: err instanceof Error ? err.message : '인증 오류' };
  }
}

