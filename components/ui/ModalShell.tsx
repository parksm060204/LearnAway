'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Disable Escape-key closing when an active async step requires explicit cancel. */
  closeOnEscape?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getVisibleFocusables(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0 && !el.hasAttribute('aria-hidden')
  );
}

/** Unified modal dialog shell with initial focus, Tab focus trap, Escape close, and trigger focus restoration. */
export function ModalShell({
  isOpen,
  onClose,
  title,
  icon,
  maxWidthClass = 'max-w-lg',
  children,
  footer,
  closeOnEscape = true,
}: ModalShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
  });

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const rafId = window.requestAnimationFrame(() => {
      const dialogEl = dialogRef.current;
      if (!dialogEl) return;
      const bodyFocusables = getVisibleFocusables(bodyRef.current);
      const dialogFocusables = getVisibleFocusables(dialogEl);
      const initialTarget = bodyFocusables[0] ?? dialogFocusables[0] ?? dialogEl;
      initialTarget.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscapeRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const dialogEl = dialogRef.current;
        if (!dialogEl) return;
        const focusables = getVisibleFocusables(dialogEl);
        if (focusables.length === 0) {
          e.preventDefault();
          dialogEl.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (!(active instanceof HTMLElement) || !dialogEl.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

        if (e.shiftKey && (active === first || active === dialogEl)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`w-full ${maxWidthClass} bg-[var(--paper-card)] border border-[var(--paper-border-strong)] rounded-[var(--radius-control)] shadow-xl my-auto overflow-hidden flex flex-col max-h-[92vh] outline-none`}
      >
        <div className="bg-[var(--ink-primary)] text-white px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="shrink-0">{icon}</span>}
            <h3 id={titleId} className="font-academic-serif text-sm sm:text-[15px] font-bold truncate">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#ded6c8] hover:text-white p-1 rounded-[var(--radius-control)] transition-colors shrink-0"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={bodyRef} className="overflow-y-auto flex-1">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3 bg-[var(--paper-surface-muted)] border-t border-[var(--paper-border)] flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
