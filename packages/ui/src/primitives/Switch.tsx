import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

// Either a visible label or an aria-label must be supplied for accessible name.
type SwitchBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>;
export type SwitchProps =
  | (SwitchBaseProps & { label: string; 'aria-label'?: string; size?: 'sm' | 'md' })
  | (SwitchBaseProps & { label?: never; 'aria-label': string; size?: 'sm' | 'md' });

export function Switch({ className, label, size = 'md', id: providedId, ...props }: SwitchProps) {
  const generatedId = useId();
  const inputId = providedId ?? generatedId;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative">
        <input
          type="checkbox"
          role="switch"
          id={inputId}
          className="sr-only peer"
          {...props}
        />
        {/* Track */}
        <label
          htmlFor={inputId}
          className={cn(
            'block cursor-pointer',
            size === 'sm' ? 'h-5 w-9 min-h-[44px] sm:min-h-0' : 'h-6 w-11',
            'rounded-[var(--sf-radius-full)]',
            'bg-[var(--sf-bg-elevated)]',
            'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
            'transition-colors duration-[var(--sf-transition)]',
            'peer-checked:bg-[var(--sf-accent)] peer-checked:border-[var(--sf-accent)]',
            'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sf-accent)]',
          )}
          aria-hidden="true"
        />
        {/* Thumb — CSS variable --sw-travel is set via data-size and toggled via peer-checked:left-* */}
        <span
          className={cn(
            'pointer-events-none absolute top-0.5',
            'rounded-full bg-[var(--sf-bg-surface)] shadow',
            size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
            // Unchecked: left-0.5 (2px). Checked: shift to track-width - thumb-width - inset
            // sm: 36-16-2=18px → peer-checked:left-[18px]; md: 44-20-2=22px → peer-checked:left-[22px]
            size === 'sm'
              ? 'left-0.5 peer-checked:left-[18px]'
              : 'left-0.5 peer-checked:left-[22px]',
          )}
          style={{
            transition: 'left var(--sf-transition, 150ms)',
          }}
        />
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
