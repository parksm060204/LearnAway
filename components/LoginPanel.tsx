'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface LoginPanelProps {
  nextPath: string;
  initialError: string | null;
}

export function LoginPanel({ nextPath, initialError }: LoginPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);

  const handleGoogleLogin = async () => {
    // Guard against duplicate clicks while the OAuth redirect is being prepared.
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { prompt: 'select_account' },
        },
      });

      if (error) {
        setErrorMessage(`Google 로그인을 시작하지 못했습니다: ${error.message}`);
        setIsSubmitting(false);
      }
      // On success the browser is redirected to Google; keep the button disabled.
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : '로그인을 시작하는 중 오류가 발생했습니다.'
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-[#c8c2b5] rounded-xs shadow-sm p-8 space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="w-3 h-3 bg-[#c52828] inline-block" aria-hidden="true" />
            <span className="font-extrabold tracking-wider text-lg font-academic-mono text-[#191817]">
              Learn my way
            </span>
          </div>
          <p className="text-xs text-[#827d73]">
            대학 논술·서술형 스페이스드 리피티션 학습 도구
          </p>
        </div>

        <p className="text-xs text-[#57544e] text-center leading-relaxed">
          학습 기록을 안전하게 이어가려면 Google 계정으로 로그인하세요.
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="text-[11px] text-[#8a1f1f] bg-[#fef2f2] border border-[#f3c6c6] rounded-xs p-3 leading-relaxed"
          >
            {errorMessage}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="mt-2 block underline text-[#c52828]"
            >
              다시 시도
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="w-full flex items-center justify-center gap-2.5 rounded-xs border border-[#c8c2b5] bg-white px-4 py-3 text-sm font-semibold text-[#191817] hover:bg-[#faf8f4] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#827d73]" />
              로그인 처리 중...
            </>
          ) : (
            <>
              <GoogleMark />
              Google로 로그인
            </>
          )}
        </button>

        <p className="text-[10px] text-[#827d73] text-center font-academic-mono">
          로그인 시 서버에서 세션을 검증합니다.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.29 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
