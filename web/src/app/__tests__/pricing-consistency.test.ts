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
 * public. Adding a sixth without adding it here is how the class reopens, so
 * the list is deliberately explicit rather than a glob.
 */
const PUBLIC_SURFACES = [
  'app/pricing/page.tsx',
  'app/pricing/opengraph-image.tsx',
  'app/faq/page.tsx',
  'components/pricing/PricingPage.tsx',
  'components/marketing/LandingPage.tsx',
] as const;

/**
 * Comments are where these files explain which wrong price or key they used to
 * carry, so scanning them would make every surface fail for documenting its own
 * fix. Block comments go first; line comments are only stripped when the `//`
 * is not preceded by `:`, so a `https://` inside a string survives intact.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w])\/\/.*$/gm, '$1');

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

/** Extract every hardcoded dollar figure. `${` never matches — a digit must follow the `$`. */
const quotedPrices = (source: string) => source.match(/\$\d[\d,]*/g) ?? [];

describe('the scanners themselves catch a violation', () => {
  // Every surface currently derives its prices, so the scan below finds zero
  // literals — a passing-because-empty result. These cases keep that honest:
  // if a regex is ever broken so it matches nothing, this fails first.
  it('flags a price no plan charges and passes one that a plan does', () => {
    expect(quotedPrices('the top plan is $99/mo, down from $79')).toEqual(['$99', '$79']);
    expect(quotedPrices('`${plan.price}/mo`')).toEqual([]);
  });

  it('flags a capitalized internal billing key', () => {
    expect(/\bHobbyist\b/.test('the Hobbyist tier')).toBe(true);
    expect(/\bHobbyist\b/.test("getTierPlan('hobbyist')")).toBe(false);
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
      for (const price of quotedPrices(source)) {
        expect(allowed.has(price), `${rel} quotes ${price}`).toBe(true);
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
