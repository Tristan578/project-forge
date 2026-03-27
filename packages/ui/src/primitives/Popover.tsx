import React, { useState, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';

export interface PopoverProps {
  trigger: ReactNode;
  content: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const sideStyles: Record<NonNullable<PopoverProps['side']>, string> = {
  bottom: 'top-full mt-1',
  top: 'bottom-full mb-1',
  left: 'right-full mr-1 top-0',
  right: 'left-full ml-1 top-0',
};

const alignStyles: Record<NonNullable<PopoverProps['align']>, string> = {
  start: 'left-0',
  center: 'left-0',  // centering done via inline style to avoid translate- classes
  end: 'right-0',
};

const alignInlineStyles: Record<NonNullable<PopoverProps['align']>, React.CSSProperties> = {
  start: {},
  center: { left: '50%', transform: 'translateX(-50%)' },
  end: {},
};

export function Popover({ trigger, content, align = 'start', side = 'bottom', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <div onClick={() => setOpen((v) => !v)}>
        {trigger}
      </div>
      {open && (
        <div
          data-popover-content
          className={cn(
            'absolute',
            'min-w-[8rem]',
            'rounded-[var(--sf-radius-md)]',
            'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
            'bg-[var(--sf-bg-overlay)] text-[var(--sf-text)]',
            'p-2 text-sm',
            'shadow-md',
            sideStyles[side],
            alignStyles[align],
            className,
          )}
          style={{ zIndex: Z_INDEX.panels, ...alignInlineStyles[align] }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
