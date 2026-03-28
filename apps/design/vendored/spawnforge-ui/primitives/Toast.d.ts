export type ToastVariant = 'info' | 'success' | 'warning' | 'error';
export interface ToastProps {
    message: string;
    variant?: ToastVariant;
    onDismiss: () => void;
    duration?: number;
    className?: string;
}
export declare function Toast({ message, variant, onDismiss, duration, className }: ToastProps): import("react/jsx-runtime").JSX.Element;
