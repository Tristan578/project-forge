/** Complete built-in theme palettes and generated CSS, including verified status color pairs. */
import { type ThemeName, type ThemeTokens } from './colors';
/** Complete built-in palettes; every theme includes the shared readable status pairs. */
export declare const THEME_DEFINITIONS: Record<ThemeName, ThemeTokens>;
/** Generate CSS custom properties block for a theme */
export declare function generateThemeCSS(theme: ThemeName): string;
/** Generate all theme CSS blocks */
export declare function generateAllThemeCSS(): string;
