'use client';

import { useState, useRef, useCallback, useMemo } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  label?: string;
  labelColor?: string;
  disabled?: boolean;
}

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  precision = 3,
  min = -Infinity,
  max = Infinity,
  label,
  labelColor = 'text-zinc-400',
  disabled = false,
}: NumberInputProps) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When not editing, display the prop value; when editing, display edit value
  const displayValue = useMemo(() => {
    if (editValue !== null) {
      return editValue;
    }
    return value.toFixed(precision);
  }, [editValue, value, precision]);

  const isFocused = editValue !== null;

  const commitValue = useCallback(() => {
    if (editValue === null) return;

    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
    }
    setEditValue(null);
  }, [editValue, min, max, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitValue();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditValue(null);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentVal = editValue !== null ? parseFloat(editValue) : value;
      const newValue = Math.min(max, currentVal + step);
      setEditValue(newValue.toFixed(precision));
      onChange(newValue);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentVal = editValue !== null ? parseFloat(editValue) : value;
      const newValue = Math.max(min, currentVal - step);
      setEditValue(newValue.toFixed(precision));
      onChange(newValue);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!isFocused) return;
    e.preventDefault();
    const currentVal = editValue !== null ? parseFloat(editValue) : value;
    const delta = e.deltaY > 0 ? -step : step;
    const newValue = Math.min(max, Math.max(min, currentVal + delta));
    setEditValue(newValue.toFixed(precision));
    onChange(newValue);
  };

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className={`w-4 text-xs font-medium ${labelColor}`}>{label}</span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={(e) => setEditValue(e.target.value)}
        onFocus={() => {
          setEditValue(value.toFixed(precision));
          inputRef.current?.select();
        }}
        onBlur={() => {
          commitValue();
        }}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        disabled={disabled}
        className="w-16 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
          focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}
