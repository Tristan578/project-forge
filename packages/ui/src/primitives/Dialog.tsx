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
        className="fixed inset-0 bg-[color-mix(in_srgb,var(--sf-bg-app)_70%,transparent)] backdrop-blur-sm"
        style={{ zIndex: Z_INDEX.modals - 1 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        {...dialogProps}
        tabIndex={-1}
        className={cn(
          'fixed',
          'w-full max-w-md',
          'rounded-[var(--sf-radius-xl)]',
          'border border-[var(--sf-border)]',
          'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]',
          'flex flex-col',
          className,
        )}
        style={{ zIndex: Z_INDEX.modals, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h2
            {...titleProps}
            className="text-lg font-semibold tracking-tight"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm text-[var(--sf-text-secondary)] leading-relaxed">{description}</p>
          )}
        </div>
        {/* Body */}
        {children && <div className="px-6 py-3 text-sm">{children}</div>}
        {/* Actions */}
        {actions && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--sf-border)] bg-[var(--sf-bg-app)]/30 rounded-b-[var(--sf-radius-xl)]">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
