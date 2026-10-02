/**
 * Supabase public configuration.
 *
 * The URL and publishable key are safe to expose to the browser, but they must
 * be read from the literal `NEXT_PUBLIC_*` variables so Next.js can inline them
 * into client bundles at build time. Never read them through a dynamic key.
 */

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

export const SUPABASE_SETUP_MESSAGE =
  'Supabase 인증이 설정되지 않았습니다. .env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정한 뒤 개발 서버를 다시 시작하세요. (.env.example 참고)';

export function readSupabaseEnv(): SupabaseEnv | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}
