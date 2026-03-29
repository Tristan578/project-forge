import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { cn } from '../utils/cn';
export function Checkbox({ className, label, id: providedId, ...props }) {
    const generatedId = useId();
    const inputId = providedId ?? generatedId;
    return (_jsxs("div", { className: cn('flex items-center gap-2', className), children: [_jsx("input", { type: "checkbox", id: inputId, className: cn('h-4 w-4 shrink-0', 'rounded-[var(--sf-radius-sm)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'bg-[var(--sf-bg-surface)]', 'text-[var(--sf-accent)]', 'accent-[var(--sf-accent)]', 'transition-colors duration-[var(--sf-transition)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]', 'disabled:opacity-50 disabled:cursor-not-allowed'), ...props }), label && (_jsx("label", { htmlFor: inputId, className: "text-sm text-[var(--sf-text)] cursor-pointer select-none", children: label }))] }));
}
