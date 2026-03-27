import { type HTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'bg-[var(--sf-border)]',
        orientation === 'horizontal'
          ? 'h-[var(--sf-border-width,1px)] w-full'
          : 'h-full w-[var(--sf-border-width,1px)]',
        'shrink-0',
        className,
      )}
      {...props}
    />
  );
}
