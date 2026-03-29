import { type InputHTMLAttributes } from 'react';
type CheckboxBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
export type CheckboxProps = (CheckboxBaseProps & {
    label: string;
    'aria-label'?: string;
}) | (CheckboxBaseProps & {
    label?: never;
    'aria-label': string;
});
export declare function Checkbox({ className, label, id: providedId, ...props }: CheckboxProps): import("react/jsx-runtime").JSX.Element;
export {};
