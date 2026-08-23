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

  // `--sf-bg-elevated` is a REAL text background, not only a hover state: the
  // OrchestratorPanel's idle/cancelled StatusBadge, its whole TokenCostBar, and
  // the scene/asset/summary tiles inside its approval gate all paint it opaque
  // and put copy on it. It was absent from this list for that reason, and the
  // absence is what let `--sf-text-secondary` ship on it at 4.07:1 (rust) and
  // 4.04:1 (ice) -- both under AA.
  //
  // Only `--sf-text` is pinned on it at the 4.5 text floor. Pairing
  // `--sf-text-secondary` with `--sf-bg-elevated` at 4.5 would FAIL rust and
  // ice today, so the panel no longer uses that combination for text; it
  // appears below at the 3:1 non-text floor instead, which is the only claim
  // this palette can honestly support.
  const TEXT_BG_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string]> = [
    ['--sf-text', '--sf-bg-app', 'primary text on app background'],
    ['--sf-text', '--sf-bg-surface', 'primary text on surface'],
    ['--sf-text', '--sf-bg-elevated', 'primary text on elevated surface'],
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

  // WCAG 1.4.11 Non-text Contrast — a graphic that carries meaning needs
  // >= 3:1 against whatever is painted behind it. `--sf-bg-surface` and
  // `--sf-bg-app` are the primary containers for interactive elements;
  // `--sf-bg-elevated` hosts them too (see TEXT_BG_PAIRS above), so the icon
  // pairs below grade it as well.
  //
  // `--sf-text-secondary` appears here AND in TEXT_BG_PAIRS because the
  // OrchestratorPanel gives it two different jobs: small copy (4.5 floor,
  // pinned above) and the foreground of `StepStatusIcon`'s pending/skipped
  // glyphs plus the empty-state `Sparkles` (3:1 floor, pinned here). The two
  // muted tokens those icons used to carry were pinned at NEITHER floor and
  // clear neither: `--sf-text-disabled` on `--sf-bg-surface` runs 1.48 (light)
  // to 2.89 (leaf), failing all seven themes, and `--sf-text-muted` is 2.56 in
  // light with three more themes under 3.2. Nothing caught it, because nothing
  // graded an icon foreground at all.
  const NONTEXT_PAIRS: Array<[keyof ThemeTokens, keyof ThemeTokens, string, number]> = [
    ['--sf-border-strong', '--sf-bg-surface', 'interactive border on surface', 3.0],
    ['--sf-border-strong', '--sf-bg-app', 'interactive border on app background', 3.0],
    ['--sf-accent', '--sf-bg-surface', 'accent on surface', 3.0],
    ['--sf-accent', '--sf-bg-app', 'accent on app background', 3.0],
    ['--sf-destructive', '--sf-bg-surface', 'destructive indicator on surface', 3.0],
    ['--sf-success', '--sf-bg-surface', 'success indicator on surface', 3.0],
    ['--sf-warning', '--sf-bg-surface', 'warning indicator on surface', 3.0],
    ['--sf-text-secondary', '--sf-bg-surface', 'status icon glyph on surface', 3.0],
    ['--sf-text-secondary', '--sf-bg-elevated', 'status icon glyph on elevated surface', 3.0],
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
  // Regression for PF-1229. `web/src/components/editor/OrchestratorPanel.tsx`
  // holds no hardcoded colour: every semantic surface in it is a 10%-alpha
  // tint of a semantic token carrying `text-[var(--sf-text)]`, and the four
  // tokens below are the complete set it uses that way. Grep the component
  // for `]/10` to re-derive this list.
  //
  // This matrix grades exactly ONE foreground (`--sf-text`) over exactly ONE
  // base (a tint composited on `--sf-bg-surface`). An earlier revision of this
  // comment claimed every semantic surface in the panel carried
  // `text-[var(--sf-text)]`, and that was false: the approval gate's
  // description and both of its `<h5>` headings sat on the warning tint in
  // `--sf-text-secondary`, which measures 4.47:1 in `mech`. A matrix over one
  // foreground can never see that. The panel was moved onto `--sf-text` at
  // those sites rather than the comment being reworded, so the claim is now
  // true by construction -- and the pins that make it ENFORCEABLE rather than
  // merely asserted are the `--sf-bg-elevated` text pair and the icon
  // foreground added above, plus TINT_OVER_ELEVATED_CASES below.
  //
  // Why the pin is needed at all: each of these tokens is pinned only at the
  // WCAG 1.4.11 non-text floor (3:1, see NONTEXT_PAIRS above), and there is
  // no `--sf-destructive-foreground` / `--sf-warning-foreground` token to
  // pair them with. Using the token itself as TEXT against its own tint fails
  // AA 4.5:1 in several themes (as low as ~2.9:1 for destructive in `rust`),
  // so the component pairs each tint with `--sf-text` instead — already
  // proven >= 4.5:1 against solid `--sf-bg-surface` by TEXT_BG_PAIRS above,
  // and proven here against the tint that is actually painted.
  //
  // The blend base is `--sf-bg-surface` because that is the background the
  // component really paints: BOTH of its return branches carry an opaque
  // `bg-[var(--sf-bg-surface)]`. That was added in the same change as this
  // pin and is load-bearing for it. The panel is mounted by
  // `WorkspaceProvider`'s `withSuspense` wrapper inside a hardcoded
  // `bg-zinc-900` host (shared with dark-only sibling panels, so it was not
  // retokenised); without the panel painting its own surface, a `/10` tint
  // would composite over #18181b in all seven themes while this test graded
  // it against `--sf-bg-surface` — and in `light`, `--sf-text` IS #18181b,
  // i.e. ~1.06:1. The pin would then have passed on unreadable output.
  // The insufficient-balance and token-warning rows are deliberately NOT named
  // here: they are children of TokenCostBar's opaque
  // `bg-[var(--sf-bg-elevated)]` container, so their tint composites over
  // `--sf-bg-elevated`, not `--sf-bg-surface`. TINT_OVER_ELEVATED_CASES below
  // grades them. Listing them here was a mis-attribution -- the ratio it
  // reported was for a base those rows have never painted.
  const SEMANTIC_TINT_TOKENS = [
    ['--sf-destructive', 'ERROR_SURFACE_CLASSES, the `failed` badge'],
    ['--sf-warning', 'WARNING_SURFACE_CLASSES, the `awaiting_approval` badge'],
    ['--sf-accent', 'the `decomposing` / `planning` / `executing` badges'],
    ['--sf-success', 'the `completed` badge'],
  ] as const;

  const TINT_CASES = THEMES.flatMap((theme) =>
    SEMANTIC_TINT_TOKENS.map(([tokenKey, usedBy]) => [theme, tokenKey, usedBy] as const)
  );

  it.each(TINT_CASES)(
    '%s theme: %s/10 tint keeps OrchestratorPanel body text at WCAG AA',
    (theme, tokenKey, usedBy) => {
      const tokens = THEME_DEFINITIONS[theme];
      const tintHex = tokens[tokenKey] as string;
      const surfaceHex = tokens['--sf-bg-surface'] as string;
      const textHex = tokens['--sf-text'] as string;
      const blendedBg = blendHex(tintHex, surfaceHex, 0.1);
      const ratio = contrastRatio(textHex, blendedBg);
      expect(
        ratio,
        `${theme}: --sf-text ${textHex} on blended ${tokenKey}/10 ${blendedBg} (over --sf-bg-surface ${surfaceHex}, used by ${usedBy}) = ${ratio.toFixed(2)}:1, need >= 4.5:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  );

  // The second base the panel really paints a tint over. TokenCostBar's
  // container is an opaque `bg-[var(--sf-bg-elevated)]`, and its two alert rows
  // paint `bg-[var(--sf-destructive)]/10` and `bg-[var(--sf-warning)]/10`
  // INSIDE it, so the composite is tint-over-elevated -- a different colour
  // from the tint-over-surface graded above.
  const TINT_OVER_ELEVATED_TOKENS = [
    ['--sf-destructive', 'TokenCostBar insufficient-balance row'],
    ['--sf-warning', 'TokenCostBar token-warning row'],
  ] as const;

  const TINT_OVER_ELEVATED_CASES = THEMES.flatMap((theme) =>
    TINT_OVER_ELEVATED_TOKENS.map(([tokenKey, usedBy]) => [theme, tokenKey, usedBy] as const)
  );

  it.each(TINT_OVER_ELEVATED_CASES)(
    '%s theme: %s/10 tint over --sf-bg-elevated keeps OrchestratorPanel alert rows at WCAG AA',
    (theme, tokenKey, usedBy) => {
      const tokens = THEME_DEFINITIONS[theme];
      const tintHex = tokens[tokenKey] as string;
      const elevatedHex = tokens['--sf-bg-elevated'] as string;
      const textHex = tokens['--sf-text'] as string;
      const blendedBg = blendHex(tintHex, elevatedHex, 0.1);
      const ratio = contrastRatio(textHex, blendedBg);
      expect(
        ratio,
        `${theme}: --sf-text ${textHex} on blended ${tokenKey}/10 ${blendedBg} (over --sf-bg-elevated ${elevatedHex}, used by ${usedBy}) = ${ratio.toFixed(2)}:1, need >= 4.5:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  );

  // The callout BORDER, graded as painted rather than as a raw token.
  //
  // NONTEXT_PAIRS above grades `--sf-destructive` / `--sf-warning` at full
  // strength, which was not what `ERROR_SURFACE_CLASSES` and
  // `WARNING_SURFACE_CLASSES` rendered -- they carried a `/40` modifier, and a
  // Tailwind `/N` composites. The pinned ratio was therefore for a colour the
  // component never drew: destructive/40 on `--sf-bg-surface` measures 1.44
  // (rust) to 1.94 (ice), against the 3.14-to-5.44 the raw token was scoring.
  //
  // The component now paints these borders at full opacity, which is the only
  // setting that satisfies 1.4.11 anywhere in this palette: no alpha from 0.4
  // to 1.0 clears 3:1 against the tint INTERIOR (rust destructive peaks at 2.95
  // at alpha 1.0; light warning at 3.26), so the graded adjacency is the OUTER
  // edge against `--sf-bg-surface`. That is legitimate because the border is
  // not the sole state indicator -- each callout also carries an
  // `AlertTriangle` glyph and `--sf-text` copy -- so 1.4.11 does not hang on
  // the interior edge.
  //
  // `CALLOUT_BORDER_ALPHA` must stay in lockstep with the component. The
  // component-side half of that pin (that neither surface class carries a `/N`
  // modifier on its border) lives in
  // `web/src/components/editor/__tests__/OrchestratorPanel.test.tsx`, because
  // this package cannot read across the workspace boundary.
  const CALLOUT_BORDER_ALPHA = 1.0;

  const CALLOUT_BORDER_TOKENS = [
    ['--sf-destructive', 'ERROR_SURFACE_CLASSES border'],
    ['--sf-warning', 'WARNING_SURFACE_CLASSES border'],
  ] as const;

  const CALLOUT_BORDER_CASES = THEMES.flatMap((theme) =>
    CALLOUT_BORDER_TOKENS.map(([tokenKey, usedBy]) => [theme, tokenKey, usedBy] as const)
  );

  it.each(CALLOUT_BORDER_CASES)(
    '%s theme: %s callout border meets WCAG 1.4.11 as composited',
    (theme, tokenKey, usedBy) => {
      const tokens = THEME_DEFINITIONS[theme];
      const borderHex = tokens[tokenKey] as string;
      const surfaceHex = tokens['--sf-bg-surface'] as string;
      const paintedHex = blendHex(borderHex, surfaceHex, CALLOUT_BORDER_ALPHA);
      const ratio = contrastRatio(paintedHex, surfaceHex);
      expect(
        ratio,
        `${theme}: ${usedBy} -- ${tokenKey} ${borderHex} at alpha ${CALLOUT_BORDER_ALPHA} paints ${paintedHex} on --sf-bg-surface ${surfaceHex} = ${ratio.toFixed(2)}:1, need >= 3:1`
      ).toBeGreaterThanOrEqual(3.0);
    }
  );
});
