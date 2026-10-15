import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseEnv } from './config';

/**
 * Creates an authoritative, server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 *
 * CRITICAL SECURITY INVARIANTS:
 * - NEVER import or call this function in Client Components.
 * - Used ONLY by background workers, cron handlers, and secure server-to-server RPCs
 *   (e.g., claiming/completing notification dispatches, atomic chunk leases).
 * - Fails explicitly with an error if SUPABASE_SERVICE_ROLE_KEY is missing.
 *   NEVER falls back to publishable/anon key in production to prevent silent permission drop.
 */
export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    throw new Error('createAdminClient는 클라이언트 브라우저 환경에서 실행할 수 없습니다.');
  }

  // Explicit test injection: allows isolated unit/regression tests to supply a controllable fake
  const testClient = (globalThis as unknown as { __fakeSupabaseAdminClient?: SupabaseClient }).__fakeSupabaseAdminClient;
  if (testClient) {
    return testClient;
  }

  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경 변수가 서버에 설정되지 않았습니다.');
  }

  const env = readSupabaseEnv();
  if (!env || !env.url) {
    throw new Error('Supabase URL이 설정되지 않았습니다.');
  }

  return createSupabaseClient(env.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
