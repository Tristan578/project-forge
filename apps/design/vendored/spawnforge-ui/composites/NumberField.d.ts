import { type InputHTMLAttributes } from 'react';
export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
    /** Visible label and accessible name for the input. */
    label: string;
    /** Finite value committed by the controlled parent. */
    value: number;
    /** Receives finite edits clamped to the optional bounds. */
    onChange: (value: number) => void;
    /** Optional inclusive lower bound. */
    min?: number;
    /** Optional inclusive upper bound. */
    max?: number;
    /** Native number-input increment; defaults to 0.1. */
    step?: number;
}
/**
 * A labelled numeric input row. The visible `label` is associated with the
 * `<input>` through a matching `htmlFor`/`id` pair (caller ID or `useId`), so it has
 * a programmatic accessible name (`getByLabelText(label)` resolves to it) rather
 * than a visual label sitting next to an unassociated input.
 *
 * This replaces the bespoke `NumberInputRow` that both the Reverb Zone and Audio
 * inspectors previously carried verbatim, closing the duplication-with-drift the
 * copies had already fallen into (one gained label association, the other did
 * not). Consumers that need a help tooltip compose it alongside this composite.
 * Empty drafts remain editable without dispatching; blur restores the committed
 * value and also invokes a caller-provided blur handler.
 * @param props Controlled value/callback, label, bounds and native input attributes.
 * @returns A labelled numeric editor that retains raw drafts while editing.
 */
export declare function NumberField({ label, value, onChange, min, max, step, className, disabled, id: providedId, onBlur, ...props }: NumberFieldProps): import("react").JSX.Element;
