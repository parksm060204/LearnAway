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
