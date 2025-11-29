import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cloneElement, forwardRef } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const baseClasses =
  'inline-flex items-center justify-center rounded-lg font-semibold transition focus-visible:outline-focus-visible disabled:cursor-not-allowed disabled:opacity-60';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-brand-primary)] text-white shadow-sm hover:bg-[var(--color-brand-primary-strong)]',
  secondary:
    'border border-[var(--color-brand-secondary)] bg-white text-[var(--color-brand-secondary)] hover:bg-[var(--color-brand-secondary)]/5',
  ghost:
    'text-[var(--color-text-secondary)] hover:bg-[var(--color-gray-100)] hover:text-[var(--color-brand-primary)]',
  danger:
    'bg-[var(--color-feedback-danger)] text-white shadow-sm hover:bg-[#b91c1c]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

const iconSpacing: Record<ButtonSize, string> = {
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leadingIcon,
    trailingIcon,
    className = '',
    children,
    asChild = false,
    ...props
  },
  ref,
) {
  const spacing = iconSpacing[size];
  const combinedClassName = cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    leadingIcon || trailingIcon ? spacing : '',
    className,
  );

  if (asChild && children && typeof children === 'object') {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      className: cn(child.props.className, combinedClassName),
      ...props,
    });
  }

  return (
    <button ref={ref} className={combinedClassName} {...props}>
      {leadingIcon ? <span className="inline-flex h-4 w-4 items-center justify-center">{leadingIcon}</span> : null}
      {children}
      {trailingIcon ? (
        <span className="inline-flex h-4 w-4 items-center justify-center">{trailingIcon}</span>
      ) : null}
    </button>
  );
});
