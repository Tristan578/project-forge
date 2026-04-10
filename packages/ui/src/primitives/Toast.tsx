import { useEffect } from "react";
import { cn } from "../utils/cn";
import { Z_INDEX } from "../tokens";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  duration?: number;
  className?: string;
}

const variantStyles: Record<ToastVariant, string> = {
  info: "border-[var(--sf-border-strong)] bg-[var(--sf-bg-surface)]",
  success: [
    "border-[color-mix(in_srgb,var(--sf-success)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-success)_8%,var(--sf-bg-surface))]",
  ].join(" "),
  warning: [
    "border-[color-mix(in_srgb,var(--sf-warning)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-warning)_8%,var(--sf-bg-surface))]",
  ].join(" "),
  error: [
    "border-[color-mix(in_srgb,var(--sf-destructive)_40%,transparent)]",
    "bg-[color-mix(in_srgb,var(--sf-destructive)_8%,var(--sf-bg-surface))]",
  ].join(" "),
};

const variantAccent: Record<ToastVariant, string> = {
  info: "bg-[var(--sf-accent)]",
  success: "bg-[color-mix(in_srgb,var(--sf-accent)_25%,var(--sf-success))]",
  warning: "bg-[color-mix(in_srgb,var(--sf-accent)_25%,var(--sf-warning))]",
  error: "bg-[color-mix(in_srgb,var(--sf-accent)_25%,var(--sf-destructive))]",
};

export function Toast({
  message,
  variant = "info",
  onDismiss,
  duration = 5000,
  className,
}: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(), duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 overflow-hidden",
        "rounded-[var(--sf-radius-md)]",
        "border",
        "px-4 py-3",
        "text-sm text-[var(--sf-text)]",
        "shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]",
        variantStyles[variant],
        className
      )}
      style={{ zIndex: Z_INDEX.toasts }}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      {/* Left accent bar */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-0.5",
          variantAccent[variant]
        )}
      />
      <span className="flex-1 pl-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          "shrink-0 p-0.5",
          "text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]",
          "transition-colors duration-[var(--sf-transition)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]",
          "rounded-[var(--sf-radius-sm)]"
        )}
        aria-label="Dismiss"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

Toast.displayName = "Toast";
