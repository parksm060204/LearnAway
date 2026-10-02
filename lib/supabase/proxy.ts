import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { readSupabaseEnv } from './config';
import { safeInternalPath } from '@/lib/auth/redirects';

const PUBLIC_PREFIXES = ['/login', '/auth/'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function withRefreshedCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  return target;
}

/**
 * Refreshes the Supabase session cookie and applies optimistic route gating.
 *
 * Server Components cannot write cookies, so this Proxy is what keeps users
 * signed in across refreshes. It only performs an optimistic check: the actual
 * authorization decision is always re-verified on the server in pages, Route
 * Handlers and the data layer.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();
  if (!env) {
    // Without configuration the pages render an explicit setup notice.
    // Gating here would create a redirect loop with nothing to sign in to.
    return response;
  }

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  let isAuthenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    isAuthenticated = !error && typeof sub === 'string' && sub.length > 0;
  } catch {
    isAuthenticated = false;
  }

  const pathname = request.nextUrl.pathname;

  // API routes enforce authentication themselves and must return JSON 401s.
  if (pathname.startsWith('/api/')) {
    return response;
  }

  // Already signed in: do not show the login entry screen again.
  if (isAuthenticated && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  if (!isAuthenticated && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    const nextTarget = safeInternalPath(pathname + (request.nextUrl.search || ''));
    if (nextTarget !== '/') {
      url.searchParams.set('next', nextTarget);
    }
    return withRefreshedCookies(NextResponse.redirect(url), response);
  }

  return response;
}
