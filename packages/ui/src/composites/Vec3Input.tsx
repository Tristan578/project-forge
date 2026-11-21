import { useCallback, useMemo, useId } from 'react';
import { cn } from '../utils/cn';

export interface Vec3InputProps {
  label: string;
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  onReset?: () => void;
  defaultValue?: [number, number, number];
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

function isModified(
  value: [number, number, number],
  defaultValue: [number, number, number],
  epsilon: number = 0.0001
): boolean {
  return value.some((v, i) => Math.abs(v - defaultValue[i]) > epsilon);
}

const AXIS_LABELS = ['X', 'Y', 'Z'] as const;
const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'] as const;

function AxisInput({
  axis,
  value,
  onChange,
  step,
  precision,
  min,
  max,
  disabled,
  ariaLabel,
}: {
  axis: 0 | 1 | 2;
  value: number;
  onChange: (v: number) => void;
  step: number;
  precision: number;
  min?: number;
  max?: number;
  disabled: boolean;
  ariaLabel: string;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
      onChange(clamped);
    }
  };

  return (
    <div className="flex flex-1 items-center gap-1 min-w-0">
      <span
        className="shrink-0 w-4 text-xs font-medium"
        style={{ color: AXIS_COLORS[axis] }}
      >
        {AXIS_LABELS[axis]}
      </span>
      <input
        type="number"
        value={value.toFixed(precision)}
        onChange={handleChange}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'w-full min-w-0 rounded px-2 py-1.5 text-xs outline-none focus:ring-1',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
        )}
        style={{
          backgroundColor: 'var(--sf-bg-elevated)',
          color: 'var(--sf-text)',
          borderRadius: 'var(--sf-radius-sm)',
        }}
      />
    </div>
  );
}

export function Vec3Input({
  label,
  value,
  onChange,
  onReset,
  defaultValue,
  step = 0.1,
  precision = 3,
  min,
  max,
  disabled = false,
  className,
}: Vec3InputProps) {
  const id = useId();

  const handleChange = useCallback(
    (axis: 0 | 1 | 2, newValue: number) => {
      const updated: [number, number, number] = [...value];
      updated[axis] = newValue;
      onChange(updated);
    },
    [value, onChange]
  );

  const showReset = useMemo(() => {
    if (!onReset || !defaultValue) return false;
    return isModified(value, defaultValue);
  }, [value, defaultValue, onReset]);

  return (
    <div className={cn('space-y-1', className)} aria-labelledby={`${id}-label`}>
      <div className="flex items-center justify-between">
        <span
          id={`${id}-label`}
          className="text-xs font-medium"
          style={{ color: 'var(--sf-text-secondary)' }}
        >
          {label}
        </span>
        {onReset && defaultValue && showReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            aria-label={`Reset ${label.toLowerCase()} to default`}
            className={cn(
              'p-0.5 rounded text-xs transition-opacity duration-150',
              'opacity-60 hover:opacity-100',
              'disabled:opacity-30 disabled:cursor-not-allowed',
            )}
            style={{ color: 'var(--sf-text-muted)' }}
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex gap-2 min-w-0">
        {([0, 1, 2] as const).map((axis) => (
          <AxisInput
            key={axis}
            axis={axis}
            value={value[axis]}
            onChange={(v) => handleChange(axis, v)}
            step={step}
            precision={precision}
            min={min}
            max={max}
            disabled={disabled}
            ariaLabel={`${label} ${AXIS_LABELS[axis]}`}
          />
        ))}
      </div>
    </div>
  );
}
