import { type InputHTMLAttributes } from 'react';
export interface SliderInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    showValue?: boolean;
    formatValue?: (value: number) => string;
}
export declare function SliderInput({ label, value, onChange, min, max, step, showValue, formatValue, className, disabled, ...props }: SliderInputProps): import("react").JSX.Element;
