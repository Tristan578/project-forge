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
import { TIER_MONTHLY_TOKENS, TRIAL_GRANT_TOKENS } from '@/lib/tokens/pricing';
import { currentPublicCapabilities, type PublicCapabilityFlags } from '@/lib/config/publicCapabilities';

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

/** Suffix marking a bullet for a capability production does not deliver yet. */
export const COMING_AFTER_LAUNCH = '(coming after launch)';

/**
 * What each tier can do, beyond the numbers.
 *
 * Every line here is traceable to the code that enforces it. That constraint is
 * the whole point of this module: the pricing surfaces used to carry claims
 * ("Unlimited AI chat", "Remove branding", "Team collaboration", "Custom
 * domain") that no gate implemented and no feature existed for.
 *
 * - `starter` has no monthly AI allocation. Signup grants `TRIAL_GRANT_TOKENS`
 *   once (#7715), and while a starter account holds spendable tokens
 *   `effectiveTier` treats it as `hobbyist` on the four AI gates (`/api/chat`
 *   and `/api/game/decompose` via `assertAiAccess`, the key resolver,
 *   `createGenerationHandler`'s per-route `panel` check, and
 *   `PANEL_TIER_REQUIREMENTS` through `canAccessPanel` in the editor). With
 *   the tokens spent it can open none of them.
 * - `hobbyist` unlocks AI chat, the generation panels, and BYOK (`/api/keys`).
 *   Chat is rate limited to 10 requests/minute, so it is never "unlimited".
 * - `creator` adds the platform MCP key (`/api/keys/api-key`) and the
 *   creator-gated panels in `PANEL_TIER_REQUIREMENTS`.
 * - `pro` reaches platform keys without a token balance (`resolver.ts` exempts
 *   it from the balance check) and the four pro-only panels.
 *
 * What production can deliver TODAY is a separate question from what the gates
 * allow: production holds no platform generation keys (#9117) and the hosted MCP
 * bridge is off (#9722), so those bullets are flag-driven below.
 */
/**
 * The capability bullets for each tier, written against the flags in
 * `lib/config/publicCapabilities.ts`. With a flag off, the bullet says what is
 * true today ("bring your own key", "coming after launch") instead of what the
 * plan will eventually include. Exported so the test can render both states.
 */
export function buildTierCapabilities(
  flags: PublicCapabilityFlags,
): Record<TierKey, readonly string[]> {
  return {
    starter: [
      'Full editor and local export',
      `${TRIAL_GRANT_TOKENS} trial AI tokens at signup`,
      'No monthly AI tokens',
    ],
    hobbyist: flags.platformGenerationKeys
      ? ['AI chat and asset generation', 'Bring your own AI keys (BYOK)']
      : ['AI chat', 'Asset generation with your own API keys (BYOK)'],
    creator: [
      flags.hostedMcp
        ? 'MCP access for external AI tools'
        : `MCP access for external AI tools ${COMING_AFTER_LAUNCH}`,
      'Advanced AI panels',
    ],
    pro: [
      flags.platformGenerationKeys
        ? 'Platform AI keys, no balance required'
        : `Platform AI keys, no balance required ${COMING_AFTER_LAUNCH}`,
      'Pro AI panels',
    ],
  };
}

const TIER_CAPABILITIES = buildTierCapabilities(currentPublicCapabilities());

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
 * True when a feature bullet states an absence ("No monthly AI tokens") or a
 * capability that is not delivered yet ("... (coming after launch)") rather
 * than an inclusion. Every surface that lists these bullets must mark them as
 * a constraint — a green check beside "No monthly AI tokens" reads as the
 * opposite of what it says.
 */
export function isExclusionFeature(feature: string): boolean {
  return feature.startsWith('No ') || feature.endsWith(COMING_AFTER_LAUNCH);
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
