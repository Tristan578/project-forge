import { type HTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  label?: string;
}

export function Progress({ className, value, max = 100, label, ...props }: ProgressProps) {
  const clamped = Math.min(Math.max(0, value), max);
  const percent = max > 0 ? (clamped / max) * 100 : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? 'Progress'}
      className={cn(
        'h-3 w-full overflow-hidden',
        'rounded-[var(--sf-radius-full)]',
        'bg-[var(--sf-bg-elevated)]',
        'border border-[var(--sf-border-strong)]',
        'shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-[var(--sf-radius-full)]',
          'bg-[var(--sf-accent)]',
          'shadow-[0_0_8px_color-mix(in_srgb,var(--sf-accent)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]',
          'transition-all duration-[var(--sf-transition)] ease-out',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
