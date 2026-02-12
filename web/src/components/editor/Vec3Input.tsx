'use client';

import { useCallback, useMemo } from 'react';
import { RotateCcw, Copy, ClipboardPaste } from 'lucide-react';
import { NumberInput } from './NumberInput';

interface Vec3InputProps {
  label: string;
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  onReset?: () => void;
  defaultValue?: [number, number, number];
  onCopy?: () => void;
  onPaste?: () => void;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}

/**
 * Check if a Vec3 value differs from its default.
 */
function isModified(
  value: [number, number, number],
  defaultValue: [number, number, number],
  epsilon: number = 0.0001
): boolean {
  return value.some((v, i) => Math.abs(v - defaultValue[i]) > epsilon);
}

export function Vec3Input({
  label,
  value,
  onChange,
  onReset,
  defaultValue,
  onCopy,
  onPaste,
  step = 0.1,
  precision = 3,
  min,
  max,
  disabled = false,
}: Vec3InputProps) {
  const handleChange = useCallback(
    (axis: 0 | 1 | 2, newValue: number) => {
      const updated: [number, number, number] = [...value];
      updated[axis] = newValue;
      onChange(updated);
    },
    [value, onChange]
  );

  // Check if current value differs from default
  const showReset = useMemo(() => {
    if (!onReset || !defaultValue) return false;
    return isModified(value, defaultValue);
  }, [value, defaultValue, onReset]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && onCopy) {
        e.preventDefault();
        onCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && onPaste) {
        e.preventDefault();
        onPaste();
      }
    },
    [onCopy, onPaste]
  );

  const buttonBaseClass = `
    p-0.5 rounded transition-opacity duration-150
    text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700
    opacity-60 hover:opacity-100
    disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent
  `;

  return (
    <div className="space-y-1" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        <div className="flex items-center gap-0.5">
          {/* Copy button */}
          {onCopy && (
            <button
              type="button"
              onClick={onCopy}
              disabled={disabled}
              title={`Copy ${label.toLowerCase()}`}
              className={buttonBaseClass}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Paste button */}
          {onPaste && (
            <button
              type="button"
              onClick={onPaste}
              disabled={disabled}
              title={`Paste ${label.toLowerCase()}`}
              className={buttonBaseClass}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Reset button */}
          {onReset && defaultValue && (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled || !showReset}
              title="Reset to default"
              className={`
                p-0.5 rounded transition-opacity duration-150
                ${showReset
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 opacity-60 hover:opacity-100'
                  : 'text-zinc-600 opacity-0 pointer-events-none'
                }
                disabled:opacity-30 disabled:cursor-not-allowed
              `}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <NumberInput
          label="X"
          labelColor="text-red-400"
          value={value[0]}
          onChange={(v) => handleChange(0, v)}
          step={step}
          precision={precision}
          min={min}
          max={max}
          disabled={disabled}
        />
        <NumberInput
          label="Y"
          labelColor="text-green-400"
          value={value[1]}
          onChange={(v) => handleChange(1, v)}
          step={step}
          precision={precision}
          min={min}
          max={max}
          disabled={disabled}
        />
        <NumberInput
          label="Z"
          labelColor="text-blue-400"
          value={value[2]}
          onChange={(v) => handleChange(2, v)}
          step={step}
          precision={precision}
          min={min}
          max={max}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
