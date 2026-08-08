/**
 * Drift guard for PF-1021 — public pricing copy diverged from the code that
 * enforces it.
 *
 * Every surface that talks about tiers used to carry its own hand-written copy
 * of the plan names, prices, and limits. They disagreed with each other and
 * with the server: the landing page and the share card sold a "$99 Pro" plan
 * the pricing cards sold as "$79 Studio"; the free tier was advertised with
 * "AI chat (limited)" that `/api/chat` rejects outright; "5 published games"
 * was quoted against a server limit of 3; and features nothing implements
 * ("Custom domain", "Remove branding", "Team collaboration") were sold on
 * three surfaces at once.
 *
 * The fix was to derive every one of those surfaces from
 * `@/lib/billing/tierPlans`, which in turn derives from the limit maps the API
 * routes enforce. These assertions are structural — they read the SOURCE of
 * each public surface — because that is the shape of the failure: a hardcoded
 * literal renders perfectly and looks correct in review. Only its disagreement
 * with another file makes it a bug, and nothing compares two files but this.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  TIER_KEYS,
  TIER_PLANS,
  TIER_DISPLAY_NAMES,
  TIER_PRICE_CENTS,
  PROJECT_LIMITS,
  PUBLISH_LIMITS,
  TIER_MONTHLY_TOKENS,
  countLabel,
  formatLimit,
  formatPrice,
  isExclusionFeature,
} from '@/lib/billing/tierPlans';

const SRC_DIR = resolve(__dirname, '../..');

/**
 * Every surface that states a plan name, a price, or a tier limit to the
 * public. Adding an eighth without adding it here is how the class reopens, so
 * the list is deliberately explicit rather than a glob.
 */
const PUBLIC_SURFACES = [
  'app/pricing/page.tsx',
  'app/pricing/opengraph-image.tsx',
  'app/faq/page.tsx',
  'app/compare/[competitor]/page.tsx',
  'app/blog/content/spawnforge-vs-unity-vs-godot.tsx',
  'components/pricing/PricingPage.tsx',
  'components/marketing/LandingPage.tsx',
] as const;

type PublicSurface = (typeof PUBLIC_SURFACES)[number];

/**
 * The comparison surfaces quote what OTHER engines charge, which is not ours to
 * derive. Each allowance is enumerated per file rather than loosening the price
 * regex, so a SpawnForge price added to one of these pages still fails: the
 * scan only forgives the exact competitor figures listed here, and
 * `the third-party price allowance stays honest` below fails on any entry that
 * has stopped appearing in its file.
 */
const THIRD_PARTY_PRICES: Partial<Record<PublicSurface, readonly string[]>> = {
  // Unity Plus/Pro seats, and GameMaker's export tier.
  'app/compare/[competitor]/page.tsx': ['$399', '$2040', '$9.99'],
  // Unity's revenue cap ($200K) and the same two Unity seat prices.
  'app/blog/content/spawnforge-vs-unity-vs-godot.tsx': ['$200', '$399', '$2,040'],
};

/**
 * Strip a line comment, but only when the `//` is genuinely outside a string.
 *
 * This was a regex that stripped any `//` not preceded by `:` or a word
 * character — so a single space in front was enough to fool it, and
 * `'50% off // ends soon'` silently truncated the rest of the line. Any price
 * after such a `//` went unscanned, which is exactly the hole this file exists
 * to close. Walking the line and tracking quote state costs a few lines and
 * removes the class.
 *
 * The `:` guard is kept as well: quote state is tracked per line, so a
 * continuation line of a multi-line template literal holding a `https://` URL
 * has no opening quote to see, and would otherwise be truncated.
 */
const stripLineComment = (line: string): string => {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
  }
  return line;
};

