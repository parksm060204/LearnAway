'use client';

import React from 'react';

/** Shared button variants for LearnAway academic paper UI. */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--ink-primary)] hover:bg-[#33302b] text-white border border-transparent shadow-xs font-semibold',
  accent:
    'bg-[var(--crimson-accent)] hover:bg-[var(--crimson-accent-hover)] text-white border border-transparent shadow-xs font-semibold',
  secondary:
    'bg-[var(--paper-card)] hover:bg-[var(--paper-surface-muted)] text-[var(--ink-primary)] border border-[var(--paper-border-strong)] hover:border-[var(--ink-muted)] shadow-2xs font-medium',
  ghost:
    'bg-transparent hover:bg-[var(--paper-surface-muted)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] border border-transparent font-medium',
  danger:
    'bg-[var(--status-danger-bg)] hover:bg-[#fee2e2] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] font-semibold',
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs min-h-[32px]',
  md: 'px-4 py-2 text-xs sm:text-[13px] min-h-[36px]',
};

/** Consistent academic button with non-wrapping label and keyboard focus support. */
export function Button({
  variant = 'secondary',
  size = 'sm',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Semantic status/metadata badge with unified height and typography. */
export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  mono?: boolean;
}

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral:
    'bg-[var(--paper-surface-muted)] text-[var(--ink-secondary)] border-[var(--paper-border)]',
  accent:
    'bg-[var(--crimson-light)] text-[var(--crimson-accent)] border-[var(--status-danger-border)]',
  success:
    'bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]',
  warning:
    'bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]',
  danger:
    'bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border-[var(--status-danger-border)]',
  info:
    'bg-[var(--status-info-bg)] text-[var(--status-info-text)] border-[var(--status-info-border)]',
};

export function Badge({
  variant = 'neutral',
  mono = false,
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] leading-tight rounded-[var(--radius-control)] border font-medium whitespace-nowrap ${
        mono ? 'font-academic-mono' : 'font-sans'
      } ${BADGE_VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Standard white paper surface card with subtle border. */
export interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md';
}

const CARD_PADDING_CLASSES = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-5',
};

export function SectionCard({
  padding = 'md',
  className = '',
  children,
  ...rest
}: SectionCardProps) {
  return (
    <div
      className={`w-full bg-[var(--paper-card)] border border-[var(--paper-border)] rounded-[var(--radius-control)] shadow-2xs ${CARD_PADDING_CLASSES[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Unified workspace header with serif title, concise subtitle, and action slot. */
export interface WorkspaceHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function WorkspaceHeader({
  icon,
  title,
  subtitle,
  actions,
  children,
}: WorkspaceHeaderProps) {
  return (
    <SectionCard padding="md">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {icon && <span className="shrink-0 text-[var(--crimson-accent)]">{icon}</span>}
            <h2 className="text-base sm:text-lg font-bold font-academic-serif text-[var(--ink-primary)] leading-snug break-keep">
              {title}
            </h2>
          </div>
          {subtitle && (
            <p className="text-xs sm:text-[13px] text-[var(--ink-secondary)] leading-relaxed break-keep">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {children}
    </SectionCard>
  );
}

/** Unified empty state for workspaces and filtered lists. */
export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions?: React.ReactNode;
}

export function EmptyState({ icon, title, description, actions }: EmptyStateProps) {
  return (
    <SectionCard className="p-8 sm:p-10 text-center space-y-3">
      <div className="w-11 h-11 bg-[var(--paper-surface-muted)] border border-[var(--paper-border)] rounded-full flex items-center justify-center text-[var(--ink-muted)] mx-auto">
        {icon}
      </div>
      <div className="space-y-1.5">
        <h3 className="font-academic-serif font-bold text-base text-[var(--ink-primary)] break-keep">
          {title}
        </h3>
        <p className="text-xs sm:text-[13px] text-[var(--ink-secondary)] max-w-md mx-auto leading-relaxed break-keep">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actions}
        </div>
      )}
    </SectionCard>
  );
}

/** Standard form text/number/date input with readable 13px text and consistent border. */
export function Input({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-3 py-2 text-xs sm:text-[13px] border border-[var(--paper-border-strong)] rounded-[var(--radius-control)] bg-[var(--paper-surface-muted)] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:bg-[var(--paper-card)] focus:border-[var(--ink-primary)] transition-colors disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

/** Standard form select control matching Input height and border tokens. */
export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`px-3 py-2 text-xs sm:text-[13px] border border-[var(--paper-border-strong)] rounded-[var(--radius-control)] bg-[var(--paper-surface-muted)] text-[var(--ink-primary)] focus:bg-[var(--paper-card)] focus:border-[var(--ink-primary)] transition-colors disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
