import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function ScrollArea({ className, height, style, children, ...props }) {
    const computedStyle = {
        ...style,
        ...(height ? { height } : {}),
    };
    return (_jsx("div", { className: cn('overflow-auto', 
        // Custom scrollbar styling via CSS custom properties
        '[scrollbar-width:thin]', '[scrollbar-color:var(--sf-bg-elevated)_transparent]', className), style: computedStyle, ...props, children: children }));
}
