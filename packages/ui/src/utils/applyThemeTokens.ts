import type { ValidatedTheme } from './themeValidator';

/**
 * Apply validated custom theme tokens to the DOM.
 * This is the SOLE call site for style.setProperty with theme values.
 * Only accepts ValidatedTheme — never raw parsed JSON.
 */
export function applyThemeTokens(theme: ValidatedTheme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (typeof value === 'string') {
      root.style.setProperty(key, value);
    }
  }
}
