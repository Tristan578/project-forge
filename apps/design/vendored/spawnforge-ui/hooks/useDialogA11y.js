import { useEffect, useId, useRef, useCallback } from 'react';
const FOCUSABLE_SELECTORS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/**
 * Provides ARIA attributes for modal/dialog components.
 * Handles:
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby wired to the title element
 *   - Escape key -> onClose
 *   - Focus trap: Tab cycles within the dialog
 *   - Initial focus: first focusable element (or dialog container) on open
 *   - Focus return to trigger on close
 */
export function useDialogA11y({ title: _title, isOpen, onClose, }) {
    const titleId = useId();
    const triggerRef = useRef(null);
    const dialogRef = useRef(null);
    // Capture the element that opened the dialog so we can return focus on close.
    // Also move focus into the dialog when it opens.
    useEffect(() => {
        if (isOpen) {
            triggerRef.current = document.activeElement;
            // Defer focus so the dialog is fully painted
            const frame = requestAnimationFrame(() => {
                if (!dialogRef.current)
                    return;
                const focusable = dialogRef.current.querySelectorAll(FOCUSABLE_SELECTORS);
                if (focusable.length > 0) {
                    focusable[0].focus();
                }
                else {
                    dialogRef.current.focus();
                }
            });
            return () => cancelAnimationFrame(frame);
        }
        else if (triggerRef.current instanceof HTMLElement) {
            triggerRef.current.focus();
            triggerRef.current = null;
        }
    }, [isOpen]);
    // Escape key handler
    const handleKeyDown = useCallback((e) => {
        if (!isOpen)
            return;
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
        }
        if (e.key === 'Tab' && dialogRef.current) {
            const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTORS)).filter((el) => !el.closest('[aria-hidden="true"]'));
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (e.shiftKey) {
                // Shift+Tab: wrap from first → last
                if (active === first || !dialogRef.current.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            }
            else {
                // Tab: wrap from last → first
                if (active === last || !dialogRef.current.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }, [isOpen, onClose]);
    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
    return {
        dialogProps: {
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': titleId,
            ref: dialogRef,
        },
        titleProps: {
            id: titleId,
        },
    };
}
