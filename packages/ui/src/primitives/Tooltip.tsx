import { useState, useId, cloneElement, isValidElement, type ReactNode, type HTMLAttributes } from 'react';
import type React from 'react';
import { cn } from '../utils/cn';
import { Z_INDEX } from '../tokens';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const sidePositions: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
  left: 'right-full mr-2',
  right: 'left-full ml-2',
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

  const childWithAriaDescribedBy = isValidElement(children)
    ? cloneElement(children as React.ReactElement<HTMLAttributes<HTMLElement>>, {
        'aria-describedby': tooltipId,
      })
    : children;

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {childWithAriaDescribedBy}
      <div
        id={tooltipId}
        role="tooltip"
        className={cn(
          'absolute pointer-events-none',
          'px-2.5 py-1.5 text-xs font-medium',
          'rounded-[var(--sf-radius-md)]',
          'bg-[var(--sf-bg-overlay)] text-[var(--sf-text)]',
          'border border-[var(--sf-border-strong)]',
          'shadow-[0_4px_12px_rgba(0,0,0,0.4)]',
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

export interface TooltipTriggerProps extends HTMLAttributes<HTMLElement> {
  'aria-describedby'?: string;
}
