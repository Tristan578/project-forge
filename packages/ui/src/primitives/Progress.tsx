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
        'h-2 w-full overflow-hidden',
        'rounded-[var(--sf-radius-full)]',
        'bg-[var(--sf-bg-elevated)]',
        className,
      )}
      {...props}
    >
      <div
        className="h-full bg-[var(--sf-accent)] transition-all duration-[var(--sf-transition)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
