import React, { type ReactNode } from "react";
export interface PopoverProps {
    trigger: ReactNode;
    content: ReactNode;
    align?: "start" | "center" | "end";
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
    "aria-label"?: string;
    /** When true, the trigger is already an interactive element — skip the wrapper button. */
    asChild?: boolean;
}
export declare function Popover({ trigger, content, align, side, className, "aria-label": ariaLabel, asChild, }: PopoverProps): React.JSX.Element;
export declare namespace Popover {
    var displayName: string;
}
