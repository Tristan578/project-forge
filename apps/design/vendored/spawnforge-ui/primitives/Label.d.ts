import { type LabelHTMLAttributes } from "react";
export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
    required?: boolean;
}
export declare function Label({ className, required, children, ...props }: LabelProps): import("react").JSX.Element;
export declare namespace Label {
    var displayName: string;
}
