import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function Progress({ className, value, max = 100, label, ...props }) {
    const clamped = Math.min(Math.max(0, value), max);
    const percent = max > 0 ? (clamped / max) * 100 : 0;
    return (_jsx("div", { role: "progressbar", "aria-valuenow": clamped, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": label ?? 'Progress', className: cn('h-2 w-full overflow-hidden', 'rounded-[var(--sf-radius-full)]', 'bg-[var(--sf-bg-elevated)]', className), ...props, children: _jsx("div", { className: "h-full bg-[var(--sf-accent)] transition-all duration-[var(--sf-transition)]", style: { width: `${percent}%` } }) }));
}
