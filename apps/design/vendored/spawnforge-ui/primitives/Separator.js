import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function Separator({ className, orientation = 'horizontal', ...props }) {
    return (_jsx("div", { role: "separator", "aria-orientation": orientation, className: cn('bg-[var(--sf-border)]', orientation === 'horizontal'
            ? 'h-[var(--sf-border-width,1px)] w-full'
            : 'h-full w-[var(--sf-border-width,1px)]', 'shrink-0', className), ...props }));
}
