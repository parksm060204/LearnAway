import { AppReadySignal } from './AppReadySignal';
import { RetryReloadButton } from './RetryReloadButton';

interface AuthSetupNoticeProps {
  message: string;
  variant?: 'setup' | 'error';
}

export function AuthSetupNotice({ message, variant = 'setup' }: AuthSetupNoticeProps) {
  return (
    <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center p-6">
      <AppReadySignal />
      <div className="max-w-xl w-full bg-white border border-[#c8c2b5] rounded-xs shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-[#c52828] inline-block" aria-hidden="true" />
          <h1 className="text-lg font-bold text-[#191817]">Learn my way</h1>
          <span className="text-[11px] font-academic-mono tracking-wider px-1.5 py-0.5 border border-[#c8c2b5] bg-[#faf8f4] text-[#57544e] rounded-xs">
            AUTH
          </span>
        </div>

        <h2 className="text-sm font-bold text-[#c52828]">
          {variant === 'error' ? '인증 오류가 발생했습니다.' : 'Supabase 인증 설정이 필요합니다.'}
        </h2>
        <p className="text-xs text-[#57544e] leading-relaxed whitespace-pre-line">{message}</p>

        <div className="text-[11px] font-academic-mono text-[#827d73] bg-[#faf8f4] border border-[#e2ded6] rounded-xs p-3 space-y-1">
          <p>.env.example</p>
          <p>NEXT_PUBLIC_SUPABASE_URL=&lt;project-url&gt;</p>
          <p>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=&lt;publishable-key&gt;</p>
        </div>

        <p className="text-[11px] text-[#827d73]">
          Google 공급자 활성화와 콜백 주소 등 외부 설정은 <code>docs/auth-setup.md</code>를 참고하세요.
        </p>

        <div className="pt-1">
          <RetryReloadButton />
        </div>
      </div>
    </div>
  );
}
