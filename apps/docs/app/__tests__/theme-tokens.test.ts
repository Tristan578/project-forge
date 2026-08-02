/**
 * Guards that the docs site's theme tokens are APPLIED, not merely declared.
 *
 * `globals.css` declared `--background: #09090b` and `--foreground: #fafafa`
 * on `:root` and then nothing consumed them. Tailwind's preflight sets no body
 * background or color, so the site rendered on browser-default white — while
 * `app/mcp/page.tsx` set `color: var(--foreground, #fafafa)` inline. Near-white
 * text on a white page. The docs were being served correctly and were
 * invisible (PF-1019).
 *
 * Nothing caught it because every existing test asserted on DATA (manifest
 * parsing, sitemap entries, filter behaviour) and no test asserted the page was
 * legible. A declared-but-unconsumed custom property is valid CSS, so neither
 * the linter nor the build had anything to complain about.
 *
 * This is a source scan for the same reason `web/src/app/__tests__/
 * public-scroll.test.ts` is: the failure is a missing rule, and you cannot
 * assert on the absence of a rule by rendering a component.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const DOCS_ROOT = resolve(__dirname, '..', '..');
const globalsCss = readFileSync(join(DOCS_ROOT, 'app', 'globals.css'), 'utf-8');

/**
 * Strip comments before scanning. Every rule below is about what the browser
 * receives; a token named in prose must not satisfy a check.
 */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('docs theme tokens', () => {
  it.each(['--background', '--foreground'])('declares %s', (token) => {
    expect(css).toMatch(new RegExp(`${token}\\s*:`));
  });

  /**
   * The actual regression. A `body` rule must consume both tokens — declaring
   * them is what the broken version already did.
   */
  it('applies --background and --foreground to body', () => {
    const bodyRule = css.match(/(^|})\s*body\s*\{([^}]*)\}/);

    expect(
      bodyRule,
      'globals.css has no `body` rule. The theme tokens are declared on :root ' +
        'but nothing consumes them, so the page renders on browser-default ' +
        'white — which is what PF-1019 was.'
    ).not.toBeNull();

    const declarations = bodyRule?.[2] ?? '';

    expect(
      declarations,
      'body sets no background-color from --background — the page will paint white.'
    ).toMatch(/background(-color)?\s*:\s*var\(\s*--background/);

    expect(
      declarations,
      'body sets no color from --foreground — text will not follow the theme.'
    ).toMatch(/(^|[^-])color\s*:\s*var\(\s*--foreground/);
  });

  /**
   * Without `color-scheme: dark` the browser paints white before first paint
   * and renders native widgets (scrollbars, form controls, the default
   * caret) light-on-light against the dark page.
   */
  it('declares color-scheme: dark so native UI matches the palette', () => {
    expect(css).toMatch(/color-scheme\s*:\s*dark/);
  });

  /**
   * The pages that consume these tokens inline. `mcp/page.tsx` is the one that
   * was rendering invisible text, and its fallbacks are the only thing that
   * would have made the bug survivable — so they must stay present and stay
   * consistent with the token values.
   */
  it('keeps inline var() fallbacks on the page that surfaced the bug', () => {
    const mcpPage = readFileSync(
      join(DOCS_ROOT, 'app', 'mcp', 'page.tsx'),
      'utf-8'
    );

    const usesForeground = /var\(\s*--foreground\s*,\s*#fafafa\s*\)/.test(mcpPage);

    expect(
      usesForeground,
      'mcp/page.tsx no longer pairs --foreground with its #fafafa fallback. ' +
        'If the token stops resolving, this page goes invisible again.'
    ).toBe(true);
  });
});
