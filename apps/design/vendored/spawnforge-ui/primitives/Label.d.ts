import { type LabelHTMLAttributes } from 'react';
export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
    required?: boolean;
}
export declare function Label({ className, required, children, ...props }: LabelProps): import("react/jsx-runtime").JSX.Element;