/**
 * Comments are where these files explain which wrong price or key they used to
 * carry, so scanning them would make every surface fail for documenting its own
 * fix. Block comments go first, then line comments per line.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(stripLineComment)
    .join('\n');

const read = (rel: string) => stripComments(readFileSync(resolve(SRC_DIR, rel), 'utf8'));

/**
 * Sold on the landing page, the pricing JSON-LD, and the share card — and
 * implemented nowhere. `hideBranding` and `creatorTier` exist in
 * `export/gameTemplate.ts` with zero callers; there is no custom-domain or
 * team-collaboration code path at all. Selling them is the defect, not a
 * missing feature: the honest fix is to stop listing them until they ship.
 */
const UNIMPLEMENTED_CLAIMS = [
  'Custom domain',
  'Remove branding',
  'Team collaboration',
  'Custom integrations',
  'Priority support',
  // Rate-limited to 10 requests/60s AND capped by a finite monthly token grant.
  'Unlimited AI chat',
];

/**
 * Extract every hardcoded dollar figure. `${` never matches — a digit must
 * follow the `$`. Cents are captured so GameMaker's `$9.99` reads as `$9.99`
 * and needs its own allowance, rather than truncating to `$9` and passing as
 * one of ours by coincidence.
 */
const quotedPrices = (source: string) => source.match(/\$\d[\d,]*(?:\.\d+)?/g) ?? [];

describe('the scanners themselves catch a violation', () => {
  // Every surface currently derives its prices, so the scan below finds zero
  // literals — a passing-because-empty result. These cases keep that honest:
  // if a regex is ever broken so it matches nothing, this fails first.
  it('flags a price no plan charges and passes one that a plan does', () => {
    expect(quotedPrices('the top plan is $99/mo, down from $79')).toEqual(['$99', '$79']);
    expect(quotedPrices('`${plan.price}/mo`')).toEqual([]);
  });

  it('reads cents rather than truncating to the dollars', () => {
    expect(quotedPrices('competitor: $9.99/mo for exports')).toEqual(['$9.99']);
  });

  it('flags a capitalized internal billing key', () => {
    expect(/\bHobbyist\b/.test('the Hobbyist tier')).toBe(true);
    expect(/\bHobbyist\b/.test("getTierPlan('hobbyist')")).toBe(false);
  });
});

describe('stripComments hides only what a comment says', () => {
  // Everything below the scan depends on this: over-strip and a real price
  // disappears from every assertion, silently, while the suite stays green.
  it('drops a whole-line comment and a trailing one', () => {
    expect(stripComments('// we used to charge $99\nconst a = 1;')).toBe('\nconst a = 1;');
    expect(stripComments('const a = 1; // was $99')).toBe('const a = 1; ');
  });

  it('drops a block comment', () => {
    expect(stripComments('/* charged $99\n   for years */const a = 1;')).toBe('const a = 1;');
  });

  it('keeps a price that follows a // inside a string literal', () => {
    // The regex this replaced stripped any `//` not preceded by `:` or a word
    // character, so the space in front of these slashes was enough to erase
    // the price after them and hide it from the scan entirely.
    const line = "const copy = 'half off // limited', price = '$99';";
    expect(quotedPrices(stripComments(line))).toEqual(['$99']);
  });

  it('keeps a URL, inside a string and on a template-literal continuation line', () => {
    expect(stripComments("const u = 'https://x.test/$99';")).toContain('https://x.test/$99');
    expect(stripComments('  see https://x.test for $99')).toContain('https://x.test for $99');
  });

  it('confines an unbalanced apostrophe to its own line', () => {
    // JSX prose is not JavaScript: `don't` opens a quote that never closes. A
    // whole-source scanner would swallow every price until the next `'`.
    const source = "<p>don't miss it</p>\nconst price = '$99'; // was $199";
    expect(quotedPrices(stripComments(source))).toEqual(['$99']);
  });
});

