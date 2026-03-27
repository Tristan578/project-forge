import { useEffect } from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  duration?: number;
  className?: string;
}

const variantStyles: Record<ToastVariant, string> = {
  info: 'border-[var(--sf-border)] bg-[var(--sf-bg-elevated)]',
  success: 'border-[var(--sf-success)] bg-[color-mix(in_srgb,var(--sf-success)_10%,var(--sf-bg-elevated))]',
  warning: 'border-[var(--sf-warning)] bg-[color-mix(in_srgb,var(--sf-warning)_10%,var(--sf-bg-elevated))]',
  error: 'border-[var(--sf-destructive)] bg-[color-mix(in_srgb,var(--sf-destructive)_10%,var(--sf-bg-elevated))]',
};

const variantIconColor: Record<ToastVariant, string> = {
  info: 'text-[var(--sf-text-secondary)]',
  success: 'text-[var(--sf-success)]',
  warning: 'text-[var(--sf-warning)]',
  error: 'text-[var(--sf-destructive)]',
};

export function Toast({ message, variant = 'info', onDismiss, duration = 5000, className }: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(), duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className={cn(
        'flex items-start gap-3',
        'rounded-[var(--sf-radius-md)]',
        'border border-[length:var(--sf-border-width)]',
        'px-4 py-3',
        'text-sm text-[var(--sf-text)]',
        'shadow-md',
        variantStyles[variant],
        className,
      )}
      style={{ zIndex: Z_INDEX.toasts }}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className={cn('flex-1', variantIconColor[variant])}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          'shrink-0',
          'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]',
          'transition-colors duration-[var(--sf-transition)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
          'rounded-[var(--sf-radius-sm)]',
        )}
        aria-label="Dismiss"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
