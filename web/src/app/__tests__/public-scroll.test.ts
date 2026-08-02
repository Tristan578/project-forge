/**
 * Regression guards for PF-1017 — public pages were viewport-clipped.
 *
 * Two independent defects each removed scrolling from every logged-out page,
 * and both failed silently (`window.scrollTo()` still worked, so nothing threw
 * and no automated check noticed):
 *
 *  1. `body { overflow: hidden }` in globals.css. With `html` at `overflow:
 *     visible`, the body's overflow propagates to the VIEWPORT instead of
 *     clipping the body box, so the scrollbar and wheel/trackpad input died
 *     document-wide.
 *  2. `app/(marketing)/page.tsx` and `app/page.tsx` both resolved to `/`. The
 *     build emitted both; `/page` won, so the route-group layout — which held
 *     the only scroll wrapper — never wrapped anything.
 *
 * These assertions are structural because the failure mode is structural: the
 * rendered markup looks correct in jsdom, which has no viewport to clip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const APP_DIR = resolve(__dirname, '..');

/** Body of the first top-level `selector { ... }` block, or null. */
function topLevelRule(css: string, selector: string): string | null {
  const match = new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return match ? match[1] : null;
}

describe('PF-1017: public pages must be able to scroll', () => {
  const css = readFileSync(join(APP_DIR, 'globals.css'), 'utf-8');

  // `overflow: hidden | clip` on html/body propagates to the viewport. `auto`
  // and `scroll` are harmless — this guards the values that kill scrolling.
  for (const selector of ['html', 'body']) {
    it(`does not clip the viewport via a global \`${selector}\` rule`, () => {
      const rule = topLevelRule(css, selector);
      expect(rule, `expected a top-level \`${selector} { ... }\` rule`).not.toBeNull();
      expect(rule).not.toMatch(/overflow(-y)?\s*:\s*(hidden|clip)/);
    });
  }

  it('routes exactly one file to `/`', () => {
    const roots = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\(.+\)$/.test(e.name)) // route groups
      .map((e) => join(APP_DIR, e.name))
      .concat(APP_DIR)
      .filter((dir) =>
        ['page.tsx', 'page.ts', 'page.jsx'].some((f) => existsSync(join(dir, f)))
      );

    // A route group at the app root resolves to `/` exactly like app/page.tsx.
    // Next.js compiles both and silently picks one, dropping the other's layout.
    expect(roots).toEqual([APP_DIR]);
  });
});

describe('PF-1017: the editor keeps its full-viewport scroll lock', () => {
  // Both segments render <EditorLayout>, which fills the viewport and scrolls
  // internally. Dropping the lock here would give the editor a document
  // scrollbar; moving it back to `body` would re-break every public page.
  for (const segment of ['editor', 'dev']) {
    it(`/${segment} applies ViewportLock in its route layout`, () => {
      const layout = join(APP_DIR, segment, 'layout.tsx');
      expect(existsSync(layout), `${segment}/layout.tsx is missing`).toBe(true);
      expect(readFileSync(layout, 'utf-8')).toMatch(/<ViewportLock>/);
    });
  }

  it('ViewportLock is a fixed-height clipping box, not a fixed-position one', () => {
    const lock = readFileSync(
      resolve(__dirname, '../../components/layout/ViewportLock.tsx'),
      'utf-8'
    );
    expect(lock).toMatch(/h-screen/);
    expect(lock).toMatch(/overflow-hidden/);
    // `position: fixed` would establish a stacking context and re-scope every
    // z-index inside the editor relative to body-level portals.
    expect(lock).not.toMatch(/className="[^"]*\bfixed\b/);
  });
});
