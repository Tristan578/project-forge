import { type LabelHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-sm font-medium text-[var(--sf-text)]",
        "leading-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <span
          className="ml-0.5 text-[var(--sf-destructive)]"
          aria-hidden="true"
        >
          *
        </span>
      )}
    </label>
  );
}

Label.displayName = "Label";
