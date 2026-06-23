import { type ThemeName, type ThemeTokens } from './colors';
export declare const THEME_DEFINITIONS: Record<ThemeName, ThemeTokens>;
/** Generate CSS custom properties block for a theme */
export declare function generateThemeCSS(theme: ThemeName): string;
/** Generate all theme CSS blocks */
export declare function generateAllThemeCSS(): string;