describe('public pricing copy stays in step with what the code enforces', () => {
  describe.each(PUBLIC_SURFACES)('%s', (rel) => {
    const source = read(rel);

    it('derives its plan data from the billing source of truth', () => {
      expect(source).toMatch(/from '@\/lib\/billing\/tierPlans'/);
    });

    it('states no price the billing module does not charge', () => {
      const allowed = new Set(TIER_KEYS.map((t) => formatPrice(TIER_PRICE_CENTS[t])));
      const thirdParty = new Set(THIRD_PARTY_PRICES[rel] ?? []);
      for (const price of quotedPrices(source)) {
        expect(
          allowed.has(price) || thirdParty.has(price),
          `${rel} quotes ${price}`
        ).toBe(true);
      }
    });

    it('never renders an internal billing key as a plan name', () => {
      // `hobbyist` sells as "Starter" and `pro` as "Studio". Capitalizing the
      // key — which two surfaces and one AI plan summary did — names a plan
      // that appears on no card the user can buy.
      expect(source).not.toMatch(/\bHobbyist\b/);
    });

    it.each(UNIMPLEMENTED_CLAIMS)('does not sell %s', (claim) => {
      expect(source.includes(claim), `${rel} sells "${claim}"`).toBe(false);
    });
  });

  it('the third-party price allowance stays honest', () => {
    // An allowance is a hole in the scan. Once the figure it was opened for is
    // gone, the hole is not — it silently forgives that price for anything
    // added to the file later, including one of ours.
    for (const [rel, prices] of Object.entries(THIRD_PARTY_PRICES)) {
      const source = read(rel);
      for (const price of prices) {
        expect(source.includes(price), `${rel} no longer quotes ${price}`).toBe(true);
      }
    }
  });

  it('renders exclusions with a negative marker on every surface that lists features', () => {
    // `TIER_PLANS.features` mixes inclusions with the free tier's absence
    // bullet ("No AI features"). A surface that puts a check mark beside every
    // bullet turns that exclusion into a promise.
    for (const rel of ['components/pricing/PricingPage.tsx', 'components/marketing/LandingPage.tsx']) {
      expect(read(rel), rel).toMatch(/isExclusionFeature/);
    }
  });
});

describe('TIER_PLANS quotes the limits the server enforces', () => {
  it.each(TIER_KEYS)('%s states its project and publish allowances verbatim', (tier) => {
    const plan = TIER_PLANS.find((p) => p.key === tier)!;
    expect(plan.features).toContain(
      countLabel(PROJECT_LIMITS[tier], 'cloud project', 'cloud projects')
    );
    expect(plan.features).toContain(
      countLabel(PUBLISH_LIMITS[tier], 'published game', 'published games')
    );
  });

  it.each(TIER_KEYS.filter((t) => t !== 'starter'))('%s states its token grant', (tier) => {
    const plan = TIER_PLANS.find((p) => p.key === tier)!;
    expect(plan.features).toContain(`${formatLimit(TIER_MONTHLY_TOKENS[tier])} AI tokens/month`);
  });

  it('does not promise the free tier any AI capability', () => {
    // `/api/chat` calls `assertTier(['hobbyist', 'creator', 'pro'])`, and every
    // AI panel is gated the same way. "AI chat (limited)" was sold on three
    // surfaces against a hard 403.
    const free = TIER_PLANS.find((p) => p.key === 'starter')!;
    for (const feature of free.features) {
      if (/\bAI\b/.test(feature)) {
        expect(isExclusionFeature(feature), `free tier sells "${feature}"`).toBe(true);
      }
    }
  });

  it.each(TIER_PLANS)('$key uses its public name and rendered price', (plan) => {
    expect(plan.name).toBe(TIER_DISPLAY_NAMES[plan.key]);
    expect(plan.price).toBe(formatPrice(TIER_PRICE_CENTS[plan.key]));
  });

  it('sells nothing that has no implementation behind it', () => {
    for (const plan of TIER_PLANS) {
      for (const claim of UNIMPLEMENTED_CLAIMS) {
        expect(plan.features.join(' ').includes(claim), `${plan.key} sells "${claim}"`).toBe(false);
      }
    }
  });
});
