import { type HTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'destructive';
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text-secondary)] border-[var(--sf-border)]',
  success: [
    'bg-[color-mix(in_srgb,var(--sf-success)_15%,var(--sf-bg-app))] text-[var(--sf-success)]',
    'border-[color-mix(in_srgb,var(--sf-success)_30%,transparent)]',
  ].join(' '),
  warning: [
    'bg-[color-mix(in_srgb,var(--sf-warning)_15%,var(--sf-bg-app))] text-[var(--sf-warning)]',
    'border-[color-mix(in_srgb,var(--sf-warning)_30%,transparent)]',
  ].join(' '),
  destructive: [
    'bg-[color-mix(in_srgb,var(--sf-destructive)_15%,var(--sf-bg-app))] text-[var(--sf-destructive)]',
    'border-[color-mix(in_srgb,var(--sf-destructive)_30%,transparent)]',
  ].join(' '),
};

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center',
        'rounded-[var(--sf-radius-full)]',
        'px-2.5 py-0.5 text-xs font-medium',
        'border',
        'transition-colors duration-[var(--sf-transition)]',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
