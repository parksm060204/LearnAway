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
