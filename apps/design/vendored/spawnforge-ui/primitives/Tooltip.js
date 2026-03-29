import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useId, cloneElement, isValidElement } from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';
const sidePositions = {
    top: 'bottom-full mb-1',
    bottom: 'top-full mt-1',
    left: 'right-full mr-1',
    right: 'left-full ml-1',
};
const sideAlignStyles = {
    top: { left: '50%', transform: 'translateX(-50%)' },
    bottom: { left: '50%', transform: 'translateX(-50%)' },
    left: { top: '50%', transform: 'translateY(-50%)' },
    right: { top: '50%', transform: 'translateY(-50%)' },
};
export function Tooltip({ content, children, side = 'top', className }) {
    const [visible, setVisible] = useState(false);
    const tooltipId = useId();
    // Inject aria-describedby on the direct child element so assistive technology
    // can announce the tooltip content when the element is focused.
    const childWithAriaDescribedBy = isValidElement(children)
        ? cloneElement(children, {
            'aria-describedby': tooltipId,
        })
        : children;
    return (_jsxs("div", { className: cn('relative inline-flex', className), onMouseEnter: () => setVisible(true), onMouseLeave: () => setVisible(false), onFocus: () => setVisible(true), onBlur: () => setVisible(false), children: [childWithAriaDescribedBy, _jsx("div", { id: tooltipId, role: "tooltip", className: cn('absolute pointer-events-none', 'px-2 py-1 text-xs', 'rounded-[var(--sf-radius-sm)]', 'bg-[var(--sf-bg-overlay)] text-[var(--sf-text)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'whitespace-nowrap', 'transition-opacity duration-[var(--sf-transition)]', visible ? 'opacity-100' : 'opacity-0', sidePositions[side]), style: { zIndex: Z_INDEX.tooltips, ...sideAlignStyles[side] }, "aria-hidden": !visible, children: content })] }));
}
