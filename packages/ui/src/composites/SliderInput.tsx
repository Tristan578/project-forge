import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface SliderInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
  formatValue?: (value: number) => string;
}

export function SliderInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  formatValue,
  className,
  disabled,
  ...props
}: SliderInputProps) {
  const id = useId();
  const displayValue = formatValue ? formatValue(value) : String(value);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-xs font-medium"
          style={{ color: 'var(--sf-text-secondary)' }}
        >
          {label}
        </label>
        {showValue && (
          <span
            className="text-xs tabular-nums"
            style={{ color: 'var(--sf-text-muted)' }}
            aria-live="polite"
          >
            {displayValue}
          </span>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={cn(
          'w-full h-1.5 rounded-full appearance-none cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5',
          '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:cursor-pointer',
        )}
        style={{
          backgroundColor: 'var(--sf-bg-elevated)',
          accentColor: 'var(--sf-accent)',
        }}
        {...props}
      />
    </div>
  );
}
