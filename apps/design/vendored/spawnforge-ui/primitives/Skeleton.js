import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../utils/cn";
export function Skeleton({ className, width, height, style, ...props }) {
    const computedStyle = {
        ...style,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
    };
    return (_jsx("div", { className: cn("motion-safe:animate-pulse", "rounded-[var(--sf-radius-md)]", "bg-[var(--sf-bg-elevated)]", "bg-gradient-to-r from-[var(--sf-bg-elevated)] via-[color-mix(in_srgb,var(--sf-accent)_18%,var(--sf-bg-overlay))] to-[var(--sf-bg-elevated)]", "bg-[length:200%_100%]", className), style: computedStyle, "aria-hidden": "true", ...props }));
}
Skeleton.displayName = "Skeleton";
