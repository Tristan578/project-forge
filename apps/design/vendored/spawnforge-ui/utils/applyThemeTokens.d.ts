import type { ThemeTokens } from '../tokens';
import type { ValidatedTheme } from './themeValidator';
/**
 * Trusted token source accepted by applyThemeTokens.
 * Built-in themes (compile-time constants) may pass { tokens: ThemeTokens } directly
 * without going through validateCustomTheme, since their values are not user-supplied.
 */
export type TrustedTokenSource = ValidatedTheme | {
    readonly tokens: ThemeTokens;
};
/**
 * Apply theme tokens to the DOM.
 * This is the SOLE call site for style.setProperty with theme values.
 * Accepts either a ValidatedTheme (custom themes) or a trusted built-in
 * { tokens: ThemeTokens } object (compile-time constants).
 * Never pass raw parsed JSON — use validateCustomTheme() first for user-supplied input.
 */
export declare function applyThemeTokens(theme: TrustedTokenSource): void;
