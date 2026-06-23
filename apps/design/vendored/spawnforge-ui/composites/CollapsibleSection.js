import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useId } from 'react';
import { cn } from '../utils/cn';
export function CollapsibleSection({ title, children, defaultOpen = true, headerRight, className, }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const contentId = useId();
    return (_jsxs("div", { className: cn('border-b', className), style: { borderColor: 'var(--sf-border)' }, children: [_jsxs("button", { type: "button", onClick: () => setIsOpen((prev) => !prev), "aria-expanded": isOpen, "aria-controls": contentId, className: cn('flex items-center justify-between w-full px-3 py-2 text-xs font-medium', 'transition-colors duration-100 cursor-pointer'), style: {
                    color: 'var(--sf-text)',
                    backgroundColor: 'var(--sf-bg-surface)',
                }, children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("svg", { width: "10", height: "10", viewBox: "0 0 10 10", className: cn('transition-transform duration-100', isOpen && 'rotate-90'), style: { color: 'var(--sf-text-muted)' }, children: _jsx("path", { d: "M3 1 L7 5 L3 9", fill: "none", stroke: "currentColor", strokeWidth: "1.5" }) }), title] }), headerRight && (_jsx("div", { onClick: (e) => e.stopPropagation(), children: headerRight }))] }), _jsx("div", { id: contentId, hidden: !isOpen, children: isOpen && (_jsx("div", { className: "px-3 py-2", children: children })) })] }));
}
