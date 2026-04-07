import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-9 w-full',
          'rounded-[var(--sf-radius-md)]',
          'border border-[length:var(--sf-border-width)]',
          error
            ? 'border-[var(--sf-destructive)]'
            : 'border-[var(--sf-border-strong)]',
          'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]',
          'px-3 py-1 text-sm',
          'placeholder:text-[var(--sf-text-muted)]',
          'transition-colors duration-[var(--sf-transition)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
