'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getAppReadiness,
  subscribeAppReadiness,
  INITIAL_READINESS,
} from '../lib/appReadiness';

// How long to wait before offering a retry. This is a failure guard, not an
// artificial delay: when initialization finishes sooner the splash closes
// immediately.
const STALL_TIMEOUT_MS = 8000;

export function AppSplash() {
  const readiness = useSyncExternalStore(
    subscribeAppReadiness,
    getAppReadiness,
    () => INITIAL_READINESS
  );
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (readiness.status !== 'loading') return;
    const timer = window.setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [readiness.status]);

  if (readiness.status === 'ready') {
    return null;
  }

  const isError = readiness.status === 'error';
  const showRetry = isError || stalled;
  const message = isError
    ? readiness.message ?? '초기화 중 오류가 발생했습니다.'
    : '초기화가 예상보다 오래 걸리고 있습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!showRetry}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-[#faf8f4] px-6 text-center"
    >
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 bg-[#c52828] inline-block" aria-hidden="true" />
        <span className="font-extrabold tracking-wider text-xl font-academic-mono text-[#191817]">
          Learn my way
        </span>
      </div>

      <p className="text-sm text-[#57544e]">배운 내용을, 나의 방식으로.</p>

      {showRetry ? (
        <div className="max-w-md space-y-3">
          <p className="text-xs text-[#8a1f1f] bg-[#fef2f2] border border-[#f3c6c6] rounded-xs p-3 leading-relaxed">
            {message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xs bg-[#191817] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#33302b] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c52828]"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-[#827d73] font-academic-mono">
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>준비 중...</span>
        </div>
      )}
    </div>
  );
}
