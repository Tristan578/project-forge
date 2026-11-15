/** Shared inline notices with themed severity borders and backgrounds. */
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

/** Supported notice severities. */
export type InlineAlertVariant = "warning" | "error" | "info";

/** Notice content and div attributes, excluding the variant-controlled role. */
export interface InlineAlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /**
   * Severity of the notice. Drives both colour tokens and the ARIA role:
   * `error` is assertive (`role="alert"`); `warning` and `info` are polite
   * (`role="status"`). `role` itself is not a prop — it is always derived
   * from `variant` and cannot be overridden.
   */
  variant?: InlineAlertVariant;
  /** Required message content, which may include recovery controls. */
  children: ReactNode;
}

// Token-driven only — no raw amber/yellow/red literals. Mirrors the
// border/bg/text pattern already used by Toast and Badge so light/dark theming
// is handled once by the theme variables.
const variantStyles: Record<InlineAlertVariant, string> = {
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
 * the same everywhere. Accepts HTML div attributes excluding `role` (e.g. `id` for
 * `aria-describedby` wiring); the ARIA role is derived from `variant` and is
 * not overridable. Explicit `aria-live` attributes retain normal HTML behavior.
 * Defaults to `warning`; severity colours the border/background, while body
 * text uses the theme foreground for readable contrast.
 * @param props - Message content, optional severity and supported div attributes.
 * @returns A themed div with the severity-derived alert or status role.
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
        "px-3 py-2 text-xs text-[var(--sf-text)]",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

InlineAlert.displayName = "InlineAlert";
