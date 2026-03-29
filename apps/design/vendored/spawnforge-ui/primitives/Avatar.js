import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
const sizeStyles = {
    sm: 'h-6 w-6 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-12 w-12 text-base',
    xl: 'h-16 w-16 text-lg',
};
function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1)
        return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
export function Avatar({ className, src, alt, name, size = 'md', ...props }) {
    const base = cn('inline-flex items-center justify-center shrink-0', 'rounded-full overflow-hidden', 'bg-[var(--sf-bg-elevated)]', 'text-[var(--sf-text-secondary)] font-medium', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', sizeStyles[size], className);
    if (src) {
        return (
        // eslint-disable-next-line @next/next/no-img-element
        _jsx("img", { src: src, alt: alt ?? name ?? 'Avatar', className: base, ...props }));
    }
    return (_jsx("div", { className: base, role: "img", "aria-label": alt ?? name ?? 'Avatar', children: name ? getInitials(name) : '?' }));
}
