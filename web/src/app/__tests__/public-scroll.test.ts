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
 * Split a stylesheet into `{ selector, body }` pairs by walking braces, so rules
 * are found at ANY nesting depth.
 *
 * A line-anchored regex (`/^body\s*\{/m`) is not sufficient: `^` under the `m`
 * flag anchors to start-of-LINE, not start-of-rule, so an indented rule inside
 * `@media (max-width: 640px) { ... }` is invisible to it while the browser still
 * applies it. Media queries gate the cascade; they do not suppress it — so that
 * is a complete reintroduction of PF-1017 on mobile that a top-level-only guard
 * cannot see.
 *
 * Quoted strings are skipped so a brace inside `content: "}"` cannot desync the
 * walk.
 */
function cssRules(css: string): { selector: string; body: string }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; body: string }[] = [];
  const open: { selector: string; bodyStart: number }[] = [];
  let tokenStart = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const close = src.indexOf(ch, i + 1);
      i = close === -1 ? src.length : close;
    } else if (ch === '{') {
      open.push({ selector: src.slice(tokenStart, i).trim(), bodyStart: i + 1 });
      tokenStart = i + 1;
    } else if (ch === '}') {
      const rule = open.pop();
      if (rule) rules.push({ selector: rule.selector, body: src.slice(rule.bodyStart, i) });
      tokenStart = i + 1;
    } else if (ch === ';') {
      tokenStart = i + 1;
    }
  }
  return rules;
}

/**
 * Matches a selector that targets the `html` or `body` ELEMENT — including
 * grouped (`html, body`) and qualified (`body.dark`, `html[data-theme]`) forms,
 * but not lookalike class names such as `.body-text`.
 */
const ROOT_SELECTOR = /(?:^|[\s>+~,(])(?:html|body)(?![\w-])/;

/** Bodies of every rule that styles `html` or `body`, at any nesting depth. */
function rootRuleBodies(css: string): string[] {
  return cssRules(css)
    .filter(({ selector }) => ROOT_SELECTOR.test(`,${selector}`))
    .map(({ body }) => body);
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
      for (const rule of rootRuleBodies(readFileSync(sheet, 'utf-8'))) {
        expect(rule, `an \`html\`/\`body\` rule in ${label}`).not.toMatch(CLIPPING);
      }
    });
  }

  it('finds html/body rules wherever they are nested', () => {
    // Fail closed. The sheets above are guarded only as well as the extractor
    // works, and `theme.css` legitimately has NO html/body rules today — so a
    // "found > 0 in every real file" check is impossible there. Pinning the
    // extractor against a synthetic sheet guards every file instead, including
    // the ones that are currently empty of root rules.
    const found = rootRuleBodies(`
      html { overflow: visible; }
      body { background: red; }
      .body-text { overflow: hidden; }
      @media (max-width: 640px) {
        body { overflow: hidden; }
      }
      @supports (height: 100dvh) {
        @media print {
          html, body { overflow-y: clip; }
        }
      }
      body::after { content: "}"; }
    `);
    // The three clipping rules are the ones that matter: media-nested,
    // doubly-nested + grouped, and none of the lookalike `.body-text`.
    expect(found.filter((b) => CLIPPING.test(b))).toHaveLength(2);
    expect(found.length).toBeGreaterThanOrEqual(4);
    // The `content: "}"` brace must not desync the walk.
    expect(rootRuleBodies('body { overflow: hidden; }').some((b) => CLIPPING.test(b))).toBe(true);
  });

  it('still finds the html and body rules it is guarding', () => {
    // globals.css is the file that actually carries root rules — if the
    // extractor stops matching there, every assertion above goes vacuous.
    expect(rootRuleBodies(readFileSync(join(APP_DIR, 'globals.css'), 'utf-8')).length)
      .toBeGreaterThan(0);
  });

  it('does not clip the viewport from the <body> className', () => {
    // A Tailwind `overflow-hidden`/`h-screen` on <body> has the same effect as
    // the CSS rule and is the more idiomatic way to reintroduce it here.
    const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf-8');
    // `\s` (not `\b`) after the tag name so a prose `<body>` in a comment is
    // not mistaken for the real tag — layout.tsx has one on the Clerk note.
    const openTag = /<body\s[^>]*>/.exec(layout);
    expect(openTag, 'could not locate the <body> tag in layout.tsx').not.toBeNull();
    // Every string literal in the tag, so a `cn(...)`/`clsx(...)` className is
    // read as well as a bare string or template literal.
    const classes = [...openTag![0].matchAll(/[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]).join(' ');
    expect(classes.trim(), 'no class literals found on <body>').not.toBe('');
    expect(classes).not.toMatch(/\b(overflow-hidden|overflow-y-hidden|h-screen|h-dvh)\b/);
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

  /**
   * Every file that renders INSIDE <ViewportLock>. The lock is `h-dvh
   * overflow-hidden`, so a `100vh` box in here is taller than its parent on
   * mobile (`100vh` is the LARGE viewport, `100dvh` the visual one) and the
   * excess is CLIPPED rather than scrolled — a centred spinner or error message
   * drifts below the fold with no way to reach it.
   *
   * `EditorLayout` alone is not enough coverage: the route-level loading and
   * error states are separate files that never mount it, and those are exactly
   * the screens a user sees when something is already going wrong.
   */
  const LOCKED_SUBTREE = [
    'src/app/dev/page.tsx',
    'src/app/editor/loading.tsx',
    'src/app/editor/[id]/page.tsx',
    'src/components/editor/EditorLayout.tsx',
    'src/components/editor/EditorErrorBoundary.tsx',
    'src/components/editor/WasmErrorBoundary.tsx',
  ];

  it.each(LOCKED_SUBTREE)('%s does not overflow the lock with a 100vh box', (rel) => {
    const file = join(REPO_ROOT, 'web', rel);
    expect(existsSync(file), `${rel} moved — update LOCKED_SUBTREE`).toBe(true);
    // `\b` treats `-` as a boundary, so this matches `min-h-screen` too. That is
    // intended: `min-height: 100vh` inside the lock overflows it just as surely
    // as `height: 100vh` does. Use `h-full` — 100% of the h-dvh parent.
    expect(readFileSync(file, 'utf-8')).not.toMatch(/className="[^"]*\bh-screen\b/);
  });
});
