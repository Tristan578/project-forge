export interface Vec3InputProps {
    label: string;
    value: [number, number, number];
    onChange: (value: [number, number, number]) => void;
    onReset?: () => void;
    defaultValue?: [number, number, number];
    step?: number;
    precision?: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    className?: string;
}
export declare function Vec3Input({ label, value, onChange, onReset, defaultValue, step, precision, min, max, disabled, className, }: Vec3InputProps): import("react/jsx-runtime").JSX.Element;
