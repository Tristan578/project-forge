import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type InlineAlertVariant = "warning" | "error" | "info";

export interface InlineAlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  /**
   * Severity of the notice. Drives both colour tokens and the ARIA role:
   * `error` is assertive (`role="alert"`); `warning` and `info` are polite
   * (`role="status"`). `role` itself is not a prop — it is always derived
   * from `variant` and cannot be overridden.
   */
  variant?: InlineAlertVariant;
  children: ReactNode;
}

// Token-driven only — no raw amber/yellow/red literals. Mirrors the
// border/bg pattern already used by Toast and Badge so light/dark theming is
// handled once by the theme variables.
//
// The BODY TEXT is `--sf-text`, added to the base `cn(...)` below — NOT the
// semantic token. A variant must never paint its own semantic token as text on
// top of a 12% tint of that same token: `--sf-warning`/`--sf-destructive`/
// `--sf-accent` are pinned only at the WCAG 1.4.11 non-text floor (3:1) and
// have no paired `-foreground` token, so token-on-own-tint fails AA 4.5:1 in
// most themes (as low as ~2.9:1 for destructive in rust). This is the exact
// pairing PF-1229 removed from OrchestratorPanel, and Toast.tsx pairs the same
// border-40%/tint-over-surface recipe with `--sf-text` for the same reason.
// Graded in tokens/__tests__/themes.test.ts (InlineAlert 12% tint cases).
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
        "text-[var(--sf-text)]",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

InlineAlert.displayName = "InlineAlert";
