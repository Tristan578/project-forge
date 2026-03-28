import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { cn } from '../utils/cn';
export function Accordion({ items, defaultOpen, className }) {
    const [openId, setOpenId] = useState(defaultOpen ?? null);
    function toggle(id) {
        setOpenId((current) => (current === id ? null : id));
    }
    return (_jsx("div", { className: cn('w-full', 'divide-y divide-[var(--sf-border)]', 'rounded-[var(--sf-radius-md)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', className), children: items.map((item) => {
            const isOpen = openId === item.id;
            return (_jsxs("div", { children: [_jsxs("button", { type: "button", "aria-expanded": isOpen, "aria-controls": `accordion-content-${item.id}`, id: `accordion-trigger-${item.id}`, onClick: () => toggle(item.id), className: cn('flex w-full items-center justify-between', 'px-4 py-3 text-sm font-medium text-left', 'text-[var(--sf-text)]', 'hover:bg-[var(--sf-bg-elevated)]', 'transition-colors duration-[var(--sf-transition)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]'), children: [_jsx("span", { children: item.title }), _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", className: cn('shrink-0 text-[var(--sf-text-muted)]', 'transition-transform duration-[var(--sf-transition)]', isOpen && 'rotate-180'), "aria-hidden": "true", children: _jsx("path", { d: "m6 9 6 6 6-6" }) })] }), _jsx("div", { id: `accordion-content-${item.id}`, role: "region", "aria-labelledby": `accordion-trigger-${item.id}`, hidden: !isOpen, className: "px-4 pb-3 text-sm text-[var(--sf-text-secondary)]", children: item.content })] }, item.id));
        }) }));
}
