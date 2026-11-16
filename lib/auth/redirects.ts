/**
 * Only allow redirects to same-origin, internal application paths.
 *
 * Rejects protocol-relative ("//evil.com"), backslash trick ("/\\evil.com"),
 * absolute URLs and auth routes that would cause redirect loops.
 */
export function safeInternalPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string') return fallback;
  const candidate = raw.trim();
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate, 'http://internal.invalid');
  } catch {
    return fallback;
  }

  if (parsed.origin !== 'http://internal.invalid') return fallback;
  if (parsed.pathname.startsWith('/login') || parsed.pathname.startsWith('/auth/')) {
    return fallback;
  }

  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * Resolves the origin for OAuth callback redirects.
 *
 * - Prefers `siteUrl` (`NEXT_PUBLIC_SITE_URL`) when it is a valid `http:` or `https:` URL.
 * - Otherwise accepts `x-forwarded-host` only when it matches host[:port] syntax
 *   and `x-forwarded-proto` is `http` or `https` (syntax validation only; proxy
 *   trust relies on deployment infrastructure overwriting forwarded headers).
 */
export function resolveAuthCallbackOrigin(params: {
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  fallbackOrigin: string;
  siteUrl?: string | null;
}): string {
  const configuredSiteUrl = (params.siteUrl || '').trim();
  if (configuredSiteUrl) {
    try {
      const parsed = new URL(configuredSiteUrl);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== 'null') {
        return parsed.origin;
      }
    } catch {
      // ignore invalid configured URL
    }
  }

  const host = (params.forwardedHost || '').split(',')[0]?.trim() || '';
  const protoRaw = (params.forwardedProto || '').split(',')[0]?.trim().toLowerCase() || '';
  if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    const proto = protoRaw === 'http' || protoRaw === 'https' ? protoRaw : 'https';
    try {
      const parsed = new URL(`${proto}://${host}`);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== 'null') {
        return parsed.origin;
      }
    } catch {
      return params.fallbackOrigin;
    }
  }

  return params.fallbackOrigin;
}
