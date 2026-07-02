import { type HTMLAttributes } from "react";
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: "default" | "success" | "warning" | "destructive";
}
export declare function Badge({ className, variant, children, ...props }: BadgeProps): import("react").JSX.Element;
export declare namespace Badge {
    var displayName: string;
}
