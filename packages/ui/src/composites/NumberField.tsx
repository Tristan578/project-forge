import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface NumberFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * A labelled numeric input row. The visible `label` is associated with the
 * `<input>` through a `useId`-generated `htmlFor`/`id` pair, so the control has
 * a programmatic accessible name (`getByLabelText(label)` resolves to it) rather
 * than a visual label sitting next to an unassociated input.
 *
 * This replaces the bespoke `NumberInputRow` that both the Reverb Zone and Audio
 * inspectors previously carried verbatim, closing the duplication-with-drift the
 * copies had already fallen into (one gained label association, the other did
 * not). Consumers that need a help tooltip compose it alongside this composite.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  className,
  disabled,
  ...props
}: NumberFieldProps) {
  const id = useId();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label
        htmlFor={id}
        className="w-20 shrink-0 text-xs font-medium"
        style={{ color: 'var(--sf-text-secondary)' }}
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={cn(
          'flex-1 min-w-0 rounded px-2 py-1 text-xs outline-none focus:ring-1',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        style={{
          backgroundColor: 'var(--sf-bg-elevated)',
          color: 'var(--sf-text)',
          borderRadius: 'var(--sf-radius-sm)',
        }}
        {...props}
      />
    </div>
  );
}
