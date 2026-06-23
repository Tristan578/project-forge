import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../utils/cn";
export function Card({ className, title, footer, children, ...props }) {
    return (_jsxs("div", { className: cn("rounded-[var(--sf-radius-lg)]", "border border-[var(--sf-border)]", "bg-[var(--sf-bg-surface)]", "text-[var(--sf-text)]", "shadow-[0_2px_8px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.2)]", "transition-all duration-[var(--sf-transition)]", "hover:border-[color-mix(in_srgb,var(--sf-accent)_40%,var(--sf-border))]", "hover:shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.2)]", className), ...props, children: [title && (_jsx("div", { className: "px-4 py-3 border-b border-[var(--sf-border)]", children: _jsx("h3", { className: "text-sm font-semibold tracking-tight", children: title }) })), _jsx("div", { className: "p-4", children: children }), footer && (_jsx("div", { className: "px-4 py-3 border-t border-[var(--sf-border)] bg-[var(--sf-bg-app)]/50 text-sm text-[var(--sf-text-secondary)] rounded-b-[var(--sf-radius-lg)]", children: footer }))] }));
}
Card.displayName = "Card";
