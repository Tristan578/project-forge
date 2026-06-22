import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useId } from 'react';
import { cn } from '../utils/cn';
function isModified(value, defaultValue, epsilon = 0.0001) {
    return value.some((v, i) => Math.abs(v - defaultValue[i]) > epsilon);
}
const AXIS_LABELS = ['X', 'Y', 'Z'];
const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
function AxisInput({ axis, value, onChange, step, precision, min, max, disabled, ariaLabel, }) {
    const handleChange = (e) => {
        const parsed = parseFloat(e.target.value);
        if (Number.isFinite(parsed)) {
            const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
            onChange(clamped);
        }
    };
    return (_jsxs("div", { className: "flex flex-1 items-center gap-1 min-w-0", children: [_jsx("span", { className: "shrink-0 w-4 text-xs font-medium", style: { color: AXIS_COLORS[axis] }, children: AXIS_LABELS[axis] }), _jsx("input", { type: "number", value: value.toFixed(precision), onChange: handleChange, step: step, min: min, max: max, disabled: disabled, "aria-label": ariaLabel, className: cn('w-full min-w-0 rounded px-2 py-1.5 text-xs outline-none focus:ring-1', 'disabled:opacity-50 disabled:cursor-not-allowed', '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'), style: {
                    backgroundColor: 'var(--sf-bg-elevated)',
                    color: 'var(--sf-text)',
                    borderRadius: 'var(--sf-radius-sm)',
                } })] }));
}
export function Vec3Input({ label, value, onChange, onReset, defaultValue, step = 0.1, precision = 3, min, max, disabled = false, className, }) {
    const id = useId();
    const handleChange = useCallback((axis, newValue) => {
        const updated = [...value];
        updated[axis] = newValue;
        onChange(updated);
    }, [value, onChange]);
    const showReset = useMemo(() => {
        if (!onReset || !defaultValue)
            return false;
        return isModified(value, defaultValue);
    }, [value, defaultValue, onReset]);
    return (_jsxs("div", { className: cn('space-y-1', className), "aria-labelledby": `${id}-label`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { id: `${id}-label`, className: "text-xs font-medium", style: { color: 'var(--sf-text-secondary)' }, children: label }), onReset && defaultValue && showReset && (_jsx("button", { type: "button", onClick: onReset, disabled: disabled, "aria-label": `Reset ${label.toLowerCase()} to default`, className: cn('p-0.5 rounded text-xs transition-opacity duration-150', 'opacity-60 hover:opacity-100', 'disabled:opacity-30 disabled:cursor-not-allowed'), style: { color: 'var(--sf-text-muted)' }, children: "Reset" }))] }), _jsx("div", { className: "flex gap-2 min-w-0", children: [0, 1, 2].map((axis) => (_jsx(AxisInput, { axis: axis, value: value[axis], onChange: (v) => handleChange(axis, v), step: step, precision: precision, min: min, max: max, disabled: disabled, ariaLabel: `${label} ${AXIS_LABELS[axis]}` }, axis))) })] }));
}
