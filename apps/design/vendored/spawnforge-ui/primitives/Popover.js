import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef, useId, useCallback, } from "react";
import { cn } from "../utils/cn";
import { Z_INDEX } from "../tokens";
const sideStyles = {
    bottom: "top-full mt-2",
    top: "bottom-full mb-2",
    left: "right-full mr-2 top-0",
    right: "left-full ml-2 top-0",
};
const alignStyles = {
    start: "left-0",
    center: "left-0",
    end: "right-0",
};
const alignInlineStyles = {
    start: {},
    center: { left: "50%", transform: "translateX(-50%)" },
    end: {},
};
export function Popover({ trigger, content, align = "start", side = "bottom", className, "aria-label": ariaLabel, asChild = false, }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const triggerRef = useRef(null);
    const popoverId = useId();
    const close = useCallback(() => {
        setOpen(false);
        triggerRef.current?.focus();
    }, []);
    useEffect(() => {
        if (!open)
            return;
        // Focus the content panel when opened
        contentRef.current?.focus();
        function handleOutside(e) {
            if (containerRef.current &&
                !containerRef.current.contains(e.target)) {
                setOpen(false);
                triggerRef.current?.focus();
            }
        }
        function handleKeyDown(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                close();
            }
        }
        document.addEventListener("mousedown", handleOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, close]);
    return (_jsxs("div", { ref: containerRef, className: "relative inline-flex", children: [asChild ? (_jsx("span", { ref: triggerRef, role: "button", tabIndex: 0, "aria-expanded": open, "aria-controls": popoverId, "aria-haspopup": "dialog", onClick: () => setOpen((v) => !v), onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen((v) => !v);
                    }
                }, className: "inline-flex", children: trigger })) : (_jsx("button", { ref: triggerRef, type: "button", "aria-expanded": open, "aria-controls": popoverId, "aria-haspopup": "dialog", onClick: () => setOpen((v) => !v), className: "inline-flex", children: trigger })), _jsx("div", { ref: contentRef, id: popoverId, role: "dialog", "aria-label": ariaLabel ?? "Popover", tabIndex: -1, "data-popover-content": true, hidden: !open, className: cn("absolute", "min-w-[8rem]", "rounded-[var(--sf-radius-lg)]", "border border-[var(--sf-border)]", "border-t-[color-mix(in_srgb,var(--sf-accent)_30%,var(--sf-border))]", "bg-[var(--sf-bg-surface)] text-[var(--sf-text)]", "p-2 text-sm", "shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]", "backdrop-blur-sm", "focus-visible:outline-none", sideStyles[side], alignStyles[align], className), style: { zIndex: Z_INDEX.panels, ...alignInlineStyles[align] }, children: content })] }));
}
Popover.displayName = "Popover";
