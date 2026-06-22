import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useId } from "react";
import { cn } from "../utils/cn";
export const Switch = forwardRef(({ className, label, size = "md", id: providedId, ...props }, ref) => {
    const generatedId = useId();
    const inputId = providedId ?? generatedId;
    return (_jsxs("div", { className: cn("flex items-center gap-2.5", className), children: [_jsxs("div", { className: "relative", children: [_jsx("input", { type: "checkbox", role: "switch", id: inputId, ref: ref, className: "sr-only peer", ...props }), _jsx("label", { htmlFor: inputId, className: cn("block cursor-pointer", size === "sm" ? "h-5 w-9 min-h-[44px] sm:min-h-0" : "h-6 w-11", "rounded-[var(--sf-radius-full)]", "bg-[color-mix(in_srgb,var(--sf-accent)_12%,var(--sf-bg-elevated))]", "border-[length:var(--sf-border-width)] border-[var(--sf-border-strong)]", "shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]", "transition-all duration-[var(--sf-transition)]", "peer-checked:bg-[var(--sf-accent)] peer-checked:border-[var(--sf-accent)]", "peer-checked:shadow-[inset_0_1px_3px_rgba(0,0,0,0.2),0_0_8px_color-mix(in_srgb,var(--sf-accent)_30%,transparent)]", "peer-disabled:opacity-40 peer-disabled:cursor-not-allowed", "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sf-accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--sf-bg-app)]"), "aria-hidden": "true" }), _jsx("span", { className: cn("pointer-events-none absolute top-0.5", "rounded-full bg-[var(--sf-text-secondary)]", "shadow-[0_1px_3px_rgba(0,0,0,0.4)]", size === "sm" ? "h-4 w-4" : "h-5 w-5", size === "sm"
                            ? "left-0.5 peer-checked:left-[18px]"
                            : "left-0.5 peer-checked:left-[22px]"), style: { transition: "left var(--sf-transition, 150ms) ease-out" } })] }), label && (_jsx("label", { htmlFor: inputId, className: "text-sm text-[var(--sf-text)] cursor-pointer select-none", children: label }))] }));
});
Switch.displayName = "Switch";
