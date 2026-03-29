import { type ReactNode } from 'react';
export interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children?: ReactNode;
    actions?: ReactNode;
    className?: string;
}
export declare function Dialog({ open, onClose, title, description, children, actions, className }: DialogProps): import("react/jsx-runtime").JSX.Element | null;
