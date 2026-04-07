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
          'border border-[var(--sf-border-strong)]',
          'bg-[var(--sf-bg-app)] text-[var(--sf-text)]',
          'px-3 py-2 text-sm',
          'shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]',
          'placeholder:text-[var(--sf-text-muted)]',
          'resize-y',
          'transition-all duration-[var(--sf-transition)]',
          'hover:border-[var(--sf-text-muted)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sf-bg-app)]',
          'focus-visible:border-[var(--sf-accent)]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          error && 'border-[var(--sf-destructive)] focus-visible:ring-[var(--sf-destructive)]',
          className,
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
