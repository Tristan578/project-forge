'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useDialogA11y } from './useDialogA11y';

interface ConfirmDialogState {
  open: boolean;
  message: string;
  title: string;
}

interface ConfirmDialogProps {
  state: ConfirmDialogState;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ state, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useDialogA11y(onCancel);

  if (!state.open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-6 shadow-lg"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-[var(--sf-text)]">
          {state.title}
        </h2>
        <p id="confirm-dialog-desc" className="mt-2 text-sm text-[var(--sf-text-secondary)]">
          {state.message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-[var(--sf-text-secondary)] hover:bg-[var(--sf-bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Hook that provides an async `confirm(message)` function and a `ConfirmDialogPortal`
 * component to render the dialog. Drop-in replacement for `window.confirm()`.
 *
 * Usage:
 *   const { confirm, ConfirmDialogPortal } = useConfirmDialog();
 *   // Later: if (await confirm('Delete this?')) { ... }
 *   // In JSX: <ConfirmDialogPortal />
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    message: '',
    title: 'Confirm',
  });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, title = 'Confirm'): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, message, title });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const ConfirmDialogPortal = useCallback(
    (): ReactNode => (
      <ConfirmDialog state={state} onConfirm={handleConfirm} onCancel={handleCancel} />
    ),
    [state, handleConfirm, handleCancel],
  );

  return { confirm, ConfirmDialogPortal };
}
