import { type ThemeName } from '../tokens';
export interface SettingsPanelProps {
    currentTheme: ThemeName;
    onThemeChange: (theme: ThemeName) => void;
    effectsEnabled: boolean;
    onEffectsChange: (enabled: boolean) => void;
    /** If true, shows per-project theme override checkbox per card */
    showPerProjectCheckbox?: boolean;
    /** The per-project theme override (if any) */
    projectTheme?: ThemeName | null;
    onProjectThemeChange?: (theme: ThemeName | null) => void;
    className?: string;
}
export declare function SettingsPanel({ currentTheme, onThemeChange, effectsEnabled, onEffectsChange, showPerProjectCheckbox, projectTheme, onProjectThemeChange, className, }: SettingsPanelProps): import("react/jsx-runtime").JSX.Element;
