import { redirect } from 'next/navigation';
import { getAuthState } from '@/lib/auth/session';
import { safeInternalPath } from '@/lib/auth/redirects';
import { AuthSetupNotice } from '@/components/AuthSetupNotice';
import { LoginPanel } from '@/components/LoginPanel';

export const dynamic = 'force-dynamic';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: 'Google 로그인이 취소되었습니다. 다시 시도해 주세요.',
  oauth_failed: 'Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  missing_code: '로그인 응답이 올바르지 않습니다. 다시 시도해 주세요.',
  exchange_failed: '로그인 세션을 만들지 못했습니다. 다시 시도해 주세요.',
  session_expired: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
};

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeInternalPath(typeof params.next === 'string' ? params.next : null);
  const state = await getAuthState();

  if (state.status === 'authenticated') {
    redirect(nextPath);
  }

  if (state.status === 'unconfigured') {
    return <AuthSetupNotice message={state.message} />;
  }

  if (state.status === 'error') {
    return <AuthSetupNotice message={state.message} variant="error" />;
  }

  const rawError = typeof params.error === 'string' ? params.error : null;
  const initialError = rawError
    ? ERROR_MESSAGES[rawError] || ERROR_MESSAGES.oauth_failed
    : null;

  return <LoginPanel nextPath={nextPath} initialError={initialError} />;
}
