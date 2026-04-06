'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  titleId: string;
  descId: string;
}

function ConfirmDialog({ state, onConfirm, onCancel, titleId, descId }: ConfirmDialogProps) {
  const dialogRef = useDialogA11y(onCancel);

  if (!state.open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-[var(--sf-bg-app)]/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold text-[var(--sf-text)]">
          {state.title}
        </h2>
        <p id={descId} className="mt-2 text-sm text-[var(--sf-text-secondary)]">
          {state.message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-[var(--sf-text-secondary)] hover:bg-[var(--sf-bg-elevated)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-[var(--sf-destructive)] px-3 py-1.5 text-sm text-[var(--sf-on-accent)] hover:opacity-90"
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
  const instanceId = useId();
  const titleId = `confirm-title-${instanceId}`;
  const descId = `confirm-desc-${instanceId}`;

  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    message: '',
    title: 'Confirm',
  });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  // Clean up on unmount: resolve pending promise as false
  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const confirm = useCallback((message: string, title = 'Confirm'): Promise<boolean> => {
    // If already open, resolve previous as false before opening new
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
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
      <ConfirmDialog
        state={state}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        titleId={titleId}
        descId={descId}
      />
    ),
    [state, handleConfirm, handleCancel, titleId, descId],
  );

  return { confirm, ConfirmDialogPortal };
}
