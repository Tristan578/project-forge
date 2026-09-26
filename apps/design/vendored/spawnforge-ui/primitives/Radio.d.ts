import { type InputHTMLAttributes } from 'react';
/** Native input props; use a shared name for mutually exclusive options.
 * className styles the outer clickable label. The forwarded ref targets the input.
 */
export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    /** Visible and accessible option name. */
    label: string;
    /** Optional help text, associated through aria-describedby. */
    description?: string;
}
/** Native keyboard behavior with a full-option touch target and theme colors. */
export declare const Radio: import("react").ForwardRefExoticComponent<RadioProps & import("react").RefAttributes<HTMLInputElement>>;
