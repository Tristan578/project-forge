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
        'border border-[var(--sf-border)]',
        'bg-[var(--sf-bg-surface)]',
        'text-[var(--sf-text)]',
        'shadow-[0_2px_8px_rgba(0,0,0,0.3),0_1px_2px_rgba(0,0,0,0.2)]',
        className,
      )}
      {...props}
    >
      {title && (
        <div className="px-4 py-3 border-b border-[var(--sf-border)]">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && (
        <div className="px-4 py-3 border-t border-[var(--sf-border)] bg-[var(--sf-bg-app)]/50 text-sm text-[var(--sf-text-secondary)] rounded-b-[var(--sf-radius-lg)]">
          {footer}
        </div>
      )}
    </div>
  );
}
