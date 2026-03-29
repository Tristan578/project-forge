import { type HTMLAttributes } from 'react';
export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
    orientation?: 'horizontal' | 'vertical';
}
export declare function Separator({ className, orientation, ...props }: SeparatorProps): import("react/jsx-runtime").JSX.Element;
