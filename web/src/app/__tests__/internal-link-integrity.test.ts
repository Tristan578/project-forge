/**
 * CI gate for #9046: every internal link in `web/src` must point at a route
 * that exists.
 *
 * Deliberately a vitest suite rather than a new CI job — it rides the existing
 * web test run with no workflow wiring, and `.github/workflows/ci.yml` is owned
 * by a concurrent PR.
 *
 * The scope of what this can and cannot prove is documented at the top of
 * `helpers/linkIntegrity.ts`. The short version: it resolves statically
 * determinable link targets against the App Router files on disk. It does not
 * know about auth-gating, rewrites, or query-param validity.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkLinks,
  collectLinks,
  collectRoutes,
  extractLinksFromSource,
  formatDeadLinks,
  matchesRoute,
  readStringLiteral,
  toProbeSegments,
} from './helpers/linkIntegrity';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '..', '..'); // web/src
const APP_DIR = path.resolve(SRC_DIR, 'app'); // web/src/app

describe('internal link integrity (web)', () => {
  const routes = collectRoutes(APP_DIR);
  const links = collectLinks(SRC_DIR);
  const report = checkLinks(links, routes);

  // ---------------------------------------------------------------------
  // Fail closed. A walk that silently finds nothing is a broken checker, not
  // a clean bill of health — that is exactly how a link checker rots into a
  // test that can never fail.
  // ---------------------------------------------------------------------
  it('finds the App Router route table', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('finds internal links to check', () => {
    expect(links.length).toBeGreaterThan(20);
  });

  it('actually resolves links rather than skipping them all', () => {
    expect(report.resolved.length).toBeGreaterThan(15);
  });

  // The repointed links now live in a constants module, so if the checker did
  // not anchor on the DECLARATION it would be blind to exactly the four links
  // this ticket exists to fix — a gate that passes over its own subject matter.
  // Asserting they are SEEN is separate from asserting they are alive: a
  // resolution failure would show up in `dead` above.
  it('sees the hoisted settings route constants', () => {
    const seen = links.filter((l) => l.file === 'lib/navigation/settingsRoutes.ts');
    expect(seen.map((l) => l.raw).sort()).toEqual([
      '/settings?tab=billing',
      '/settings?tab=keys',
    ]);
  });

  it('has no internal link pointing at a route that does not exist', () => {
    expect(
      report.dead,
      `Dead internal links found:\n${formatDeadLinks(report.dead)}\n\n` +
        'Either create the route or repoint the link at one that exists.',
    ).toEqual([]);
  });

  // The three #9046 regressions that lived in web/src, pinned by name so a
  // revert is unambiguous rather than an anonymous count change above. The
  // fourth, the docs `/api` link, belongs to the apps/docs suite.
  it.each([
    ['/settings/billing'],
    ['/settings/api-keys'],
    ['/editor?project='],
  ])('no source still links to the removed path %s', (deadPath) => {
    expect(links.filter((l) => l.raw.startsWith(deadPath))).toEqual([]);
  });
});

/**
 * Self-tests for the checker. Without these, "no dead links" is unfalsifiable:
 * a checker that resolves everything to true also reports a clean tree.
 * These plant dead links against a synthetic route table and assert they are
 * caught — the same proof as editing a real file, but without leaving a broken
 * link in the tree for someone to trip over.
 */
