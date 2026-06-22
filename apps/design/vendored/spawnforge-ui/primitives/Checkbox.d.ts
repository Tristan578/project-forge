import { type InputHTMLAttributes } from "react";
type CheckboxBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export type CheckboxProps = (CheckboxBaseProps & {
    label: string;
    "aria-label"?: string;
}) | (CheckboxBaseProps & {
    label?: never;
    "aria-label": string;
});
export declare const Checkbox: import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLInputElement>>;
export {};
