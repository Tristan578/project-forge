export interface KeyboardShortcut {
    id: string;
    label: string;
    keys: string[];
}
export interface ShortcutGroup {
    title: string;
    shortcuts: KeyboardShortcut[];
}
export interface KeyboardShortcutsPanelProps {
    groups: ShortcutGroup[];
    onClose?: () => void;
    className?: string;
}
export declare function KeyboardShortcutsPanel({ groups, onClose, className, }: KeyboardShortcutsPanelProps): import("react/jsx-runtime").JSX.Element;
