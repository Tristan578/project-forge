import { type HTMLAttributes } from 'react';
export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
    height?: string;
}
export declare function ScrollArea({ className, height, style, children, ...props }: ScrollAreaProps): import("react/jsx-runtime").JSX.Element;
