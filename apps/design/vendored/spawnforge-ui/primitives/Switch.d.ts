import { type InputHTMLAttributes } from 'react';
type SwitchBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>;
export type SwitchProps = (SwitchBaseProps & {
    label: string;
    'aria-label'?: string;
    size?: 'sm' | 'md';
}) | (SwitchBaseProps & {
    label?: never;
    'aria-label': string;
    size?: 'sm' | 'md';
});
export declare function Switch({ className, label, size, id: providedId, ...props }: SwitchProps): import("react/jsx-runtime").JSX.Element;
export {};
