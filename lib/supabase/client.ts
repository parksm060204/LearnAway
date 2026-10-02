'use client';

import { createBrowserClient } from '@supabase/ssr';
import { readSupabaseEnv, SUPABASE_SETUP_MESSAGE } from './config';

type BrowserClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserClient | null = null;

/**
 * Returns a memoized browser Supabase client.
 *
 * `createBrowserClient` already behaves as a singleton, but memoizing keeps the
 * reference stable across React renders and avoids repeated cookie parsing.
 */
export function createClient(): BrowserClient {
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(SUPABASE_SETUP_MESSAGE);
  }
  if (!browserClient) {
    browserClient = createBrowserClient(env.url, env.publishableKey);
  }
  return browserClient;
}
