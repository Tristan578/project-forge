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
  };
  titleProps: {
    id: string;
  };
}

/**
 * Provides ARIA attributes for modal/dialog components.
 * Handles:
 *   - role="dialog" + aria-modal="true"
 *   - aria-labelledby wired to the title element
 *   - Escape key -> onClose
 *   - Focus return to trigger on close
 */
export function useDialogA11y({
  title: _title,
  isOpen,
  onClose,
}: UseDialogA11yOptions): UseDialogA11yReturn {
  const titleId = useId();
  const triggerRef = useRef<Element | null>(null);

  // Capture the element that opened the dialog so we can return focus on close
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
    } else if (triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        onClose();
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
    },
    titleProps: {
      id: titleId,
    },
  };
}
