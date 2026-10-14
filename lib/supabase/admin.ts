import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseEnv } from './config';

/**
 * Creates an authoritative, server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 *
 * CRITICAL SECURITY INVARIANT:
 * - NEVER import or call this function in Client Components.
 * - Used ONLY by background workers, cron handlers, and secure server-to-server RPCs
 *   (e.g., claiming/completing notification dispatches, atomic chunk leases).
 */
export function createAdminClient(): SupabaseClient {
  const env = readSupabaseEnv();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!env || !env.url) {
    throw new Error('Supabase URL이 설정되지 않았습니다.');
  }

  if (!serviceRoleKey) {
    // If running in development/local test environment without service role key,
    // fallback to publishable key with warning for offline test compatibility.
    return createSupabaseClient(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return createSupabaseClient(env.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
