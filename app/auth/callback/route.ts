import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/auth/redirects';
import { readSupabaseEnv } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

function resolveOrigin(request: NextRequest, fallback: string): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }
  return fallback;
}

function errorRedirect(origin: string, errorCode: string): NextResponse {
  const url = new URL('/login', origin);
  url.searchParams.set('error', errorCode);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const base = resolveOrigin(request, origin);

  const code = searchParams.get('code');
  const providerError = searchParams.get('error');
  const nextPath = safeInternalPath(searchParams.get('next'));

  if (providerError) {
    const code_ = providerError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed';
    return errorRedirect(base, code_);
  }

  if (!code) {
    return errorRedirect(base, 'missing_code');
  }

  if (!readSupabaseEnv()) {
    return errorRedirect(base, 'oauth_failed');
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return errorRedirect(base, 'exchange_failed');
    }
  } catch {
    return errorRedirect(base, 'exchange_failed');
  }

  return NextResponse.redirect(`${base}${nextPath}`);
}
