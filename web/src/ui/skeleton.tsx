'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  pulse?: boolean;
}

export function Skeleton({ className, pulse = true, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-md bg-[var(--color-gray-200)]/60',
        pulse ? 'animate-pulse' : '',
        className,
      )}
      {...props}
    />
  );
}
