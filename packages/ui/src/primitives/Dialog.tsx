import { type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { Z_INDEX } from '../tokens';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, actions, className }: DialogProps) {
  const { dialogProps, titleProps } = useDialogA11y({ title, isOpen: open, onClose });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-dialog-overlay
        className="fixed inset-0 bg-[var(--sf-bg-app)]/80 backdrop-blur-sm"
        style={{ zIndex: Z_INDEX.modals - 1 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        {...dialogProps}
        className={cn(
          'fixed',
          'w-full max-w-md',
          'rounded-[var(--sf-radius-lg)]',
          'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
          'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]',
          'shadow-lg',
          'p-6',
          'flex flex-col gap-4',
          className,
        )}
        style={{ zIndex: Z_INDEX.modals, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <div>
          <h2
            {...titleProps}
            className="text-lg font-semibold"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-[var(--sf-text-secondary)]">{description}</p>
          )}
        </div>
        {children && <div className="text-sm">{children}</div>}
        {actions && (
          <div className="flex justify-end gap-2 pt-2">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
