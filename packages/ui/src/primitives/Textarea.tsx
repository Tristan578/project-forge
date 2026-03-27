import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-[80px] w-full',
          'rounded-[var(--sf-radius-md)]',
          'border border-[length:var(--sf-border-width)]',
          error
            ? 'border-[var(--sf-destructive)]'
            : 'border-[var(--sf-border)]',
          'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]',
          'px-3 py-2 text-sm',
          'placeholder:text-[var(--sf-text-muted)]',
          'resize-y',
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

Textarea.displayName = 'Textarea';
