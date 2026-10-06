'use client';

import { useState } from 'react';
import { Loader2, Sparkles, PenTool, CalendarCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AppReadySignal } from './AppReadySignal';

interface GatewayPageProps {
  nextPath: string;
  initialError: string | null;
}

const FEATURES = [
  {
    icon: Sparkles,
    title: '자료 기반 문제',
    description: '수학·코딩 개념을 엮은 서술형·증명형 문제',
  },
  {
    icon: PenTool,
    title: '답안 논리 보완',
    description: '풀이의 근거와 오류를 확인하고 답안 개선',
  },
  {
    icon: CalendarCheck,
    title: '복습과 재도전',
    description: '시험 일정과 학습 기록을 활용한 복습 안내',
  },
] as const;

export function GatewayPage({ nextPath, initialError }: GatewayPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);

  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('이메일과 비밀번호를 입력해 주세요.');
      return;
    }
    setIsEmailSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage('이메일 또는 비밀번호가 올바르지 않거나 로그인을 완료할 수 없습니다.');
        setIsEmailSubmitting(false);
        return;
      }
      window.location.assign(nextPath || '/');
    } catch {
      setErrorMessage('로그인을 처리하는 중 오류가 발생했습니다.');
      setIsEmailSubmitting(false);
    }
  };

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
    <div className="min-h-screen bg-[#faf8f4] text-[#191817] flex flex-col">
      <AppReadySignal />

      {/* Header */}
      <header className="w-full border-b border-[#e2ded6] bg-[#fcfbfa]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-[#c52828] inline-block" aria-hidden="true" />
            <span className="font-extrabold tracking-wider text-base font-academic-mono">
              Learn my way
            </span>
          </div>
          <a
            href="#features"
            className="text-xs font-semibold text-[#57544e] hover:text-[#c52828] rounded-xs px-2 py-1 transition-colors"
          >
            서비스 안내
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-snug tracking-tight text-balance">
            강의 자료를, 시험에서 풀 수 있는 실력으로.
          </h1>
          <p className="mt-5 mx-auto max-w-xl text-sm sm:text-base text-[#57544e] leading-relaxed">
            PDF와 강의 전사본을 바탕으로 대학 시험 수준의 문제를 풀고, 답안의 논리를 보완하며
            복습을 이어가세요.
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="mt-6 mx-auto max-w-md text-[11px] text-[#8a1f1f] bg-[#fef2f2] border border-[#f3c6c6] rounded-xs p-3 leading-relaxed text-left"
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

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="inline-flex items-center justify-center gap-3 rounded-xs border border-[#c8c2b5] bg-white px-6 py-3.5 text-sm font-semibold text-[#191817] hover:bg-[#faf8f4] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-[#827d73]" aria-hidden="true" />
                  로그인 처리 중...
                </>
              ) : (
                <>
                  <GoogleMark />
                  Google로 시작하기
                </>
              )}
            </button>
            <p className="text-xs text-[#827d73]">
              로그인 후 과목을 만들고 학습 자료를 등록하세요.
            </p>

            {process.env.NODE_ENV !== 'production' && (
              <div className="w-full max-w-sm mt-1 pt-3 border-t border-[#e2ded6]/60">
                <button
                  type="button"
                  id="toggle-email-login"
                  onClick={() => setShowEmailLogin(!showEmailLogin)}
                  className="text-xs text-[#57544e] hover:text-[#191817] underline transition-colors"
                >
                  {showEmailLogin ? '테스트 로그인 접기' : '개발용 이메일 로그인'}
                </button>

                {showEmailLogin && (
                  <form
                    onSubmit={handleEmailLogin}
                    className="mt-3 p-4 bg-white border border-[#c8c2b5] rounded-xs text-left space-y-3"
                  >
                    <div>
                      <label
                        htmlFor="email-input"
                        className="block text-[11px] font-semibold text-[#57544e] mb-1"
                      >
                        이메일
                      </label>
                      <input
                        id="email-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full px-3 py-1.5 text-xs border border-[#c8c2b5] rounded-xs bg-[#faf8f4] text-[#191817] focus:outline-hidden focus:border-[#c52828]"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="password-input"
                        className="block text-[11px] font-semibold text-[#57544e] mb-1"
                      >
                        비밀번호
                      </label>
                      <input
                        id="password-input"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-1.5 text-xs border border-[#c8c2b5] rounded-xs bg-[#faf8f4] text-[#191817] focus:outline-hidden focus:border-[#c52828]"
                        required
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="submit"
                        id="email-login-submit"
                        disabled={isEmailSubmitting}
                        className="flex-1 rounded-xs bg-[#191817] text-white px-3 py-2 text-xs font-semibold hover:bg-[#333] transition-colors disabled:opacity-50"
                      >
                        {isEmailSubmitting ? '로그인 중...' : '로그인'}
                      </button>
                    </div>
                    <div className="pt-2 border-t border-[#e2ded6] flex flex-wrap gap-1.5 text-[10px]">
                      <span className="text-[#827d73] self-center">이메일 채우기:</span>
                      <button
                        type="button"
                        id="quick-fill-test1"
                        onClick={() => {
                          setEmail('learnaway-test-user-01@example.com');
                        }}
                        className="px-2 py-0.5 border border-[#c8c2b5] bg-[#faf8f4] text-[#57544e] rounded-xs hover:border-[#191817]"
                      >
                        테스트 계정 1
                      </button>
                      <button
                        type="button"
                        id="quick-fill-test2"
                        onClick={() => {
                          setEmail('learnaway-test-user-02@example.com');
                        }}
                        className="px-2 py-0.5 border border-[#c8c2b5] bg-[#faf8f4] text-[#57544e] rounded-xs hover:border-[#191817]"
                      >
                        테스트 계정 2
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-t border-[#e2ded6] bg-[#fcfbfa] scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
            <h2 className="text-lg font-bold text-center">핵심 기능</h2>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <article
                  key={title}
                  className="rounded-xs border border-[#e2ded6] bg-white p-5 text-left"
                >
                  <Icon className="w-5 h-5 text-[#c52828]" aria-hidden="true" />
                  <h3 className="mt-3 text-sm font-bold">{title}</h3>
                  <p className="mt-1.5 text-xs text-[#57544e] leading-relaxed">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e2ded6] bg-[#faf8f4]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-center">
          <p className="text-xs text-[#57544e] leading-relaxed">
            Learn my way는 강의 자료를 대학 시험 수준의 문제와 복습으로 연결하는 학습 도구입니다.
          </p>
          <p className="mt-2 text-[10px] font-academic-mono text-[#827d73]">
            © {new Date().getFullYear()} Learn my way
          </p>
        </div>
      </footer>
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
