import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          "flex h-9 w-full",
          "rounded-[var(--sf-radius-md)]",
          "border-[length:var(--sf-border-width)] border-[var(--sf-border-strong)]",
          "border-b-[color-mix(in_srgb,var(--sf-accent)_25%,var(--sf-border-strong))]",
          "bg-[var(--sf-bg-app)] text-[var(--sf-text)]",
          "px-3 py-1 text-sm",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]",
          "placeholder:text-[var(--sf-text-muted)]",
          "transition-all duration-[var(--sf-transition)]",
          !error && "hover:border-[var(--sf-text-muted)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sf-bg-app)]",
          "focus-visible:border-[var(--sf-accent)]",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          error &&
            "border-[var(--sf-destructive)] hover:border-[var(--sf-destructive)] focus-visible:ring-[var(--sf-destructive)]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
