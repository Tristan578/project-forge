import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type InlineAlertVariant = "warning" | "error" | "info";

export interface InlineAlertProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Severity of the notice. Drives both colour tokens and the ARIA role:
   * `error` is assertive (`role="alert"`); `warning` and `info` are polite
   * (`role="status"`).
   */
  variant?: InlineAlertVariant;
  children: ReactNode;
}

// Token-driven only — no raw amber/yellow/red literals. Mirrors the
// border/bg/text pattern already used by Toast and Badge so light/dark theming
// is handled once by the theme variables.
const variantStyles: Record<InlineAlertVariant, string> = {
  warning: [
    "border-[color-mix(in_srgb,var(--sf-warning)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-warning)_12%,var(--sf-bg-surface))]",
    "text-[var(--sf-warning)]",
  ].join(" "),
  error: [
    "border-[color-mix(in_srgb,var(--sf-destructive)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-destructive)_12%,var(--sf-bg-surface))]",
    "text-[var(--sf-destructive)]",
  ].join(" "),
  info: [
    "border-[color-mix(in_srgb,var(--sf-accent)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-accent)_12%,var(--sf-bg-surface))]",
    "text-[var(--sf-accent)]",
  ].join(" "),
};

/**
 * Inline warning / error / info notice box (#9726). One token-driven primitive
 * for the editor's bespoke amber/yellow warning boxes so they look and behave
 * the same everywhere. Accepts any HTML div attributes (e.g. `id` for
 * `aria-describedby` wiring); the ARIA role is derived from `variant` and is
 * not overridable, so the severity contract always holds.
 */
export function InlineAlert({
  variant = "warning",
  className,
  children,
  ...props
}: InlineAlertProps) {
  return (
    <div
      {...props}
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--sf-radius-md)]",
        "border",
        "px-3 py-2 text-xs",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

InlineAlert.displayName = "InlineAlert";
