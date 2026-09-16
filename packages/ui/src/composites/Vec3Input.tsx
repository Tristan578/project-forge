/** Shared controlled XYZ editor with finite commits, optional bounds and raw editing drafts. */
import { useCallback, useMemo, useId, useState } from 'react';
import { cn } from '../utils/cn';

/**
 * Render a committed axis value for the (non-editing) display. Rounds to
 * `precision` decimals, then drops trailing zeros so an integer axis shows as
 * `10` — matching the inspectors' prior raw `value={n}` display — instead of
 * silently gaining fixed decimals like `10.000`. During an active edit the
 * input renders the user's draft string verbatim instead (see AxisInput), so
 * this only governs the resting display.
 */
function formatAxis(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '';
  return String(parseFloat(value.toFixed(precision)));
}

/** Controlled vector, axis editing options and optional reset action. */
export interface Vec3InputProps {
  /** Visible group label; each axis receives this label plus X, Y or Z. */
  label: string;
  /** Finite committed values in XYZ order. */
  value: [number, number, number];
  /** Receives the full vector after a finite edit, with optional axis bounds applied. */
  onChange: (value: [number, number, number]) => void;
  /** Parent action shown when a default vector is supplied and the value differs. */
  onReset?: () => void;
  /** Reference vector used to determine whether the reset action is visible. */
  defaultValue?: [number, number, number];
  /** Native number-input increment; defaults to 0.1. */
  step?: number;
  /** Resting display decimal places, default 3; does not round committed edits. */
  precision?: number;
  /** Optional inclusive lower bound applied independently to each axis. */
  min?: number;
  /** Optional inclusive upper bound applied independently to each axis. */
  max?: number;
  /** Disables all axis inputs and the reset action. */
  disabled?: boolean;
  /** Additional classes for the outer group. */
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
  // Buffer the in-flight edit as a raw string. Deriving the input's value from
  // the committed number on every keystroke (value={value.toFixed(precision)})
  // makes the field impossible to clear or retype: clearing parses to NaN, which
  // is discarded, so the controlled input snaps back to the old digits and the
  // user's new digits are appended to them instead of replacing them. Rendering
  // the draft verbatim — and only committing a finite parse to onChange — keeps
  // the intermediate empty/partial states the user creates while editing.
  const [draft, setDraft] = useState<{
    text: string;
    observedValue: number;
    emittedValue: number;
  } | null>(null);

  // Preserve an echo of this field's own commit (including raw precision and
  // out-of-bounds text), but discard the draft for an external undo/store edit.
  if (draft && !Object.is(value, draft.observedValue)) {
    setDraft(Object.is(value, draft.emittedValue) ? { ...draft, observedValue: value } : null);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
      setDraft({ text: raw, observedValue: value, emittedValue: clamped });
      onChange(clamped);
    } else {
      setDraft({ text: raw, observedValue: value, emittedValue: value });
    }
  };

  // On blur, drop the draft so the resting display re-derives from the committed
  // (and clamped) number. A field left empty/invalid reverts to the last good
  // value rather than persisting NaN.
  const handleBlur = () => setDraft(null);

  const displayValue = draft !== null ? draft.text : formatAxis(value, precision);

  return (
    <div className="flex flex-1 items-center gap-1 min-w-0">
      <span
        className="shrink-0 w-4 text-xs font-medium"
        style={{ color: 'var(--sf-text-secondary)' }}
      >
        <span
          aria-hidden="true"
          className="mb-0.5 block h-0.5 w-3 rounded-full"
          style={{ backgroundColor: AXIS_COLORS[axis] }}
        />
        {AXIS_LABELS[axis]}
      </span>
      <input
        type="number"
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'w-full min-w-0 min-h-[44px] sm:min-h-0 rounded px-2 py-1.5 text-xs outline-none focus:ring-1',
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

/**
 * Edits XYZ axes while retaining raw drafts, including empty intermediate edits.
 * External axis changes replace stale drafts; echoes of local commits retain raw text.
 * Only finite edits commit; optional bounds clamp the edited axis. Blur discards
 * the draft and restores the parent value, rounded for display to precision
 * (default 3), without changing its committed precision. The default step is 0.1.
 * @param props Controlled vector, label, optional reset action and axis editing options.
 * @returns An accessible labelled group of three numeric axis inputs.
 */
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
    <div className={cn('space-y-1', className)} role="group" aria-labelledby={`${id}-label`}>
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
