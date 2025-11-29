'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-5xl',
};

export function Modal({ open, title, description, onClose, footer, children, size = 'md' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-gray-950)]/60 px-4 backdrop-blur-sm">
      <div
        className={`w-full ${sizeClasses[size]} space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-6 shadow-xl`}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-brand-primary)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] transition hover:text-[var(--color-brand-primary)] focus-visible:outline-focus-visible"
            aria-label="Fechar diálogo"
          >
            <X className="mx-auto h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-3">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
