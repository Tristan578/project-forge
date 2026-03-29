import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { cn } from '../utils/cn';
export function Switch({ className, label, size = 'md', id: providedId, ...props }) {
    const generatedId = useId();
    const inputId = providedId ?? generatedId;
    return (_jsxs("div", { className: cn('flex items-center gap-2', className), children: [_jsxs("div", { className: "relative", children: [_jsx("input", { type: "checkbox", role: "switch", id: inputId, className: "sr-only peer", ...props }), _jsx("label", { htmlFor: inputId, className: cn('block cursor-pointer', size === 'sm' ? 'h-5 w-9 min-h-[44px] sm:min-h-0' : 'h-6 w-11', 'rounded-[var(--sf-radius-full)]', 'bg-[var(--sf-bg-elevated)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'transition-colors duration-[var(--sf-transition)]', 'peer-checked:bg-[var(--sf-accent)] peer-checked:border-[var(--sf-accent)]', 'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed', 'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sf-accent)]'), "aria-hidden": "true" }), _jsx("span", { className: cn('pointer-events-none absolute top-0.5', 'rounded-full bg-[var(--sf-bg-surface)] shadow', size === 'sm' ? 'h-4 w-4' : 'h-5 w-5', 
                        // Unchecked: left-0.5 (2px). Checked: shift to track-width - thumb-width - inset
                        // sm: 36-16-2=18px → peer-checked:left-[18px]; md: 44-20-2=22px → peer-checked:left-[22px]
                        size === 'sm'
                            ? 'left-0.5 peer-checked:left-[18px]'
                            : 'left-0.5 peer-checked:left-[22px]'), style: {
                            transition: 'left var(--sf-transition, 150ms)',
                        } })] }), label && (_jsx("label", { htmlFor: inputId, className: "text-sm text-[var(--sf-text)] cursor-pointer select-none", children: label }))] }));
}
