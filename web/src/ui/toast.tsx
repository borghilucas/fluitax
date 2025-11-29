'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';

type ToastVariant = 'success' | 'warning' | 'danger' | 'info';

const variantClasses: Record<ToastVariant, string> = {
  success: 'border-[var(--color-feedback-success)]/40 bg-[var(--color-feedback-success)]/10 text-[var(--color-feedback-success)]',
  warning: 'border-[var(--color-feedback-warning)]/40 bg-[var(--color-feedback-warning)]/10 text-[var(--color-feedback-warning)]',
  danger: 'border-[var(--color-feedback-danger)]/40 bg-[var(--color-feedback-danger)]/10 text-[var(--color-feedback-danger)]',
  info: 'border-[var(--color-brand-accent)]/40 bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-secondary)]',
};

export interface ToastProps {
  title: string;
  message?: string;
  variant?: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  duration?: number;
}

export function Toast({
  title,
  message,
  variant = 'info',
  actionLabel,
  onAction,
  onDismiss,
  duration = 6000,
}: ToastProps) {
  useEffect(() => {
    if (!duration || !onDismiss) return undefined;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className={cn(
        'flex min-w-[280px] max-w-sm flex-col gap-2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm',
        variantClasses[variant],
      )}
      role="status"
      aria-live="assertive"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {message ? <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{message}</p> : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-text-secondary)] hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
            aria-label="Fechar notificação"
          >
            Fechar
          </button>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="self-start text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-brand-secondary)] underline-offset-4 hover:text-[var(--color-brand-primary)] hover:underline focus-visible:outline-focus-visible"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
