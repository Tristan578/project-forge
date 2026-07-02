export interface ColorPickerProps {
    label: string;
    value: string;
    onChange: (color: string) => void;
    disabled?: boolean;
    className?: string;
}
export declare function ColorPicker({ label, value, onChange, disabled, className, }: ColorPickerProps): import("react").JSX.Element;
