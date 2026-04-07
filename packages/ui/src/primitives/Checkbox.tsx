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
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="relative flex items-center justify-center">
        <input
          type="checkbox"
          id={inputId}
          className="peer sr-only"
          {...props}
        />
        {/* Custom checkbox box */}
        <label
          htmlFor={inputId}
          className={cn(
            'block h-[18px] w-[18px]',
            'rounded-[var(--sf-radius-sm)] cursor-pointer',
            'border-2 border-[var(--sf-border-strong)]',
            'bg-[var(--sf-bg-app)]',
            'shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]',
            'transition-all duration-[var(--sf-transition)]',
            'peer-checked:bg-[var(--sf-accent)] peer-checked:border-[var(--sf-accent)]',
            'peer-checked:shadow-[0_0_6px_color-mix(in_srgb,var(--sf-accent)_40%,transparent)]',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sf-accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--sf-bg-app)]',
            'peer-disabled:opacity-40 peer-disabled:cursor-not-allowed',
            'hover:border-[var(--sf-text-muted)]',
            'peer-checked:hover:bg-[var(--sf-accent-hover)]',
          )}
          aria-hidden="true"
        />
        {/* Check icon — sibling of peer so peer-checked works */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'absolute h-3 w-3 pointer-events-none',
            'text-[var(--sf-on-accent)]',
            'opacity-0 peer-checked:opacity-100',
            'transition-opacity duration-[var(--sf-transition)]',
          )}
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
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
