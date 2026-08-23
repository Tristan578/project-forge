import { describe, it, expect } from 'vitest';
import { THEME_DEFINITIONS, generateThemeCSS } from '../themes';
import { THEME_NAMES, type ThemeName, type ThemeTokens } from '../colors';

const THEMES: ThemeName[] = [...THEME_NAMES];

describe('Theme Definitions', () => {
  const ALL_TOKEN_KEYS: (keyof ThemeTokens)[] = [
    '--sf-bg-app', '--sf-bg-surface', '--sf-bg-elevated', '--sf-bg-overlay',
    '--sf-text', '--sf-text-secondary', '--sf-text-muted', '--sf-text-disabled',
    '--sf-border', '--sf-border-strong',
    '--sf-accent', '--sf-accent-hover', '--sf-accent-active', '--sf-destructive', '--sf-success', '--sf-warning',
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
      '--sf-accent', '--sf-accent-hover', '--sf-accent-active', '--sf-destructive', '--sf-success', '--sf-warning',
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

  // Alpha-composites `fgHex` over `bgHex` at `alpha` (0-1), per-channel linear
  // blend in sRGB space — this is what a Tailwind `bg-[var(--x)]/N` opacity
  // modifier actually paints, not the raw foreground color. A contrast check
  // against the unblended hex would grade a color nobody sees.
  function blendHex(fgHex: string, bgHex: string, alpha: number): string {
    const fr = parseInt(fgHex.slice(1, 3), 16);
    const fg = parseInt(fgHex.slice(3, 5), 16);
    const fb = parseInt(fgHex.slice(5, 7), 16);
    const br = parseInt(bgHex.slice(1, 3), 16);
    const bg = parseInt(bgHex.slice(3, 5), 16);
    const bb = parseInt(bgHex.slice(5, 7), 16);
    const r = Math.round(alpha * fr + (1 - alpha) * br);
    const g = Math.round(alpha * fg + (1 - alpha) * bg);
    const b = Math.round(alpha * fb + (1 - alpha) * bb);
    const toHex = (c: number) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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

  // Regression for #8742: the primary <Button variant="default"> CTA renders
  // --sf-on-accent text on --sf-accent-hover at REST and --sf-accent-active on
  // HOVER (see packages/ui/src/primitives/Button.tsx). The 16px/500 label is
  // normal text, so BOTH states must clear the AA 4.5:1 floor — previously the
  // resting --sf-accent failed in dark/rust and leaf failed at rest AND hover.
  // Keep this in lockstep with Button.tsx: if the variant's bg tokens change,
  // update the keys here.
  const BUTTON_DEFAULT_BACKGROUNDS: Array<[keyof ThemeTokens, string]> = [
    ['--sf-accent-hover', 'default Button resting CTA'],
    ['--sf-accent-active', 'default Button hover CTA'],
  ];

  it.each(THEMES)('%s theme: default Button label meets WCAG AA at rest and hover', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const onAccent = tokens['--sf-on-accent'] as string;
    for (const [bgKey, description] of BUTTON_DEFAULT_BACKGROUNDS) {
      const bgHex = tokens[bgKey] as string;
      const ratio = contrastRatio(onAccent, bgHex);
      expect(
        ratio,
        `${theme}: ${description} — --sf-on-accent ${onAccent} on ${bgKey} ${bgHex} = ${ratio.toFixed(2)}:1, need >= 4.5:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  // Regression for PF-1229 finding #1: OrchestratorPanel's ERROR_SURFACE_CLASSES
  // paints `text-[var(--sf-destructive)]` over `bg-[var(--sf-destructive)]/10`
  // (see web/src/components/editor/OrchestratorPanel.tsx). --sf-destructive is
  // only pinned at the WCAG 1.4.11 non-text floor (3:1, see NONTEXT_PAIRS
  // above) — using it as TEXT against its own 10%-alpha tint failed AA 4.5:1
  // in several themes. There is no --sf-destructive-foreground token, so the
  // fix pairs the surface with --sf-text (already proven >= 4.5:1 against
  // solid --sf-bg-surface via TEXT_BG_PAIRS above) and this test proves that
  // holds against the actual blended background a viewer sees.
  it.each(THEMES)('%s theme: error surface text clears WCAG AA against the blended destructive tint', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const destructiveHex = tokens['--sf-destructive'] as string;
    const surfaceHex = tokens['--sf-bg-surface'] as string;
    const textHex = tokens['--sf-text'] as string;
    const blendedBg = blendHex(destructiveHex, surfaceHex, 0.1);
    const ratio = contrastRatio(textHex, blendedBg);
    expect(
      ratio,
      `${theme}: --sf-text ${textHex} on blended destructive/10 ${blendedBg} (over ${surfaceHex}) = ${ratio.toFixed(2)}:1, need >= 4.5:1`
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Regression for PF-1229 finding #9: OrchestratorPanel's warnings-list
  // container (see web/src/components/editor/OrchestratorPanel.tsx) was
  // migrated off hardcoded `border-amber-800 bg-amber-950/40 text-amber-200`
  // onto `border-[var(--sf-warning)]/40 bg-[var(--sf-warning)]/10
  // text-[var(--sf-text)]` — the same border/bg proportions as
  // ERROR_SURFACE_CLASSES above, with --sf-warning substituted for
  // --sf-destructive. --sf-warning is only pinned at the WCAG 1.4.11
  // non-text floor (3:1, see NONTEXT_PAIRS above); there is no
  // --sf-warning-foreground token and no existing pin proves --sf-text
  // clears AA against a --sf-warning tint specifically (only against the
  // solid --sf-destructive tint above), so this test proves that holds
  // against the actual blended background a viewer sees before the
  // component relies on it.
  it.each(THEMES)('%s theme: warning surface text clears WCAG AA against the blended warning tint', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const warningHex = tokens['--sf-warning'] as string;
    const surfaceHex = tokens['--sf-bg-surface'] as string;
    const textHex = tokens['--sf-text'] as string;
    const blendedBg = blendHex(warningHex, surfaceHex, 0.1);
    const ratio = contrastRatio(textHex, blendedBg);
    expect(
      ratio,
      `${theme}: --sf-text ${textHex} on blended warning/10 ${blendedBg} (over ${surfaceHex}) = ${ratio.toFixed(2)}:1, need >= 4.5:1`
    ).toBeGreaterThanOrEqual(4.5);
  });
});
