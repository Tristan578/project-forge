/** Shared labelled range editor with readable values, visible handles and responsive touch targets. */
import { type InputHTMLAttributes } from 'react';
/** Controlled range value, optional bounds/readout and native input attributes. */
export interface SliderInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
    /** Visible label and accessible name for the range input. */
    label: string;
    /** Committed numeric range value provided by the parent. */
    value: number;
    /** Receives the native range value converted to a number. */
    onChange: (value: number) => void;
    /** Native inclusive lower bound; defaults to 0. */
    min?: number;
    /** Native inclusive upper bound; defaults to 100. */
    max?: number;
    /** Native increment; defaults to 1. */
    step?: number;
    /** Shows the live value readout beside the label; defaults to true. */
    showValue?: boolean;
    /** Optional display-only formatter; does not change committed values. */
    formatValue?: (value: number) => string;
}
/**
 * Renders a controlled range with an associated label and optional live readout.
 * Defaults to bounds 0–100 and step 1. Mobile uses a 44px input target around a
 * centered 6px rail; from the small breakpoint the input is compact at 6px.
 * Both browser thumb styles use the primary foreground for a visible handle.
 * @param props Controlled value/callback, label, range limits and native attributes.
 * @returns A labelled range editor and an optional formatted value readout.
 */
export declare function SliderInput({ label, value, onChange, min, max, step, showValue, formatValue, className, disabled, ...props }: SliderInputProps): import("react").JSX.Element;
