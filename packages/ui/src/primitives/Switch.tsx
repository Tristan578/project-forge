import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: string;
  size?: 'sm' | 'md';
}

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
        {/* Thumb — uses CSS custom props to avoid class-based primitives leak */}
        <span
          className={cn(
            'pointer-events-none absolute top-0.5 left-0.5',
            'rounded-full bg-[var(--sf-bg-surface)] shadow',
            size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
            // Shift thumb right when checked. Formula: track-width - thumb-width - (2 × inset)
            // sm: 36px - 16px - 4px = 16px; md: 44px - 20px - 4px = 20px
            size === 'sm'
              ? 'peer-checked:translate-x-[16px]'
              : 'peer-checked:translate-x-[20px]',
          )}
          style={{
            // transition handled via CSS; no hardcoded color primitives
            transition: 'transform var(--sf-transition, 150ms)',
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
