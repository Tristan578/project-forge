import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  footer?: ReactNode;
}

export function Card({ className, title, footer, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--sf-radius-lg)]',
        'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
        'bg-[var(--sf-bg-surface)]',
        'text-[var(--sf-text)]',
        'shadow-sm',
        className,
      )}
      {...props}
    >
      {title && (
        <div className="px-4 py-3 border-b border-[length:var(--sf-border-width)] border-[var(--sf-border)]">
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && (
        <div className="px-4 py-3 border-t border-[length:var(--sf-border-width)] border-[var(--sf-border)] text-sm text-[var(--sf-text-muted)]">
          {footer}
        </div>
      )}
    </div>
  );
}
