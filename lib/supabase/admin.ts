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
  const testAdminClient = (globalThis as unknown as { __fakeSupabaseAdminClient?: SupabaseClient }).__fakeSupabaseAdminClient;
  if (testAdminClient) {
    return testAdminClient;
  }

  if ((globalThis as unknown as { __disableFakeAdminClient?: boolean }).__disableFakeAdminClient !== true) {
    const testClient = (globalThis as unknown as { __fakeSupabaseClient?: SupabaseClient }).__fakeSupabaseClient;
    if (testClient) {
      return testClient;
    }
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

/**
 * Returns whether authoritative admin client credentials (SUPABASE_SERVICE_ROLE_KEY and URL)
 * are configured in the current server environment.
 */
export function hasAdminClientConfig(): boolean {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    return false;
  }
  if ((globalThis as unknown as { __disableFakeAdminClient?: boolean }).__disableFakeAdminClient === true) {
    return false;
  }
  const testAdminClient = (globalThis as unknown as { __fakeSupabaseAdminClient?: SupabaseClient }).__fakeSupabaseAdminClient;
  if (testAdminClient) {
    return true;
  }
  const testClient = (globalThis as unknown as { __fakeSupabaseClient?: SupabaseClient }).__fakeSupabaseClient;
  if (testClient) {
    return true;
  }
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const env = readSupabaseEnv();
  return Boolean(serviceRoleKey && env && env.url);
}
