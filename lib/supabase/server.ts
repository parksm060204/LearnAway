import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { readSupabaseEnv, SUPABASE_SETUP_MESSAGE } from './config';

type ServerClient = ReturnType<typeof createServerClient>;

/**
 * Creates a request-scoped Supabase client for Server Components, Route
 * Handlers and Server Actions. A new client must be created for every request
 * because it reads the request cookies.
 */
export async function createClient(): Promise<ServerClient> {
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(SUPABASE_SETUP_MESSAGE);
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The Proxy (proxy.ts)
          // refreshes the session before the request reaches the component,
          // so ignoring the error here is the documented pattern.
        }
      },
    },
  });
}
