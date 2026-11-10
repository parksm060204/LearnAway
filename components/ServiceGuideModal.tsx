'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { X, BookOpen, FileText, Shield, Sparkles, HardDrive } from 'lucide-react';
import {
  SERVICE_GUIDE_SECTION_ORDER,
  SERVICE_POLICY_METADATA,
  getServiceGuideDocument,
  isServiceGuideSection,
  type ServiceGuideBlock,
  type ServiceGuideSection,
} from '@/lib/serviceGuideContent';

export interface ServiceGuideModalProps {
  open: boolean;
  initialSection?: ServiceGuideSection;
  onClose: () => void;
}

const SECTION_ICONS: Record<ServiceGuideSection, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  overview: BookOpen,
  terms: FileText,
  privacy: Shield,
  ai: Sparkles,
  storage: HardDrive,
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ServiceGuideModal({
  open,
  initialSection = 'overview',
  onClose,
}: ServiceGuideModalProps) {
  const resolvedInitialSection: ServiceGuideSection = isServiceGuideSection(initialSection)
    ? initialSection
    : 'overview';

  const [manualSelection, setManualSelection] = useState<{
    forInitial: ServiceGuideSection;
    section: ServiceGuideSection;
  } | null>(null);

  const activeSection: ServiceGuideSection =
    manualSelection && manualSelection.forInitial === resolvedInitialSection
      ? manualSelection.section
      : resolvedInitialSection;

  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  const titleId = useId();
  const summaryId = useId();
  const docHeadingId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleClose = () => {
    setManualSelection(null);
    onCloseRef.current();
  };

  // Reset internal body scroll position whenever active document section changes or modal opens
  useEffect(() => {
    if (!open) return;
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [open, activeSection]);

  // Handle focus capture/restore, focus trap, Escape key, background scroll lock, and background inert state
  useEffect(() => {
    if (!open) return;

    // 1. Capture the element that opened the modal so focus can be restored on close
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && !modalRef.current?.contains(activeEl)) {
      triggerElementRef.current = activeEl;
    }

    // 2. Lock background scroll and preserve previous inline styles for Strict Mode & unmount cleanup
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // 3. Mark designated background container inert if present
    const backgroundRoot = document.querySelector<HTMLElement>('[data-gateway-background="true"]');
    const prevAriaHidden = backgroundRoot?.getAttribute('aria-hidden') ?? null;
    const prevInert = backgroundRoot ? backgroundRoot.inert : false;
    if (backgroundRoot) {
      backgroundRoot.inert = true;
      backgroundRoot.setAttribute('aria-hidden', 'true');
    }

    // 4. Move focus inside the modal
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    // 5. Keyboard handler for Escape and Tab focus trapping
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setManualSelection(null);
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const container = modalRef.current;
        if (!container) return;

        const focusableElements = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);

        if (focusableElements.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const currentFocus = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!currentFocus || !container.contains(currentFocus) || currentFocus === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (!currentFocus || !container.contains(currentFocus) || currentFocus === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    // 6. Guard against focus leaving the modal via programmatic/pointer focus outside
    const handleFocusIn = (event: FocusEvent) => {
      const container = modalRef.current;
      if (!container) return;
      const target = event.target as Node | null;
      if (target && !container.contains(target)) {
        closeButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);

      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;

      if (backgroundRoot) {
        backgroundRoot.inert = prevInert;
        if (prevAriaHidden === null) {
          backgroundRoot.removeAttribute('aria-hidden');
        } else {
          backgroundRoot.setAttribute('aria-hidden', prevAriaHidden);
        }
      }

      const opener = triggerElementRef.current;
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const currentDoc = getServiceGuideDocument(activeSection);

  const handleSelectSection = (section: ServiceGuideSection) => {
    setManualSelection({ forInitial: resolvedInitialSection, section });
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-[#191817]/45"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        className="w-full max-w-[900px] max-h-[88dvh] bg-[#fcfbfa] text-[#191817] border border-[#c8c2b5] rounded-xs flex flex-col overflow-hidden"
      >
        {/* Top Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-[#e2ded6] bg-[#faf8f4] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 bg-[#c52828] inline-block shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-sm sm:text-base font-bold text-[#191817] truncate"
              >
                Learn my way 서비스 안내 및 이용 정책
              </h2>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="서비스 안내 닫기"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#57544e] hover:text-[#191817] bg-white hover:bg-[#f4f2ee] border border-[#c8c2b5] rounded-xs transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>닫기</span>
          </button>
        </div>

        {/* Main Content Area: Left Menu on Desktop, Top Wrap Menu on Mobile; Right Scrollable Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Document Selection Menu (Standard accessible button navigation, no invalid tab role) */}
          <nav
            aria-label="서비스 안내 문서 메뉴"
            className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-[#e2ded6] bg-[#faf8f4] p-2.5 sm:p-3 flex flex-wrap md:flex-col gap-1.5"
          >
            {SERVICE_GUIDE_SECTION_ORDER.map((sectionId) => {
              const doc = getServiceGuideDocument(sectionId);
              const Icon = SECTION_ICONS[sectionId];
              const isActive = activeSection === sectionId;

              return (
                <button
                  key={sectionId}
                  type="button"
                  id={`service-guide-nav-${sectionId}`}
                  onClick={() => handleSelectSection(sectionId)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xs border text-left transition-colors ${
                    isActive
                      ? 'bg-[#191817] text-white border-[#191817]'
                      : 'bg-white md:bg-transparent text-[#57544e] border-[#e2ded6] md:border-transparent hover:bg-white hover:text-[#191817] hover:border-[#c8c2b5]'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-[#f87171]' : 'text-[#827d73]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="break-keep">{doc.shortLabel}</span>
                </button>
              );
            })}

            <div className="hidden md:block mt-auto pt-3 border-t border-[#e2ded6] px-2 text-[11px] text-[#827d73] leading-relaxed">
              문서를 열람하거나 창을 닫아도 약관 동의나 로그인이 자동으로 진행되지 않습니다.
            </div>
          </nav>

          {/* Right Document Body (Internal Scroll Only) */}
          <div
            ref={bodyScrollRef}
            role="region"
            aria-labelledby={docHeadingId}
            tabIndex={0}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5 bg-[#fcfbfa] focus:outline-hidden"
          >
            {/* Document Title & Draft Badge */}
            <header className="border-b border-[#e2ded6] pb-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3
                  id={docHeadingId}
                  className="text-base sm:text-lg font-bold text-[#191817]"
                >
                  {currentDoc.title}
                </h3>

                {currentDoc.isDraftPolicy && (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-[#fef2f2] text-[#8a1f1f] border border-[#f3c6c6] rounded-xs">
                    {SERVICE_POLICY_METADATA.statusBadgeLabel}
                  </span>
                )}
              </div>

              <p
                id={summaryId}
                className="text-xs sm:text-sm text-[#57544e] leading-relaxed break-words"
              >
                {currentDoc.summary}
              </p>

              {currentDoc.isDraftPolicy && (
                <div className="p-3 bg-[#faf8f4] border border-[#e2ded6] rounded-xs text-[11px] text-[#57544e] leading-relaxed space-y-1">
                  <p>{SERVICE_POLICY_METADATA.draftSummaryNotice}</p>
                  <p className="text-[#827d73]">
                    공식 시행일: {SERVICE_POLICY_METADATA.effectiveDate ?? '미확정 (정식 운영 공지 시 확정)'} · 운영 주체 및 문의처: {SERVICE_POLICY_METADATA.operatorName ?? '운영 정보 확인 중'}
                  </p>
                </div>
              )}
            </header>

            {/* Structured Content Blocks */}
            <div className="space-y-5">
              {currentDoc.blocks.map((block, index) => (
                <GuideBlockRenderer key={`${currentDoc.id}-block-${index}`} block={block} />
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="px-4 sm:px-6 py-2.5 border-t border-[#e2ded6] bg-[#faf8f4] flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-[#827d73] leading-snug">
            안내 열람은 단순 정보 확인이며 약관·개인정보 동의로 처리되지 않습니다.
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="px-3.5 py-1.5 text-xs font-semibold bg-[#191817] text-white hover:bg-[#33302b] rounded-xs transition-colors shrink-0"
          >
            창 닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function GuideBlockRenderer({ block }: { block: ServiceGuideBlock }) {
  if (block.type === 'section') {
    return (
      <section className="bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 space-y-3">
        <h4 className="text-xs sm:text-sm font-bold text-[#191817] border-l-2 border-[#c52828] pl-2.5">
          {block.heading}
        </h4>

        {block.paragraphs && block.paragraphs.length > 0 && (
          <div className="space-y-2 text-xs text-[#191817] leading-relaxed break-words">
            {block.paragraphs.map((paragraph, idx) => (
              <p key={idx}>{paragraph}</p>
            ))}
          </div>
        )}

        {block.callout && (
          <div
            className={`p-3 rounded-xs border text-xs leading-relaxed break-words ${
              block.callout.tone === 'important'
                ? 'bg-[#fef2f2] border-[#f3c6c6] text-[#8a1f1f]'
                : 'bg-[#faf8f4] border-[#ded6c8] text-[#191817]'
            }`}
          >
            {block.callout.title && (
              <div className="font-bold mb-1">{block.callout.title}</div>
            )}
            <p>{block.callout.text}</p>
          </div>
        )}

        {block.orderedItems && block.orderedItems.length > 0 && (
          <ol className="space-y-2.5 text-xs leading-relaxed">
            {block.orderedItems.map((item, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2.5 p-2.5 bg-[#faf8f4] border border-[#e2ded6] rounded-xs"
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-xs bg-[#191817] text-white text-[11px] font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="min-w-0 break-words">
                  <div className="font-bold text-[#191817]">{item.title}</div>
                  <p className="text-[#57544e] mt-0.5">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {block.bulletItems && block.bulletItems.length > 0 && (
          <ul className="space-y-2 text-xs text-[#191817] leading-relaxed">
            {block.bulletItems.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 break-words">
                <span
                  className="w-1.5 h-1.5 bg-[#c52828] rounded-full shrink-0 mt-1.5"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  {item.label ? (
                    <>
                      <strong className="font-semibold text-[#191817]">{item.label}: </strong>
                      <span className="text-[#57544e]">{item.text}</span>
                    </>
                  ) : (
                    <span className="text-[#57544e]">{item.text}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (block.type === 'external-processing-table') {
    return (
      <section className="bg-white border border-[#e2ded6] rounded-xs p-4 sm:p-5 space-y-3">
        <h4 className="text-xs sm:text-sm font-bold text-[#191817] border-l-2 border-[#c52828] pl-2.5">
          {block.heading}
        </h4>
        <p className="text-xs text-[#57544e] leading-relaxed break-words">
          {block.description}
        </p>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto border border-[#e2ded6] rounded-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#faf8f4] border-b border-[#e2ded6] text-[#191817]">
                <th scope="col" className="p-2.5 font-bold w-28 align-top">
                  구분
                </th>
                <th scope="col" className="p-2.5 font-bold w-44 align-top">
                  연동 대상
                </th>
                <th scope="col" className="p-2.5 font-bold align-top">
                  처리 목적·전송 항목 및 동작 조건
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2ded6]">
              {block.entries.map((entry) => (
                <tr key={entry.category} className="align-top">
                  <td className="p-2.5 font-semibold text-[#191817] bg-[#fcfbfa]">
                    {entry.category}
                  </td>
                  <td className="p-2.5 text-[#191817] break-words">
                    {entry.target}
                  </td>
                  <td className="p-2.5 space-y-1 text-[#57544e] break-words leading-relaxed">
                    <p>
                      <strong className="text-[#191817]">목적·시점:</strong> {entry.purposeAndTrigger}
                    </p>
                    <p>
                      <strong className="text-[#191817]">관련 항목:</strong> {entry.transmittedItems}
                    </p>
                    <p className="text-[11px] text-[#827d73]">
                      <strong className="text-[#57544e]">참고:</strong> {entry.codeVerificationNote}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List (375px safe, no horizontal overflow or clipping) */}
        <div className="sm:hidden space-y-2.5">
          {block.entries.map((entry) => (
            <div
              key={entry.category}
              className="p-3 bg-[#faf8f4] border border-[#e2ded6] rounded-xs space-y-1.5 text-xs leading-relaxed break-words"
            >
              <div className="font-bold text-[#191817]">{entry.category}</div>
              <div className="text-[11px] font-semibold text-[#c52828]">{entry.target}</div>
              <p className="text-[#57544e]">
                <strong className="text-[#191817]">목적·시점:</strong> {entry.purposeAndTrigger}
              </p>
              <p className="text-[#57544e]">
                <strong className="text-[#191817]">관련 항목:</strong> {entry.transmittedItems}
              </p>
              <p className="text-[11px] text-[#827d73]">{entry.codeVerificationNote}</p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-[#827d73] leading-relaxed break-words">
          {block.footnote}
        </p>
      </section>
    );
  }

  if (block.type === 'pending-policy-list') {
    return (
      <section className="bg-[#faf8f4] border border-[#ded6c8] rounded-xs p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs sm:text-sm font-bold text-[#191817] border-l-2 border-[#c52828] pl-2.5">
            {block.heading}
          </h4>
          <span className="text-[11px] font-semibold text-[#8a1f1f]">
            {SERVICE_POLICY_METADATA.statusBadgeLabel}
          </span>
        </div>
        <p className="text-xs text-[#57544e] leading-relaxed break-words">
          {block.description}
        </p>
        <ul className="space-y-2 text-xs leading-relaxed">
          {block.items.map((item) => (
            <li
              key={item.id}
              className="p-2.5 bg-white border border-[#e2ded6] rounded-xs break-words"
            >
              <div className="font-bold text-[#191817]">{item.title}</div>
              <p className="text-[#57544e] mt-0.5">{item.description}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return null;
}
