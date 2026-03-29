import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';
const sideStyles = {
    bottom: 'top-full mt-1',
    top: 'bottom-full mb-1',
    left: 'right-full mr-1 top-0',
    right: 'left-full ml-1 top-0',
};
const alignStyles = {
    start: 'left-0',
    center: 'left-0', // centering done via inline style to avoid translate- classes
    end: 'right-0',
};
const alignInlineStyles = {
    start: {},
    center: { left: '50%', transform: 'translateX(-50%)' },
    end: {},
};
export function Popover({ trigger, content, align = 'start', side = 'bottom', className }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        function handleOutside(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        }
        function handleKeyDown(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);
    return (_jsxs("div", { ref: containerRef, className: "relative inline-flex", children: [_jsx("div", { onClick: () => setOpen((v) => !v), children: trigger }), open && (_jsx("div", { "data-popover-content": true, className: cn('absolute', 'min-w-[8rem]', 'rounded-[var(--sf-radius-md)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'bg-[var(--sf-bg-overlay)] text-[var(--sf-text)]', 'p-2 text-sm', 'shadow-md', sideStyles[side], alignStyles[align], className), style: { zIndex: Z_INDEX.panels, ...alignInlineStyles[align] }, children: content }))] }));
}
