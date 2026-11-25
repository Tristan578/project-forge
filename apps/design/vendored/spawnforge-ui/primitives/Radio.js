import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useId } from 'react';
import { cn } from '../utils/cn';
/** Native keyboard behavior with a full-option touch target and theme colors. */
export const Radio = forwardRef(({ label, description, id: providedId, className, disabled, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const labelId = id + '-label';
    const descriptionId = id + '-description';
    return (_jsxs("label", { htmlFor: id, className: cn('flex min-h-[44px] items-start gap-2 rounded px-2 py-2', 'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className), children: [_jsx("input", { ...props, ref: ref, id: id, type: "radio", disabled: disabled, "aria-labelledby": props['aria-labelledby'] ?? labelId, "aria-describedby": [describedBy, description ? descriptionId : undefined].filter(Boolean).join(' ') || undefined, className: "mt-0.5 shrink-0 accent-[var(--sf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)]" }), _jsxs("span", { className: "min-w-0", children: [_jsx("span", { id: labelId, className: "block text-xs", children: label }), description && _jsx("span", { id: descriptionId, className: "block text-[10px] leading-snug text-[var(--sf-text-secondary)]", children: description })] })] }));
});
Radio.displayName = 'Radio';
