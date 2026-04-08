import { type HTMLAttributes, type CSSProperties } from "react";
import { cn } from "../utils/cn";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  height?: string;
}

export function ScrollArea({
  className,
  height,
  style,
  children,
  ...props
}: ScrollAreaProps) {
  const computedStyle: CSSProperties = {
    ...style,
    ...(height ? { height } : {}),
  };

  return (
    <div
      className={cn(
        "overflow-auto",
        // Custom scrollbar styling via CSS custom properties
        "[scrollbar-width:thin]",
        "[scrollbar-color:var(--sf-bg-elevated)_transparent]",
        className
      )}
      style={computedStyle}
      {...props}
    >
      {children}
    </div>
  );
}

ScrollArea.displayName = "ScrollArea";
