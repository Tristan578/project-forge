/**
 * Guards the public marketing surface against fabricated social proof.
 *
 * SpawnForge is pre-launch and waitlist-only. The landing page once shipped
 * three endorsements attributed to invented people with invented job titles,
 * plus a "Join thousands of creators" line, while every CTA on the same page
 * read "Join the Waitlist" (PF-1020). Those were removed; this is the guard
 * that they do not come back — anywhere.
 *
 * Why a source scan and not just a DOM assertion: LandingPage.test.tsx already
 * asserts the rendered landing page carries no attributed endorsement, but the
 * public surface is ten-plus routes (/about, /pricing, /compare, /community,
 * /blog, /use-cases, …). A guard scoped to one component would not have
 * noticed the same copy reappearing on any of the others, which is exactly how
 * this class of claim spreads. Scanning directories rather than a file list
 * means new files inside them are covered automatically, with no list to rot.
 *
 * If a check here fires, the fix is to delete the claim — not to loosen the
 * pattern. The one legitimate reason to touch these regexes is a REAL,
 * verifiable, externally-citable figure; in that case add the citation next to
 * the number in the source and narrow the pattern deliberately, in its own
 * commit, with the evidence in the PR body.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const APP_DIR = resolve(__dirname, '..');
const WEB_ROOT = resolve(APP_DIR, '..', '..');

/**
 * Routes INTENDED to be reachable with no auth redirect, plus the shared
 * marketing components.
 *
 * The authority on what is actually public is `buildPublicRoutes()` in
 * `web/src/proxy.ts`, not a page-level grep: most public pages carry no auth
 * code of their own, and anything the proxy's matcher does not list falls
 * through to `redirectToSignIn`. Every entry below was checked against that
 * list, with one deliberate exception:
 *
 * - `src/app/docs` is INTENDED to be public — it exports SEO metadata, uses
 *   `cacheLife('days')` (meaningless for a per-user page), and the landing-page
 *   footer links to it — but it is missing from `buildPublicRoutes()` today, so
 *   anonymous visitors are currently redirected to sign-in. That is a separate
 *   routing bug, tracked as PF-1038. It stays listed here on purpose:
 *   over-inclusion cannot cause a false negative, and the guard starts covering
 *   the route the moment PF-1038 lands. Do not remove it.
 *
 * `play/[userId]/[slug]` calls `safeAuth()` only to set a display flag and
 * never redirects, so it belongs. `dashboard`, `settings`, `editor` and `admin`
 * are rightly absent — each redirects anonymous requests.
 *
 * Adding a public route? Add it here. The per-entry assertion below fails if an
 * entry stops resolving, but nothing can detect a route you never listed.
 */
const PUBLIC_SURFACE = [
  'src/app/page.tsx',
  'src/app/about',
  'src/app/api-docs',
  'src/app/blog',
  'src/app/changelog',
  'src/app/community',
  'src/app/compare',
  'src/app/docs',
  'src/app/faq',
  'src/app/play',
  'src/app/pricing',
  'src/app/privacy',
  'src/app/sign-in',
  'src/app/sign-up',
  'src/app/terms',
  'src/app/use-cases',
  'src/components/marketing',
];

/**
 * Each pattern describes a claim the product cannot currently back.
 *
 * Deliberately NOT included: a bare `<blockquote>`. Quoting a spec or an
 * article in a blog post is legitimate; it is the ATTRIBUTED-to-a-person shape
 * on the landing page that was the violation, and LandingPage.test.tsx covers
 * that structurally.
 */
const FABRICATED_SOCIAL_PROOF: { label: string; pattern: RegExp }[] = [
  {
    label: 'unverifiable population claim ("thousands of creators")',
    pattern:
      /\b(thousands|millions|hundreds|dozens) of\s+(?:\w+\s+)?(creators|developers|devs|users|studios|teams|makers|builders|customers)\b/i,
  },
  {
    label: 'bare user count ("10k+ users", "Join 5,000 creators")',
    pattern:
      /\b\d[\d,]*\s*(?:k|m)?\+?\s+(creators|developers|devs|users|studios|teams|makers|builders|customers)\b/i,
  },
  {
    label: 'trust-badge heading ("Trusted by", "Loved by")',
    pattern: /\b(trusted|loved)\s+by\b/i,
  },
  {
    label: 'review/rating structured data',
    pattern: /\b(aggregateRating|reviewCount|ratingValue)\b/,
  },
  {
    label: 'Review or AggregateRating JSON-LD',
    pattern: /"@type"\s*:\s*"(Review|AggregateRating)"/,
  },
];

function collectSources(relative: string): string[] {
  const absolute = join(WEB_ROOT, relative);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];

  return readdirSync(absolute).flatMap((entry) => {
    // Test files legitimately name the strings they guard against.
    if (entry === '__tests__' || entry === 'node_modules') return [];
    const nested = join(relative, entry);
    const nestedAbs = join(WEB_ROOT, nested);
    if (statSync(nestedAbs).isDirectory()) return collectSources(nested);
    return /\.(tsx?|mdx?)$/.test(entry) ? [nestedAbs] : [];
  });
}

describe('public marketing surface', () => {
  const files = PUBLIC_SURFACE.flatMap(collectSources);

  /**
   * Fail closed, per entry.
   *
   * A single aggregate floor is not enough: the list resolves to ~30 files, so
   * a floor of 10 would still pass green after two route directories were
   * renamed away. Asserting that EVERY entry resolves to at least one file
   * makes any one rename turn red, and names the entry that broke.
   */
  it.each(PUBLIC_SURFACE)('resolves %s to at least one source file', (entry) => {
    expect(
      collectSources(entry).length,
      `${entry} resolved to no files — the route moved or was deleted. Update PUBLIC_SURFACE; do not delete the entry to make this pass.`
    ).toBeGreaterThan(0);
  });

  it.each(FABRICATED_SOCIAL_PROOF)(
    'publishes no $label',
    ({ pattern, label }) => {
      const offenders = files
        .filter((file) => pattern.test(readFileSync(file, 'utf-8')))
        .map((file) => file.slice(WEB_ROOT.length + 1));

      expect(
        offenders,
        `${label} found on the public surface. Remove the claim — do not loosen this pattern.`
      ).toEqual([]);
    }
  );
});
