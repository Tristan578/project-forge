import { type HTMLAttributes, type CSSProperties } from "react";
import { cn } from "../utils/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

export function Skeleton({
  className,
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  const computedStyle: CSSProperties = {
    ...style,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };

  return (
    <div
      className={cn(
        "motion-safe:animate-pulse",
        "rounded-[var(--sf-radius-md)]",
        "bg-[var(--sf-bg-elevated)]",
        "bg-gradient-to-r from-[var(--sf-bg-elevated)] via-[color-mix(in_srgb,var(--sf-accent)_18%,var(--sf-bg-overlay))] to-[var(--sf-bg-elevated)]",
        "bg-[length:200%_100%]",
        className
      )}
      style={computedStyle}
      aria-hidden="true"
      {...props}
    />
  );
}

Skeleton.displayName = "Skeleton";
