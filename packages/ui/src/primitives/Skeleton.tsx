import { type HTMLAttributes, type CSSProperties } from 'react';
import { cn } from '../utils/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
  const computedStyle: CSSProperties = {
    ...style,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };

  return (
    <div
      className={cn(
        'animate-pulse',
        'rounded-[var(--sf-radius-md)]',
        'bg-[var(--sf-bg-elevated)]',
        className,
      )}
      style={computedStyle}
      aria-hidden="true"
      {...props}
    />
  );
}
