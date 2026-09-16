/** Controlled vector, axis editing options and optional reset action. */
export interface Vec3InputProps {
    /** Visible group label; each axis receives this label plus X, Y or Z. */
    label: string;
    /** Finite committed values in XYZ order. */
    value: [number, number, number];
    /** Receives the full vector after a finite edit, with optional axis bounds applied. */
    onChange: (value: [number, number, number]) => void;
    /** Parent action shown when a default vector is supplied and the value differs. */
    onReset?: () => void;
    /** Reference vector used to determine whether the reset action is visible. */
    defaultValue?: [number, number, number];
    /** Native number-input increment; defaults to 0.1. */
    step?: number;
    /** Resting display decimal places, default 3; does not round committed edits. */
    precision?: number;
    /** Optional inclusive lower bound applied independently to each axis. */
    min?: number;
    /** Optional inclusive upper bound applied independently to each axis. */
    max?: number;
    /** Disables all axis inputs and the reset action. */
    disabled?: boolean;
    /** Additional classes for the outer group. */
    className?: string;
}
/**
 * Edits XYZ axes while retaining raw drafts, including empty intermediate edits.
 * Only finite edits commit; optional bounds clamp the edited axis. Blur discards
 * the draft and restores the parent value, rounded for display to precision
 * (default 3), without changing its committed precision. The default step is 0.1.
 * @param props Controlled vector, label, optional reset action and axis editing options.
 * @returns An accessible labelled group of three numeric axis inputs.
 */
export declare function Vec3Input({ label, value, onChange, onReset, defaultValue, step, precision, min, max, disabled, className, }: Vec3InputProps): import("react").JSX.Element;
