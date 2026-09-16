import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function formatAxis(value, precision) {
    if (!Number.isFinite(value))
        return '';
    return String(parseFloat(value.toFixed(precision)));
}
function isModified(value, defaultValue, epsilon = 0.0001) {
    return value.some((v, i) => Math.abs(v - defaultValue[i]) > epsilon);
}
const AXIS_LABELS = ['X', 'Y', 'Z'];
const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
function AxisInput({ axis, value, onChange, step, precision, min, max, disabled, ariaLabel, }) {
    // Buffer the in-flight edit as a raw string. Deriving the input's value from
    // the committed number on every keystroke (value={value.toFixed(precision)})
    // makes the field impossible to clear or retype: clearing parses to NaN, which
    // is discarded, so the controlled input snaps back to the old digits and the
    // user's new digits are appended to them instead of replacing them. Rendering
    // the draft verbatim — and only committing a finite parse to onChange — keeps
    // the intermediate empty/partial states the user creates while editing.
    const [draft, setDraft] = useState(null);
    const handleChange = (e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) {
            const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
            onChange(clamped);
        }
    };
    // On blur, drop the draft so the resting display re-derives from the committed
    // (and clamped) number. A field left empty/invalid reverts to the last good
    // value rather than persisting NaN.
    const handleBlur = () => setDraft(null);
    const displayValue = draft !== null ? draft : formatAxis(value, precision);
    return (_jsxs("div", { className: "flex flex-1 items-center gap-1 min-w-0", children: [_jsxs("span", { className: "shrink-0 w-4 text-xs font-medium", style: { color: 'var(--sf-text-secondary)' }, children: [_jsx("span", { "aria-hidden": "true", className: "mb-0.5 block h-0.5 w-3 rounded-full", style: { backgroundColor: AXIS_COLORS[axis] } }), AXIS_LABELS[axis]] }), _jsx("input", { type: "number", value: displayValue, onChange: handleChange, onBlur: handleBlur, step: step, min: min, max: max, disabled: disabled, "aria-label": ariaLabel, className: cn('w-full min-w-0 min-h-[44px] sm:min-h-0 rounded px-2 py-1.5 text-xs outline-none focus:ring-1', 'disabled:opacity-50 disabled:cursor-not-allowed', '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'), style: {
                    backgroundColor: 'var(--sf-bg-elevated)',
                    color: 'var(--sf-text)',
                    borderRadius: 'var(--sf-radius-sm)',
                } })] }));
}
/**
 * Edits XYZ axes while retaining raw drafts, including empty intermediate edits.
 * Only finite edits commit; optional bounds clamp the edited axis. Blur discards
 * the draft and restores the parent value, rounded for display to precision
 * (default 3), without changing its committed precision. The default step is 0.1.
 * @param props Controlled vector, label, optional reset action and axis editing options.
 * @returns An accessible labelled group of three numeric axis inputs.
 */
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
    return (_jsxs("div", { className: cn('space-y-1', className), role: "group", "aria-labelledby": `${id}-label`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { id: `${id}-label`, className: "text-xs font-medium", style: { color: 'var(--sf-text-secondary)' }, children: label }), onReset && defaultValue && showReset && (_jsx("button", { type: "button", onClick: onReset, disabled: disabled, "aria-label": `Reset ${label.toLowerCase()} to default`, className: cn('p-0.5 rounded text-xs transition-opacity duration-150', 'opacity-60 hover:opacity-100', 'disabled:opacity-30 disabled:cursor-not-allowed'), style: { color: 'var(--sf-text-muted)' }, children: "Reset" }))] }), _jsx("div", { className: "flex gap-2 min-w-0", children: [0, 1, 2].map((axis) => (_jsx(AxisInput, { axis: axis, value: value[axis], onChange: (v) => handleChange(axis, v), step: step, precision: precision, min: min, max: max, disabled: disabled, ariaLabel: `${label} ${AXIS_LABELS[axis]}` }, axis))) })] }));
}
