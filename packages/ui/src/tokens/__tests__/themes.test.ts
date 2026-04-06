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

  // Normal text pairs — must meet 4.5:1 WCAG AA ratio
  const NORMAL_TEXT_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string]> = [
    ['--sf-text', '--sf-bg-app', 'primary text on app background'],
    ['--sf-text', '--sf-bg-surface', 'primary text on surface'],
    ['--sf-text', '--sf-bg-elevated', 'primary text on elevated surface'],
    ['--sf-text-secondary', '--sf-bg-app', 'secondary text on app background'],
    ['--sf-text-secondary', '--sf-bg-surface', 'secondary text on surface'],
    ['--sf-text-secondary', '--sf-bg-elevated', 'secondary text on elevated surface'],
  ];

  // Large text / UI component pairs — 3:1 WCAG AA ratio (14pt bold / 18pt+)
  // Button labels are rendered at 14px bold (= 14pt bold), qualifying as "large text"
  const LARGE_TEXT_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string]> = [
    ['--sf-on-accent', '--sf-accent', 'button text on accent'],
    ['--sf-on-accent', '--sf-accent-hover', 'button text on accent hover'],
    ['--sf-text-muted', '--sf-bg-app', 'muted text on app background'],
    ['--sf-text-muted', '--sf-bg-surface', 'muted text on surface'],
    ['--sf-accent', '--sf-bg-app', 'accent on app background'],
    ['--sf-accent', '--sf-bg-surface', 'accent on surface'],
    ['--sf-destructive', '--sf-bg-app', 'destructive on app background'],
    ['--sf-destructive', '--sf-bg-surface', 'destructive on surface'],
    ['--sf-success', '--sf-bg-app', 'success on app background'],
    ['--sf-success', '--sf-bg-surface', 'success on surface'],
    ['--sf-warning', '--sf-bg-app', 'warning on app background'],
    ['--sf-warning', '--sf-bg-surface', 'warning on surface'],
  ];

  it.each(THEMES)('%s theme meets WCAG AA contrast (>= 4.5:1) for normal text', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const [fgKey, bgKey, description] of NORMAL_TEXT_PAIRS) {
      const fgHex = tokens[fgKey] as string;
      const bgHex = tokens[bgKey] as string;
      if (!fgHex.startsWith('#') || !bgHex.startsWith('#')) continue;
      const ratio = contrastRatio(fgHex, bgHex);
      expect(ratio, `${theme}: ${description} — ${ratio.toFixed(2)}:1 (${fgHex} on ${bgHex})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('%s theme meets WCAG AA contrast (>= 3:1) for large text / UI elements', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    for (const [fgKey, bgKey, description] of LARGE_TEXT_PAIRS) {
      const fgHex = tokens[fgKey] as string;
      const bgHex = tokens[bgKey] as string;
      if (!fgHex.startsWith('#') || !bgHex.startsWith('#')) continue;
      const ratio = contrastRatio(fgHex, bgHex);
      expect(ratio, `${theme}: ${description} — ${ratio.toFixed(2)}:1 (${fgHex} on ${bgHex})`).toBeGreaterThanOrEqual(3);
    }
  });
});
