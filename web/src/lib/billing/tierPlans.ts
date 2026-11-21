/**
 * The one place that knows what each subscription tier is called, what it
 * costs, and what it allows.
 *
 * Tier KEYS are internal billing identifiers and are not what users see. The
 * `$9` plan is keyed `hobbyist` but is called "Starter" on every public
 * surface, while the free plan is keyed `starter`. That collision is why every
 * surface that re-derived its own label got at least one of them wrong.
 *
 * This module deliberately re-exports the limit maps rather than restating
 * their values — a second copy of a number is the defect, not the fix. Only
 * facts with no existing home (display names, prices) are declared here.
 *
 * Keep this module free of Node-only imports: it is read by
 * `app/pricing/opengraph-image.tsx`, which runs on the Edge runtime.
 */

import { PROJECT_LIMITS, ENTITY_LIMITS, PUBLISH_LIMITS } from '@/lib/projects/limits';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

export { PROJECT_LIMITS, ENTITY_LIMITS, PUBLISH_LIMITS, TIER_MONTHLY_TOKENS };

/** Internal billing tier identifiers, in ascending order of entitlement. */
export const TIER_KEYS = ['starter', 'hobbyist', 'creator', 'pro'] as const;

export type TierKey = (typeof TIER_KEYS)[number];

/**
 * What each tier is called in the UI, in marketing copy, and on the Stripe
 * checkout page. Never render a raw tier key to a user — `hobbyist` reads as a
 * different, cheaper product than the "Starter" plan it actually is.
 */
export const TIER_DISPLAY_NAMES: Record<TierKey, string> = {
  starter: 'Free',
  hobbyist: 'Starter',
  creator: 'Creator',
  pro: 'Studio',
};

/**
 * Monthly subscription price in cents, matching the live Stripe Price objects
 * referenced by `STRIPE_PRICE_STARTER` / `_CREATOR` / `_STUDIO`.
 *
 * Stripe remains the authority on what a customer is actually charged; these
 * values exist so the marketing surfaces quote one number instead of four.
 * Changing a price in Stripe without changing it here makes the site lie.
 */
export const TIER_PRICE_CENTS: Record<TierKey, number> = {
  starter: 0,
  hobbyist: 900,
  creator: 2900,
  pro: 7900,
};

/**
 * Renders a tier limit for display. `PROJECT_LIMITS.pro` is `Infinity`, which
 * stringifies to the literal "Infinity" — a number no user has ever wanted to
 * read on a pricing card.
 */
export function formatLimit(limit: number): string {
  if (!Number.isFinite(limit)) return 'Unlimited';
  return limit.toLocaleString('en-US');
}

