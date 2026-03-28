import { describe, it, expect } from 'vitest';
import { validateCustomTheme } from '../themeValidator';
import { THEME_DEFINITIONS, type ThemeTokens } from '../../tokens';

describe('Token backward compatibility', () => {
  // Snapshot of the v1 schema token keys at catalog freeze time.
  // If new tokens are added to ThemeTokens, add them here too.
  // This test FAILS if a token is REMOVED from ThemeTokens (breaking change).
  const V1_TOKEN_KEYS: (keyof ThemeTokens)[] = [
    '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
    '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
    '--sf-border', '--sf-border-strong',
    '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
    '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
    '--sf-border-width', '--sf-font-ui', '--sf-font-mono', '--sf-transition',
  ];

  it('all v1 token keys still exist in ThemeTokens (no removals)', () => {
    const darkKeys = Object.keys(THEME_DEFINITIONS.dark) as (keyof ThemeTokens)[];
    for (const key of V1_TOKEN_KEYS) {
      expect(darkKeys, `Token ${key} was removed — breaking change!`).toContain(key);
    }
  });

  it('partial theme (only --sf-accent set) passes validation', () => {
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Partial',
      author: 'test',
      description: '',
      tokens: { '--sf-accent': '#aa00ff' },
    });
    expect(result.ok).toBe(true);
  });

  it('empty tokens object inherits all tokens from Dark theme at render time', () => {
    // validateCustomTheme accepts empty tokens — inheritance happens at applyThemeTokens time
    // (Dark theme CSS vars are applied first as defaults in globals.css, then overrides layer on top)
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Empty',
      author: 'test',
      description: '',
      tokens: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The validated theme has empty tokens — Dark defaults serve as base
      expect(Object.keys(result.theme.tokens)).toHaveLength(0);
    }
  });

  it('v1 schema with tokens added after catalog freeze still validates (additive)', () => {
    // Simulates a theme file that was created when the catalog had fewer tokens.
    // It should still pass validation even if new tokens were added later.
    const subsetTokens = {
      '--sf-accent': '#ff0000',
      '--sf-bg-app': '#000000',
    };
    const result = validateCustomTheme({
      schemaVersion: 1,
      name: 'Legacy',
      author: 'old-user',
      description: 'Created before catalog expansion',
      tokens: subsetTokens,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the provided tokens are in the validated object — missing ones use Dark defaults
      expect(result.theme.tokens['--sf-accent']).toBe('#ff0000');
      expect(result.theme.tokens['--sf-bg-app']).toBe('#000000');
    }
  });
});
