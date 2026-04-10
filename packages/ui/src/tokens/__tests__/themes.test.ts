import { describe, it, expect } from 'vitest';
import { THEME_DEFINITIONS, generateThemeCSS } from '../themes';
import { THEME_NAMES, type ThemeName, type ThemeTokens } from '../colors';

const THEMES: ThemeName[] = [...THEME_NAMES];

describe('Theme Definitions', () => {
  const ALL_TOKEN_KEYS: (keyof ThemeTokens)[] = [
    '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
    '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
    '--sf-border', '--sf-border-strong',
    '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
    '--sf-radius-sm', '--sf-radius-md', '--sf-radius-lg', '--sf-radius-xl', '--sf-radius-full',
    '--sf-border-width', '--sf-font-ui', '--sf-font-mono', '--sf-transition',
  ];

  it('defines exactly 7 themes', () => {
    expect(THEME_NAMES).toHaveLength(7);
    expect(THEME_NAMES).toEqual(['dark', 'light', 'ember', 'rust', 'ice', 'leaf', 'mech']);
  });

  it.each(THEMES)('%s theme has all required tokens', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const key of ALL_TOKEN_KEYS) {
      expect(tokens[key], `${theme} missing ${key}`).toBeDefined();
      expect(typeof tokens[key]).toBe('string');
      expect(tokens[key].length).toBeGreaterThan(0);
    }
  });

  it.each(THEMES)('%s color tokens are valid hex', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const COLOR_TOKEN_NAMES: (keyof ThemeTokens)[] = [
      '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
      '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
      '--sf-border', '--sf-border-strong',
      '--sf-accent', '--sf-accent-hover', '--sf-destructive', '--sf-success', '--sf-warning',
    ];
    const colorKeys = COLOR_TOKEN_NAMES;
    for (const key of colorKeys) {
      expect(tokens[key], `${theme}.${key} = ${tokens[key]}`).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
    }
  });

  it('generateThemeCSS produces valid CSS', () => {
    const css = generateThemeCSS('dark');
    expect(css).toContain('--sf-bg-app: #09090b');
    expect(css).toContain('--sf-accent: #3b82f6');
  });

  it('each theme has distinct accent color', () => {
    const accents = THEME_NAMES.map(t => THEME_DEFINITIONS[t]['--sf-accent']);
    const unique = new Set(accents);
    expect(unique.size).toBe(7);
  });

  // WCAG AA contrast ratio verification
  function linearizeChannel(c8bit: number): number {
    const s = c8bit / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
  }

  function contrastRatio(hex1: string, hex2: string): number {
    const L1 = relativeLuminance(hex1);
    const L2 = relativeLuminance(hex2);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const TEXT_BG_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string]> = [
    ['--sf-text', '--sf-bg-app', 'primary text on app background'],
    ['--sf-text', '--sf-bg-surface', 'primary text on surface'],
    ['--sf-text-secondary', '--sf-bg-app', 'secondary text on app background'],
    ['--sf-text-secondary', '--sf-bg-surface', 'secondary text on surface'],
  ];

  it.each(THEMES)('%s theme meets WCAG AA contrast ratio (>= 4.5:1) for text pairs', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const [textKey, bgKey, description] of TEXT_BG_PAIRS) {
      const textHex = tokens[textKey] as string;
      const bgHex = tokens[bgKey] as string;
      if (!textHex.startsWith('#') || !bgHex.startsWith('#')) continue;
      const ratio = contrastRatio(textHex, bgHex);
      expect(ratio, `${theme}: ${description} — contrast ${ratio.toFixed(2)}:1 (${textHex} on ${bgHex})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // WCAG 1.4.11 Non-text Contrast — interactive elements need >= 3:1 against their container background.
  // --sf-bg-surface and --sf-bg-app are the primary containers for interactive elements.
  // --sf-bg-elevated is for hover states / card interiors, not interactive element containers.
  const NONTEXT_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string, number]> = [
    ['--sf-border-strong', '--sf-bg-surface', 'interactive border on surface', 3.0],
    ['--sf-border-strong', '--sf-bg-app', 'interactive border on app background', 3.0],
    ['--sf-accent', '--sf-bg-surface', 'accent on surface', 3.0],
    ['--sf-accent', '--sf-bg-app', 'accent on app background', 3.0],
    ['--sf-destructive', '--sf-bg-surface', 'destructive indicator on surface', 3.0],
    ['--sf-success', '--sf-bg-surface', 'success indicator on surface', 3.0],
    ['--sf-warning', '--sf-bg-surface', 'warning indicator on surface', 3.0],
  ];

  it.each(THEMES)('%s theme meets WCAG 1.4.11 non-text contrast for interactive elements', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const [fgKey, bgKey, description, minRatio] of NONTEXT_PAIRS) {
      const fgHex = tokens[fgKey] as string;
      const bgHex = tokens[bgKey] as string;
      if (!fgHex.startsWith('#') || !bgHex.startsWith('#')) continue;
      const ratio = contrastRatio(fgHex, bgHex);
      expect(
        ratio,
        `${theme}: ${description} — contrast ${ratio.toFixed(2)}:1 (${fgHex} on ${bgHex}), need >= ${minRatio}:1`
      ).toBeGreaterThanOrEqual(minRatio);
    }
  });
});
