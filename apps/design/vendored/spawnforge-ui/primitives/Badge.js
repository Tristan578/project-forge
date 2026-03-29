import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
const variantStyles = {
    default: 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text)]',
    success: 'bg-[color-mix(in_srgb,var(--sf-success)_20%,transparent)] text-[var(--sf-success)]',
    warning: 'bg-[color-mix(in_srgb,var(--sf-warning)_20%,transparent)] text-[var(--sf-warning)]',
    destructive: 'bg-[color-mix(in_srgb,var(--sf-destructive)_20%,transparent)] text-[var(--sf-destructive)]',
};
export function Badge({ className, variant = 'default', children, ...props }) {
    return (_jsx("span", { className: cn('inline-flex items-center', 'rounded-[var(--sf-radius-full)]', 'px-2.5 py-0.5 text-xs font-medium', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'transition-colors duration-[var(--sf-transition)]', variantStyles[variant], className), ...props, children: children }));
}
