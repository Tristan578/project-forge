import { type HTMLAttributes } from 'react';
export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
    value: number;
    max?: number;
    label?: string;
}
export declare function Progress({ className, value, max, label, ...props }: ProgressProps): import("react/jsx-runtime").JSX.Element;
