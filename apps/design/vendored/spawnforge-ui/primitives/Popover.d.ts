import { type ReactNode } from 'react';
export interface PopoverProps {
    trigger: ReactNode;
    content: ReactNode;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;
}
export declare function Popover({ trigger, content, align, side, className }: PopoverProps): import("react/jsx-runtime").JSX.Element;