describe('link checker self-test', () => {
  const routes = [
    [], // "/"
    ['settings'],
    ['pricing'],
    ['editor', '[id]'],
    ['play', '[userId]', '[slug]'],
    ['sign-in', '[[...sign-in]]'],
    ['docs', '[...slug]'],
  ];

  const at = (raw: string) => checkLinks([{ raw, file: 'planted.tsx', line: 1 }], routes);

  it('flags a planted dead link', () => {
    const { dead } = at('/settings/billing');
    expect(dead).toHaveLength(1);
    expect(dead[0].path).toBe('/settings/billing');
  });

  it('flags a planted dead link that carries a query string', () => {
    expect(at('/editor?project=abc').dead).toHaveLength(1);
  });

  it('flags a planted dead link in a dynamic-looking position', () => {
    // `/mcp/${category}` with no `/mcp/[category]` route — the docs bug shape.
    expect(at('/nope/${category}').dead).toHaveLength(1);
  });

  it.each([
    ['/', 'root'],
    ['/settings', 'static route'],
    ['/settings?tab=keys', 'query string stripped before resolution'],
    ['/settings?tab=billing', 'query string stripped before resolution'],
    ['/pricing#plans', 'hash stripped before resolution'],
    ['/editor/${id}', 'whole-segment interpolation vs [id]'],
    ['/play/${userId}/${slug}', 'two whole-segment interpolations'],
    ['/sign-in', 'optional catch-all matches zero segments'],
    ['/sign-in/factor-one', 'optional catch-all matches one segment'],
    ['/docs/a/b', 'required catch-all matches many segments'],
  ])('resolves %s (%s)', (raw) => {
    const { dead, skipped } = at(raw);
    expect({ raw, dead, skipped }).toEqual({ raw, dead: [], skipped: [] });
  });

  it('skips, rather than fails, an interpolation glued inside a segment', () => {
    // `router.replace(`/settings${qs ? `?${qs}` : ''}`)` — SettingsPage does
    // exactly this. The interpolation may expand to a query string, so the
    // resolved path is genuinely unknown.
    const { dead, skipped } = at("/settings${qs ? `?${qs}` : ''}");
    expect(dead).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it('skips an interpolation that could span several segments', () => {
    // `/play/${both}` against `/play/[userId]/[slug]`: the interpolation could
    // expand to `alice/my-game`, so it must not be called dead.
    const { dead, skipped } = at('/play/${both}');
    expect(dead).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it('ignores external, protocol-relative, anchor and scheme links', () => {
    const source = [
      '<a href="https://example.com/settings/billing">x</a>',
      '<a href="//cdn.example.com/settings/billing">x</a>',
      '<a href="#section">x</a>',
      '<a href="mailto:a@b.co">x</a>',
      '<a href="tel:+1">x</a>',
    ].join('\n');
    expect(extractLinksFromSource(source, 'f.tsx')).toEqual([]);
  });
});

describe('link checker primitives', () => {
  it('reads a template literal past a nested template literal', () => {
    const source = 'router.push(`/settings${qs ? `?${qs}` : ""}`);';
    const open = source.indexOf('`');
    const literal = readStringLiteral(source, open);
    expect(literal?.text).toBe('/settings${qs ? `?${qs}` : ""}');
  });

  it('reads a plain string containing an escaped quote', () => {
    const source = "href='/a\\'b'";
    const literal = readStringLiteral(source, source.indexOf("'"));
    expect(literal?.text).toBe("/a\\'b");
  });

  it('returns null for an unterminated plain string', () => {
    expect(readStringLiteral("href='/oops\nnext", 5)).toBeNull();
  });

  it('reports the line number of each link', () => {
    const source = 'const a = 1;\n<a href="/pricing" />\n<a href="/about" />';
    expect(extractLinksFromSource(source, 'f.tsx')).toEqual([
      { raw: '/pricing', file: 'f.tsx', line: 2 },
      { raw: '/about', file: 'f.tsx', line: 3 },
    ]);
  });

  it.each([
    ['href={"/a"}', '/a'],
    ["href={'/a'}", '/a'],
    ['href: "/a"', '/a'],
    ["router.push('/a')", '/a'],
    ["router.replace('/a')", '/a'],
    ["redirect('/a')", '/a'],
    ["permanentRedirect('/a')", '/a'],
    ["window.location.href = '/a'", '/a'],
    ["location.assign('/a')", '/a'],
    ["export const SETTINGS_BILLING_HREF = '/a';", '/a'],
    ["export const FOO_ROUTE: string = '/a';", '/a'],
  ])('recognises %s', (source, expected) => {
    expect(extractLinksFromSource(source, 'f.tsx').map((l) => l.raw)).toEqual([expected]);
  });

  it('strips the query and hash from the probe path', () => {
    expect(toProbeSegments('/settings?tab=keys#top')).toEqual(['settings']);
  });

  it('tolerates a trailing slash', () => {
    expect(toProbeSegments('/settings/')).toEqual(['settings']);
  });

  it('does not let a static segment match a different static segment', () => {
    expect(matchesRoute(['settings'], ['setting'])).toBe(false);
  });

  it('does not let a shorter link match a longer route', () => {
    expect(matchesRoute(['editor'], ['editor', '[id]'])).toBe(false);
  });

  it('does not let a longer link match a shorter route', () => {
    expect(matchesRoute(['editor', 'a', 'b'], ['editor', '[id]'])).toBe(false);
  });
});
