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
export declare function useDialogA11y({ title: _title, isOpen, onClose, }: UseDialogA11yOptions): UseDialogA11yReturn;
