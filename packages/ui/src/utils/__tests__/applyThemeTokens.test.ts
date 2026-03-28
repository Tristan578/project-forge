import { describe, it, expect, beforeEach } from 'vitest';
import { applyThemeTokens } from '../applyThemeTokens';
import { validateCustomTheme, type ValidatedTheme } from '../themeValidator';

describe('applyThemeTokens', () => {
  beforeEach(() => {
    // Clear all custom properties
    document.documentElement.removeAttribute('style');
  });

  it('sets CSS custom properties on document root', () => {
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Test',
      author: '',
      description: '',
      tokens: { '--sf-accent': '#ff00ff' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    applyThemeTokens(result.theme);
    expect(document.documentElement.style.getPropertyValue('--sf-accent')).toBe('#ff00ff');
  });

  it('sets multiple token properties', () => {
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Test',
      author: '',
      description: '',
      tokens: { '--sf-accent': '#ff00ff', '--sf-bg-app': '#000000' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    applyThemeTokens(result.theme);
    expect(document.documentElement.style.getPropertyValue('--sf-accent')).toBe('#ff00ff');
    expect(document.documentElement.style.getPropertyValue('--sf-bg-app')).toBe('#000000');
  });

  it('does nothing for empty tokens object', () => {
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Test',
      author: '',
      description: '',
      tokens: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    applyThemeTokens(result.theme);
    // No custom properties set
    expect(document.documentElement.style.cssText).toBe('');
  });

  it('only accepts ValidatedTheme type (compile-time safety)', () => {
    // This test verifies the type signature — if it compiles, it passes
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: '',
      author: '',
      description: '',
      tokens: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const theme: ValidatedTheme = result.theme;
    applyThemeTokens(theme);
  });
});
