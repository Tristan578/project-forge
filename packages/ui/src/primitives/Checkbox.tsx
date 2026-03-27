import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

// Either a visible label or an aria-label must be supplied for accessible name.
type CheckboxBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
export type CheckboxProps =
  | (CheckboxBaseProps & { label: string; 'aria-label'?: string })
  | (CheckboxBaseProps & { label?: never; 'aria-label': string });

export function Checkbox({ className, label, id: providedId, ...props }: CheckboxProps) {
  const generatedId = useId();
  const inputId = providedId ?? generatedId;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="checkbox"
        id={inputId}
        className={cn(
          'h-4 w-4 shrink-0',
          'rounded-[var(--sf-radius-sm)]',
          'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
          'bg-[var(--sf-bg-surface)]',
          'text-[var(--sf-accent)]',
          'accent-[var(--sf-accent)]',
          'transition-colors duration-[var(--sf-transition)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        {...props}
      />
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm text-[var(--sf-text)] cursor-pointer select-none"
        >
          {label}
        </label>
      )}
    </div>
  );
}
