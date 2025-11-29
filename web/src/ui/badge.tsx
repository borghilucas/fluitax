'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const variantClasses: Record<BadgeVariant, string> = {
  info: 'bg-[var(--color-brand-accent)]/10 text-[var(--color-brand-secondary)] ring-1 ring-[var(--color-brand-accent)]/40',
  success: 'bg-[var(--color-feedback-success)]/10 text-[var(--color-feedback-success)] ring-1 ring-[var(--color-feedback-success)]/40',
  warning: 'bg-[var(--color-feedback-warning)]/10 text-[var(--color-feedback-warning)] ring-1 ring-[var(--color-feedback-warning)]/40',
  danger: 'bg-[var(--color-feedback-danger)]/10 text-[var(--color-feedback-danger)] ring-1 ring-[var(--color-feedback-danger)]/40',
  neutral: 'bg-[var(--color-gray-100)] text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border-subtle)]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  uppercase?: boolean;
}

export function Badge({ variant = 'info', uppercase = true, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.18em]',
        uppercase ? 'uppercase' : '',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
