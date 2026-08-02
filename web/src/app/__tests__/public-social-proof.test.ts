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

/** Public, unauthenticated routes plus the shared marketing components. */
const PUBLIC_SURFACE = [
  'src/app/page.tsx',
  'src/app/about',
  'src/app/blog',
  'src/app/changelog',
  'src/app/community',
  'src/app/compare',
  'src/app/faq',
  'src/app/pricing',
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

  it('actually resolves the public surface', () => {
    // Fail closed. A renamed route directory would otherwise scan nothing and
    // report green, which is the failure mode this whole file exists to avoid.
    expect(
      files.length,
      'PUBLIC_SURFACE resolved to (almost) no files — a route moved, update the list'
    ).toBeGreaterThanOrEqual(10);
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
