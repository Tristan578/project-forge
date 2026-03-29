import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function Skeleton({ className, width, height, style, ...props }) {
    const computedStyle = {
        ...style,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
    };
    return (_jsx("div", { className: cn('animate-pulse', 'rounded-[var(--sf-radius-md)]', 'bg-[var(--sf-bg-elevated)]', className), style: computedStyle, "aria-hidden": "true", ...props }));
}
