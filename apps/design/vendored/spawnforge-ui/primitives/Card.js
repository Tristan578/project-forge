import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function Card({ className, title, footer, children, ...props }) {
    return (_jsxs("div", { className: cn('rounded-[var(--sf-radius-lg)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'bg-[var(--sf-bg-surface)]', 'text-[var(--sf-text)]', 'shadow-sm', className), ...props, children: [title && (_jsx("div", { className: "px-4 py-3 border-b border-[length:var(--sf-border-width)] border-[var(--sf-border)]", children: _jsx("h3", { className: "text-sm font-semibold", children: title }) })), _jsx("div", { className: "p-4", children: children }), footer && (_jsx("div", { className: "px-4 py-3 border-t border-[length:var(--sf-border-width)] border-[var(--sf-border)] text-sm text-[var(--sf-text-muted)]", children: footer }))] }));
}
