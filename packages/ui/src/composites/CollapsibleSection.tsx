import { useState, useId, type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  headerRight,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      className={cn('border-b', className)}
      style={{ borderColor: 'var(--sf-border)' }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={cn(
          'flex items-center justify-between w-full px-3 py-2 text-xs font-medium',
          'transition-colors duration-100 cursor-pointer',
        )}
        style={{
          color: 'var(--sf-text)',
          backgroundColor: 'var(--sf-bg-surface)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={cn('transition-transform duration-100', isOpen && 'rotate-90')}
            style={{ color: 'var(--sf-text-muted)' }}
          >
            <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {title}
        </div>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>
        )}
      </button>
      <div id={contentId} hidden={!isOpen}>
        {isOpen && (
          <div className="px-3 py-2">{children}</div>
        )}
      </div>
    </div>
  );
}
