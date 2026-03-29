import { type ThemeName } from '../tokens';
export interface UseThemeOptions {
    projectTheme?: ThemeName | null;
}
export declare function useTheme(options?: UseThemeOptions): {
    theme: "dark" | "light" | "ember" | "rust" | "ice" | "leaf" | "mech";
    setTheme: (newTheme: ThemeName) => void;
    effectsEnabled: boolean;
    setEffectsEnabled: (enabled: boolean) => void;
    themes: readonly ["dark", "light", "ember", "rust", "ice", "leaf", "mech"];
};
