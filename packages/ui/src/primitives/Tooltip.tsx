import { useState, useId, type ReactNode, type HTMLAttributes } from 'react';
import type React from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

const sidePositions: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full mb-1',
  bottom: 'top-full mt-1',
  left: 'right-full mr-1',
  right: 'left-full ml-1',
};

const sideAlignStyles: Record<NonNullable<TooltipProps['side']>, React.CSSProperties> = {
  top: { left: '50%', transform: 'translateX(-50%)' },
  bottom: { left: '50%', transform: 'translateX(-50%)' },
  left: { top: '50%', transform: 'translateY(-50%)' },
  right: { top: '50%', transform: 'translateY(-50%)' },
};

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <div
        id={tooltipId}
        role="tooltip"
        className={cn(
          'absolute pointer-events-none',
          'px-2 py-1 text-xs',
          'rounded-[var(--sf-radius-sm)]',
          'bg-[var(--sf-bg-overlay)] text-[var(--sf-text)]',
          'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
          'whitespace-nowrap',
          'transition-opacity duration-[var(--sf-transition)]',
          visible ? 'opacity-100' : 'opacity-0',
          sidePositions[side],
        )}
        style={{ zIndex: Z_INDEX.tooltips, ...sideAlignStyles[side] }}
        aria-hidden={!visible}
      >
        {content}
      </div>
    </div>
  );
}

// Helper type for elements that want to describe their own tooltip
export interface TooltipTriggerProps extends HTMLAttributes<HTMLElement> {
  'aria-describedby'?: string;
}
