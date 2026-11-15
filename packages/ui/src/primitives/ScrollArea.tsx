import { type HTMLAttributes, type CSSProperties, type Ref } from "react";
import { cn } from "../utils/cn";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  height?: string;
  /** The scroll container element (React 19 ref-as-prop). */
  ref?: Ref<HTMLDivElement>;
}

export function ScrollArea({
  className,
  height,
  style,
  children,
  ref,
  ...props
}: ScrollAreaProps) {
  const computedStyle: CSSProperties = {
    ...style,
    ...(height ? { height } : {}),
  };

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-auto",
        // Stop a drag that hits the end of this container from chaining
        // into document scroll -- relevant when this sits inside a
        // scroll-locked dialog (PF-1032 / #9052 acceptance criterion 5).
        "[overscroll-behavior:contain]",
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
