import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

/** Native input props; use a shared name for mutually exclusive options.
 * className styles the outer clickable label. The forwarded ref targets the input.
 */
export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible and accessible option name. */
  label: string;
  /** Optional help text, associated through aria-describedby. */
  description?: string;
}

/** Native keyboard behavior with a full-option touch target and theme colors. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ label, description, id: providedId, className, disabled, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const labelId = id + '-label';
    const descriptionId = id + '-description';
    return (
      <label htmlFor={id} className={cn(
        'flex min-h-[44px] items-start gap-2 rounded px-2 py-2',
        'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}>
        <input {...props} ref={ref} id={id} type="radio" disabled={disabled}
          aria-labelledby={props['aria-labelledby'] ?? labelId}
          aria-describedby={[describedBy, description ? descriptionId : undefined].filter(Boolean).join(' ') || undefined}
          className="mt-0.5 shrink-0 accent-[var(--sf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]"
        />
        <span className="min-w-0">
          <span id={labelId} className="block text-xs">{label}</span>
          {description && <span id={descriptionId} className="block text-[10px] leading-snug text-[var(--sf-text-secondary)]">{description}</span>}
        </span>
      </label>
    );
  },
);
Radio.displayName = 'Radio';
