import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../utils/cn";
// Token-driven only — no raw amber/yellow/red literals. Mirrors the
// border/bg pattern already used by Toast and Badge so light/dark theming is
// handled once by the theme variables. Body text is `--sf-text` (added to the
// base cn below), never the semantic token — see packages/ui/src/primitives/
// InlineAlert.tsx for why (token-on-own-tint fails AA in most themes).
const variantStyles = {
    warning: [
        "border-[color-mix(in_srgb,var(--sf-warning)_40%,transparent)]",
        "bg-[color-mix(in_srgb,var(--sf-warning)_12%,var(--sf-bg-surface))]",
    ].join(" "),
    error: [
        "border-[color-mix(in_srgb,var(--sf-destructive)_40%,transparent)]",
        "bg-[color-mix(in_srgb,var(--sf-destructive)_12%,var(--sf-bg-surface))]",
    ].join(" "),
    info: [
        "border-[color-mix(in_srgb,var(--sf-accent)_40%,transparent)]",
        "bg-[color-mix(in_srgb,var(--sf-accent)_12%,var(--sf-bg-surface))]",
    ].join(" "),
};
/**
 * Inline warning / error / info notice box (#9726). One token-driven primitive
 * for the editor's bespoke amber/yellow warning boxes so they look and behave
 * the same everywhere. Accepts any HTML div attributes (e.g. `id` for
 * `aria-describedby` wiring); the ARIA role is derived from `variant` and is
 * not overridable, so the severity contract always holds.
 */
export function InlineAlert({ variant = "warning", className, children, ...props }) {
    return (_jsx("div", { ...props, role: variant === "error" ? "alert" : "status", className: cn("rounded-[var(--sf-radius-md)]", "border", "px-3 py-2 text-xs", "text-[var(--sf-text)]", variantStyles[variant], className), children: children }));
}
InlineAlert.displayName = "InlineAlert";
