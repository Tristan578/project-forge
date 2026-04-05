import { type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface PropertyGridItem {
  label: string;
  value: ReactNode;
  id?: string;
}

export interface PropertyGridProps {
  items: PropertyGridItem[];
  labelWidth?: string;
  className?: string;
}

export function PropertyGrid({
  items,
  labelWidth = '100px',
  className,
}: PropertyGridProps) {
  return (
    <div
      className={cn('flex flex-col', className)}
      role="group"
      aria-label="Properties"
    >
      {items.map((item, index) => (
        <div
          key={item.id ?? index}
          className="flex items-start gap-2 py-1.5 px-2"
          style={{
            borderBottom: index < items.length - 1 ? '1px solid var(--sf-border)' : undefined,
          }}
        >
          <span
            className="shrink-0 text-xs font-medium truncate"
            style={{
              width: labelWidth,
              color: 'var(--sf-text-secondary)',
            }}
          >
            {item.label}
          </span>
          <div className="flex-1 min-w-0 text-xs" style={{ color: 'var(--sf-text)' }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
