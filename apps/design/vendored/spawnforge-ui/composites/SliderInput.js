import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { cn } from '../utils/cn';
export function SliderInput({ label, value, onChange, min = 0, max = 100, step = 1, showValue = true, formatValue, className, disabled, ...props }) {
    const id = useId();
    const displayValue = formatValue ? formatValue(value) : String(value);
    return (_jsxs("div", { className: cn('flex flex-col gap-1', className), children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("label", { htmlFor: id, className: "text-xs font-medium", style: { color: 'var(--sf-text-secondary)' }, children: label }), showValue && (_jsx("span", { className: "text-xs tabular-nums", style: { color: 'var(--sf-text-secondary)' }, "aria-live": "polite", children: displayValue }))] }), _jsx("input", { id: id, type: "range", min: min, max: max, step: step, value: value, onChange: (e) => onChange(Number(e.target.value)), disabled: disabled, className: cn('w-full h-11 sm:h-1.5 rounded-full appearance-none cursor-pointer', 'disabled:opacity-50 disabled:cursor-not-allowed', '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5', '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full', '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:bg-[var(--sf-text)]', '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3.5', '[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full', '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--sf-text)]', '[&::-moz-range-thumb]:cursor-pointer'), style: {
                    backgroundColor: 'transparent',
                    backgroundImage: 'linear-gradient(var(--sf-bg-elevated), var(--sf-bg-elevated))',
                    backgroundSize: '100% 6px',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    accentColor: 'var(--sf-accent)',
                }, ...props })] }));
}
