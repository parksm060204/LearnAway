'use client';

interface RetryReloadButtonProps {
  label?: string;
}

/**
 * Reloads the current page so server-side initialization (env + auth check)
 * runs again. Used by retryable initialization/error screens.
 */
export function RetryReloadButton({ label = '다시 시도' }: RetryReloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded-xs bg-[#191817] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#33302b] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c52828]"
    >
      {label}
    </button>
  );
}
