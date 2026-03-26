import { useEffect, useRef, type RefObject } from 'react';

/**
 * Shared hook for modal dialog accessibility (WCAG 2.1 SC 2.1.2).
 *
 * Provides:
 * 1. Focus trap — Tab/Shift-Tab cycles within the dialog
 * 2. Escape key — calls onClose
 * 3. Auto-focus — moves focus into the dialog on mount
 *
 * Usage:
 *   const dialogRef = useDialogA11y(onClose);
 *   <div ref={dialogRef} role="dialog" aria-modal="true" ...>
 */
export function useDialogA11y(onClose?: () => void): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Auto-focus the first focusable element (or the dialog itself)
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      dialog.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const el = dialogRef.current;
        if (!el) return;
        const nodes = el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return dialogRef;
}
