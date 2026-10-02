import { useEffect, useId, useRef, useCallback } from 'react';

export interface UseDialogA11yOptions {
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

export interface UseDialogA11yReturn {
  dialogProps: {
    role: 'dialog';
    'aria-modal': true;
    'aria-labelledby': string;
    ref: React.RefObject<HTMLDivElement | null>;
  };
  titleProps: {
    id: string;
  };
}

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Marks a focusable element that exists only so keyboard users can scroll it
 * (a scroll container given `tabIndex={0}`, e.g. `Dialog`'s overflowing body).
 * It stays in the Tab order and the focus trap, but initial focus skips it in
 * favour of the first real control: landing on a scroll box when a dialog opens
 * would put the dialog's actual inputs and buttons one Tab further away.
 */
export const SCROLL_REGION_ATTR = 'data-sf-scroll-region';

/**
 * Provides ARIA attributes for modal/dialog components.
 * Handles:
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby wired to the title element
 *   - Escape key -> onClose
 *   - Focus trap: Tab cycles within the dialog
 *   - Initial focus: first focusable element that is not a keyboard-scroll
 *     region (`SCROLL_REGION_ATTR`), else that region, else the container
 *   - Focus return to trigger on close
 */
export function useDialogA11y({
  title: _title,
  isOpen,
  onClose,
}: UseDialogA11yOptions): UseDialogA11yReturn {
  const titleId = useId();
  const triggerRef = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Capture the element that opened the dialog so we can return focus on close.
  // Also move focus into the dialog when it opens.
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      // Defer focus so the dialog is fully painted
      const frame = requestAnimationFrame(() => {
        if (!dialogRef.current) return;
        // Another effect inside the dialog's own subtree (e.g. a
        // gate/step-specific autofocus) can run and set focus BEFORE this
        // deferred callback actually fires -- `isOpen` staying true across a
        // content change never re-schedules this effect, so a callback
        // scheduled at open time can still be pending when the dialog's
        // content has since changed shape. Re-querying and forcing focus
        // onto whatever is now first in the DOM would silently steal focus
        // back from that more specific, intentional choice (PF-1215 round
        // 2, 4/5: this previously only got papered over in a test helper
        // that waited out the race rather than the hook respecting it).
        if (dialogRef.current.contains(document.activeElement)) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        );
        // Prefer a real control over a keyboard-scroll region; fall back to
        // the region only when it is the one focusable thing in the dialog.
        const initial =
          focusable.find((el) => !el.hasAttribute(SCROLL_REGION_ATTR)) ?? focusable[0];
        if (initial) {
          initial.focus();
        } else {
          dialogRef.current.focus();
        }
      });
      return () => cancelAnimationFrame(frame);
    } else if (triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        ).filter((el) => !el.closest('[aria-hidden="true"]'));

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          // Shift+Tab: wrap from first → last
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: wrap from last → first
          if (active === last || !dialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [isOpen, onClose],
  );

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
