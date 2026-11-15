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
    '--sf-accent', '--sf-accent-hover', '--sf-accent-active', '--sf-on-accent', '--sf-destructive', '--sf-success', '--sf-warning',
    // Status-colour semantic (PF-1068 / #9108) — four healthy/degraded/down/
    // unknown bg/fg pairs. Listed here so this removal guard fails if any is
    // later dropped from ThemeTokens.
    '--sf-status-healthy-bg', '--sf-status-healthy-fg',
    '--sf-status-degraded-bg', '--sf-status-degraded-fg',
    '--sf-status-down-bg', '--sf-status-down-fg',
    '--sf-status-unknown-bg', '--sf-status-unknown-fg',
    '--sf-status-healthy-indicator', '--sf-status-degraded-indicator',
    '--sf-status-down-indicator', '--sf-status-unknown-indicator',
    '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
    '--sf-border-width', '--sf-font-ui', '--sf-font-mono', '--sf-transition',
  ];

  it('all v1 token keys still exist in ThemeTokens (no removals)', () => {
    const darkKeys = Object.keys(THEME_DEFINITIONS.dark) as (keyof ThemeTokens)[];
    for (const key of V1_TOKEN_KEYS) {
      expect(darkKeys, `Token ${key} was removed — breaking change!`).toContain(key);
    }
  });

  it('validateCustomTheme accepts every catalog token — no token is silently dropped', () => {
    // Drift guard: validateCustomTheme()'s ALL_VALID_KEYS must stay in 1:1 sync with
    // THEME_DEFINITIONS. Feeding each catalog token its own built-in Dark value must
    // round-trip it into the validated theme; a key missing from the validator's
    // allowlist is dropped at themeValidator.ts and would fail here. This caught the
    // --sf-status-* tokens (PF-1068 / #9108) being added to ThemeTokens and V1_TOKEN_KEYS
    // but not to COLOR_TOKEN_KEYS, so validateCustomTheme silently stripped them from
    // every custom theme (the #8742 "old validator strips new tokens" class).
    const dark = THEME_DEFINITIONS.dark as Record<string, string>;
    const catalogKeys = Object.keys(dark);
    // Sanity: the walk is non-empty, so a vacuous pass cannot masquerade as coverage.
    expect(catalogKeys.length).toBeGreaterThan(0);

    for (const key of catalogKeys) {
      const result = validateCustomTheme({
        schemaVersion: 1,
        name: 'Drift',
        author: 'test',
        description: '',
        // Built-in pill radii exceed the deliberate custom-theme length cap.
        // This test checks key acceptance, not an exemption from value limits.
        tokens: { [key]: key === '--sf-radius-full' ? '4px' : dark[key] },
      });
      expect(result.ok, `validateCustomTheme rejected catalog token ${key}`).toBe(true);
      if (result.ok) {
        expect(
          Object.keys(result.theme.tokens),
          `Token ${key} was silently dropped by validateCustomTheme — add it to COLOR_TOKEN_KEYS/LENGTH_TOKEN_KEYS/FONT_TOKEN_KEYS/DURATION_TOKEN_KEYS in themeValidator.ts`,
        ).toContain(key);
      }
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
