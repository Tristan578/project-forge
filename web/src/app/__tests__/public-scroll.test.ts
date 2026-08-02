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
import { resolve, join, relative } from 'path';

const APP_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(APP_DIR, '../../..');

/**
 * Bodies of EVERY top-level `selector { ... }` block — not just the first.
 * Appending a second `body { ... }` at the end of the sheet is the likeliest
 * way this regression comes back, and the CSS cascade means that later block
 * is the one that wins.
 */
function topLevelRules(css: string, selector: string): string[] {
  return [...css.matchAll(new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
}

/** Stylesheets that can style `html`/`body` on every page. */
const GLOBAL_STYLESHEETS = [
  join(APP_DIR, 'globals.css'),
  // @import'ed by globals.css:2 — applies identically, so it needs the same guard.
  join(REPO_ROOT, 'packages/ui/src/tokens/theme.css'),
];

describe('PF-1017: public pages must be able to scroll', () => {
  // `overflow: hidden | clip` on html/body propagates to the viewport. `auto`
  // and `scroll` are harmless — this guards the values that kill scrolling.
  const CLIPPING = /overflow(-y)?\s*:\s*(hidden|clip)/;

  for (const sheet of GLOBAL_STYLESHEETS) {
    const label = relative(REPO_ROOT, sheet);

    it(`does not clip the viewport from ${label}`, () => {
      expect(existsSync(sheet), `${label} moved — update GLOBAL_STYLESHEETS`).toBe(true);
      const css = readFileSync(sheet, 'utf-8');
      for (const selector of ['html', 'body']) {
        for (const rule of topLevelRules(css, selector)) {
          expect(rule, `\`${selector} { ... }\` in ${label}`).not.toMatch(CLIPPING);
        }
      }
    });
  }

  it('still finds the html and body rules it is guarding', () => {
    // Fail closed: a regex that silently matches nothing would make every
    // assertion above vacuous.
    const css = readFileSync(join(APP_DIR, 'globals.css'), 'utf-8');
    expect(topLevelRules(css, 'html').length).toBeGreaterThan(0);
    expect(topLevelRules(css, 'body').length).toBeGreaterThan(0);
  });

  it('does not clip the viewport from the <body> className', () => {
    // A Tailwind `overflow-hidden`/`h-screen` on <body> has the same effect as
    // the CSS rule and is the more idiomatic way to reintroduce it here.
    const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf-8');
    const bodyClass = /<body\s[^>]*className=\{?[`'"]([^`'"]*)/.exec(layout);
    expect(bodyClass, 'could not locate the <body> className in layout.tsx').not.toBeNull();
    expect(bodyClass![1]).not.toMatch(/\b(overflow-hidden|overflow-y-hidden|h-screen|h-dvh)\b/);
  });
});

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'page.mdx'];

/** Every `page.*` under `app/`, keyed by the URL path it actually resolves to. */
function collectPageRoutes(dir: string, segments: string[] = []): { url: string; file: string }[] {
  const found: { url: string; file: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Private folders and colocated tests never route.
      if (entry.name.startsWith('_') || entry.name === '__tests__') continue;
      // Parallel-route slots render into a layout slot, not a URL path.
      if (entry.name.startsWith('@')) continue;
      const isRouteGroup = /^\(.+\)$/.test(entry.name);
      found.push(
        ...collectPageRoutes(join(dir, entry.name), isRouteGroup ? segments : [...segments, entry.name])
      );
    } else if (PAGE_FILES.includes(entry.name)) {
      found.push({ url: `/${segments.join('/')}`, file: relative(APP_DIR, join(dir, entry.name)) });
    }
  }
  return found;
}

describe('PF-1017: no two files may claim the same route', () => {
  const byUrl = new Map<string, string[]>();
  for (const { url, file } of collectPageRoutes(APP_DIR)) {
    byUrl.set(url, [...(byUrl.get(url) ?? []), file]);
  }

  it('resolves exactly one page to `/`', () => {
    // Also fails closed: a broken walk that returns nothing would make the
    // collision assertion below vacuous.
    expect(byUrl.get('/'), 'expected exactly one page to resolve to `/`').toHaveLength(1);
  });

  it('never routes two files to the same URL path', () => {
    // Route groups are stripped from the URL, so `app/(marketing)/page.tsx` and
    // `app/page.tsx` both resolve to `/`. Next.js compiles both and silently
    // picks one, dropping the other's layout — which is exactly how the only
    // scroll wrapper on the landing page stopped applying.
    const collisions = [...byUrl.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([url, files]) => `${url} <- ${files.join(', ')}`);
    expect(collisions).toEqual([]);
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

  it('ViewportLock clips the DYNAMIC viewport and is not fixed-position', () => {
    const lock = readFileSync(
      resolve(__dirname, '../../components/layout/ViewportLock.tsx'),
      'utf-8'
    );
    // `h-screen` (100vh) is the LARGE viewport on mobile browsers, so it would
    // overflow the visual viewport and make the whole editor document-scroll.
    expect(lock).toMatch(/className="[^"]*\bh-dvh\b/);
    expect(lock).not.toMatch(/className="[^"]*\bh-screen\b/);
    expect(lock).toMatch(/overflow-hidden/);
    // `position: fixed` would establish a stacking context and re-scope every
    // z-index inside the editor relative to body-level portals.
    expect(lock).not.toMatch(/className="[^"]*\bfixed\b/);
  });

  it('EditorLayout does not overflow the lock with a 100vh root', () => {
    const editor = readFileSync(
      resolve(__dirname, '../../components/editor/EditorLayout.tsx'),
      'utf-8'
    );
    expect(editor).not.toMatch(/className="[^"]*\bh-screen\b/);
  });
});