/** Renders a price in cents as it appears on the pricing cards. */
export function formatPrice(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

/** `3 projects`, `1 project`, `Unlimited projects`. */
export function countLabel(limit: number, singular: string, plural: string): string {
  return `${formatLimit(limit)} ${limit === 1 ? singular : plural}`;
}

/**
 * What each tier can do, beyond the numbers.
 *
 * Every line here is traceable to the code that enforces it. That constraint is
 * the whole point of this module: the pricing surfaces used to carry claims
 * ("Unlimited AI chat", "Remove branding", "Team collaboration", "Custom
 * domain") that no gate implemented and no feature existed for.
 *
 * - `starter` has no AI at all. `/api/chat` rejects it (`assertTier`), the key
 *   resolver rejects it, and `PANEL_TIER_REQUIREMENTS` gates every AI panel at
 *   `hobbyist` or above — a free user can open none of them.
 * - `hobbyist` unlocks AI chat, the generation panels, and BYOK (`/api/keys`).
 *   Chat is rate limited to 10 requests/minute, so it is never "unlimited".
 * - `creator` adds the platform MCP key (`/api/keys/api-key`) and the
 *   creator-gated panels in `PANEL_TIER_REQUIREMENTS`.
 * - `pro` reaches platform keys without a token balance (`resolver.ts` exempts
 *   it from the balance check) and the four pro-only panels.
 */
const TIER_CAPABILITIES: Record<TierKey, readonly string[]> = {
  starter: ['Full editor and local export', 'No AI features'],
  hobbyist: ['AI chat and asset generation', 'Bring your own AI keys (BYOK)'],
  creator: ['MCP access for external AI tools', 'Advanced AI panels'],
  pro: ['Platform AI keys, no balance required', 'Pro AI panels'],
};

/** A plan exactly as it should be presented to a user. */
export interface TierPlan {
  key: TierKey;
  /** Public plan name. Never the raw key. */
  name: string;
  priceCents: number;
  /** `$0`, `$9`, `$29`, `$79`. */
  price: string;
  /** Feature bullets, derived from the enforced limits and capabilities. */
  features: readonly string[];
}

/**
 * The four plans, in ascending order, with every quantified claim derived from
 * the limit map that enforces it rather than restated as prose. A limit change
 * moves the marketing copy in the same commit, which is the only reliable way
 * to keep the two in step.
 *
 * `ENTITY_LIMITS` is deliberately absent: it is declared but no code path reads
 * it, so an entity cap is not a limit we can honestly quote.
 */
export const TIER_PLANS: readonly TierPlan[] = TIER_KEYS.map((key) => ({
  key,
  name: TIER_DISPLAY_NAMES[key],
  priceCents: TIER_PRICE_CENTS[key],
  price: formatPrice(TIER_PRICE_CENTS[key]),
  features: [
    countLabel(PROJECT_LIMITS[key], 'cloud project', 'cloud projects'),
    countLabel(PUBLISH_LIMITS[key], 'published game', 'published games'),
    ...(key === 'starter'
      ? []
      : [`${formatLimit(TIER_MONTHLY_TOKENS[key])} AI tokens/month`]),
    ...TIER_CAPABILITIES[key],
  ],
}));

/**
 * True when a feature bullet states an absence ("No AI features") rather than an
 * inclusion. Every surface that lists these bullets must mark them as a
 * constraint — a green check beside "No AI features" reads as the opposite of
 * what it says.
 */
export function isExclusionFeature(feature: string): boolean {
  return feature.startsWith('No ');
}

/** Looks a plan up by its internal billing key. */
export function getTierPlan(key: TierKey): TierPlan {
  const plan = TIER_PLANS.find((p) => p.key === key);
  // TIER_PLANS is built from TIER_KEYS, so this cannot miss for a valid key.
  if (!plan) throw new Error(`Unknown tier: ${key}`);
  return plan;
}

/**
 * One-line plan summary for metadata descriptions and structured data, e.g.
 * `Free ($0/mo)`.
 */
export function tierSummary(plan: TierPlan): string {
  return `${plan.name} (${plan.price}/mo)`;
}

/** The plans a user actually pays for, ascending. */
export const PAID_TIER_PLANS: readonly TierPlan[] = TIER_PLANS.filter(
  (plan) => plan.priceCents > 0,
);

/**
 * Every paid plan named with its price, e.g.
 * `$9/mo Starter, $29/mo Creator, $79/mo Studio`.
 *
 * For comparison prose that has to enumerate the ladder. Written by hand, this
 * is where the `$29/mo Pro` (no such plan) and `$99/mo Studio` (charged $79)
 * copy came from.
 */
export function paidPlansSentence(): string {
  return PAID_TIER_PLANS.map((plan) => `${plan.price}/mo ${plan.name}`).join(', ');
}

/**
 * The paid range as a span, e.g. `$9-$79/mo`. Collapses to a single price if
 * there is ever only one paid plan.
 */
export function paidPriceRange(): string {
  const first = PAID_TIER_PLANS[0];
  const last = PAID_TIER_PLANS[PAID_TIER_PLANS.length - 1];
  if (!first || !last) return 'free';
  return first === last ? `${first.price}/mo` : `${first.price}-${last.price}/mo`;
}
