import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            "flex h-9 w-full appearance-none",
            "rounded-[var(--sf-radius-md)]",
            "border-[length:var(--sf-border-width)] border-[var(--sf-border-strong)]",
            "border-b-[color-mix(in_srgb,var(--sf-accent)_25%,var(--sf-border-strong))]",
            "bg-[var(--sf-bg-app)] text-[var(--sf-text)]",
            "px-3 pr-9 py-1 text-sm",
            "shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]",
            "transition-all duration-[var(--sf-transition)]",
            "hover:border-[var(--sf-text-muted)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sf-bg-app)]",
            "focus-visible:border-[var(--sf-accent)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {/* Chevron icon */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-[var(--sf-accent)]/60">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
    );
  }
);

Select.displayName = "Select";
