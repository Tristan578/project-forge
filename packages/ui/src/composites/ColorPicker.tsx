import { useState, useId, useCallback } from 'react';
import { cn } from '../utils/cn';

export interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  className?: string;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export function ColorPicker({
  label,
  value,
  onChange,
  disabled = false,
  className,
}: ColorPickerProps) {
  const id = useId();
  const [textValue, setTextValue] = useState(value);

  // Sync textValue when parent changes the value prop
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setTextValue(value);
  }

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setTextValue(raw);
      if (HEX_REGEX.test(raw)) {
        onChange(raw);
      }
    },
    [onChange]
  );

  const handleTextBlur = useCallback(() => {
    if (!HEX_REGEX.test(textValue)) {
      setTextValue(value);
    }
  }, [textValue, value]);

  const handleColorInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const color = e.target.value;
      setTextValue(color);
      onChange(color);
    },
    [onChange]
  );

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className="text-xs font-medium"
        style={{ color: 'var(--sf-text-secondary)' }}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={handleColorInput}
          disabled={disabled}
          aria-label={`${label} color picker`}
          className={cn(
            'w-8 h-8 rounded cursor-pointer border-0 p-0',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          style={{
            borderRadius: 'var(--sf-radius-sm)',
          }}
        />
        <input
          id={id}
          type="text"
          value={textValue}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          disabled={disabled}
          maxLength={7}
          aria-label={`${label} hex value`}
          className={cn(
            'flex-1 rounded px-2 py-1.5 text-xs font-mono',
            'outline-none focus:ring-1',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          style={{
            backgroundColor: 'var(--sf-bg-elevated)',
            color: 'var(--sf-text)',
            borderRadius: 'var(--sf-radius-sm)',
          }}
        />
      </div>
    </div>
  );
}
