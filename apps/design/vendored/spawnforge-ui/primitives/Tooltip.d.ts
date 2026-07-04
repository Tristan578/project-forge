import { type ReactNode, type HTMLAttributes } from "react";
import type React from "react";
export interface TooltipProps {
    content: ReactNode;
    children: ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
}
export declare function Tooltip({ content, children, side, className, }: TooltipProps): React.JSX.Element;
export declare namespace Tooltip {
    var displayName: string;
}
export interface TooltipTriggerProps extends HTMLAttributes<HTMLElement> {
    "aria-describedby"?: string;
}
