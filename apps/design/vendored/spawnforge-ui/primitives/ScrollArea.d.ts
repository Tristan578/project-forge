import { type HTMLAttributes } from "react";
export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
    height?: string;
}
export declare function ScrollArea({ className, height, style, children, ...props }: ScrollAreaProps): import("react").JSX.Element;
export declare namespace ScrollArea {
    var displayName: string;
}
