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
