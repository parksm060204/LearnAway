/**
 * LearnAway Username Utilities
 * Validation and normalization helpers for username-based authentication.
 */

const USERNAME_REGEX = /^[a-z0-9_-]{3,30}$/;
const DOMAIN_SUFFIX = '@id.learnaway.local';

/**
 * Normalizes username to lowercase trimmed form.
 */
export function normalizeUsername(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

/**
 * Validates normalized username format.
 */
export function validateUsername(username: string): { ok: true } | { ok: false; error: string } {
  if (!username) {
    return { ok: false, error: '아이디를 입력해 주세요.' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, error: '아이디는 3~30자의 영문 소문자, 숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.' };
  }
  return { ok: true };
}

/**
 * Maps normalized username to deterministic internal synthetic email for Supabase Auth.
 */
export function usernameToEmail(normalized: string): string {
  return `${normalized}${DOMAIN_SUFFIX}`;
}
