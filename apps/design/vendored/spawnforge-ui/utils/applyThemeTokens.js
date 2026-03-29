/**
 * Apply theme tokens to the DOM.
 * This is the SOLE call site for style.setProperty with theme values.
 * Accepts either a ValidatedTheme (custom themes) or a trusted built-in
 * { tokens: ThemeTokens } object (compile-time constants).
 * Never pass raw parsed JSON — use validateCustomTheme() first for user-supplied input.
 */
export function applyThemeTokens(theme) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.tokens)) {
        if (typeof value === 'string') {
            root.style.setProperty(key, value);
        }
    }
}
