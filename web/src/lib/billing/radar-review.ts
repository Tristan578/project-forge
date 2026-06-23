/**
 * Stripe Radar fraud-review handling for token-pack purchases (PF-913 / #8823).
 *
 * Capability: when Radar flags a one-time token-pack payment for manual review,
 * DEFER (hold) the token credit grant until the review clears. Tokens are only
 * granted once Stripe closes the review as `approved`. A review closed as
 * `refunded` / `refunded_as_fraud` / `disputed` / `canceled` never grants, and a
 * dispute reverses any credit that did land.
 *
 * Why hold rather than credit-then-claw-back: a fraudulent buyer can spend
 * generation tokens the instant they're credited, so by the time a refund or
 * dispute arrives the value is already consumed and unrecoverable. Holding the
 * grant behind the Radar verdict closes that abuse window.
 *
 * FEATURE GUARD — `STRIPE_RADAR_REVIEW_HOLD`:
 *   - Unset / not exactly the string "true"  → DISABLED. The webhook credits a
 *     token-pack purchase immediately at `checkout.session.completed`, exactly as
 *     before this change. `review.*` / `charge.dispute.created` events are
 *     acknowledged and ignored. This is the safe default so the feature is inert
 *     until the user provisions Radar review rules in the Stripe Dashboard.
 *   - "true" → ENABLED. Flagged purchases are held; the credit is released on a
 *     `review.closed { closed_reason: 'approved' }` event.
 *
 * NO new DB table / migration: the "held" state is simply the ABSENCE of a
 * `token_purchases` row for the payment intent. The eventual release calls the
 * existing idempotent `creditAddonTokens()` (keyed UNIQUE on
 * `stripe_payment_intent` via ON CONFLICT DO NOTHING), so a duplicate
 * `review.closed` redelivery — or a race with any other crediting path — grants
 * exactly once.
 *
 * This module is additive to `subscription-lifecycle.ts` and shares its
 * `reverseAddonTokens` clawback (PF-911 edits the same webhook route file in a
 * parallel branch — keep changes here additive).
 */

import type Stripe from 'stripe';
import { creditAddonTokens } from '@/lib/tokens/service';
import { TOKEN_PACKAGES, type TokenPackage } from '@/lib/tokens/pricing';
import {
  findUserByStripeCustomer,
  reverseAddonTokens,
} from '@/lib/billing/subscription-lifecycle';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Whether the Radar review-hold capability is enabled. Mirrors the
 * `hasValidClerkKey`-style env guard: any value other than the exact string
 * "true" leaves the feature OFF, so it is inert until the user provisions the
 * Dashboard Radar rules and flips the flag.
 */
export function isRadarReviewHoldEnabled(): boolean {
  return process.env.STRIPE_RADAR_REVIEW_HOLD === 'true';
}

/** Type guard for a value that is a known token package key. */
function isTokenPackage(value: string | undefined): value is TokenPackage {
  return value != null && Object.prototype.hasOwnProperty.call(TOKEN_PACKAGES, value);
}

/** Resolve a Stripe id-or-object reference to its id string. */
function refId(
  ref: string | { id: string } | null | undefined
): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Decide whether a completed token-pack checkout should be HELD (credit
 * deferred) because Radar flagged its payment for manual review.
 *
 * Returns `false` (do NOT hold → credit immediately) when:
 *   - the feature flag is off, OR
 *   - we cannot positively confirm an open review (fail-open: never strand a
 *     legitimate buyer's tokens on an inconclusive read).
 *
 * Returns `true` only when we positively observe an OPEN review on the payment
 * intent or its latest charge. The caller credits iff this returns `false`.
 *
 * Detection reads the PaymentIntent (expanding `latest_charge`) and checks:
 *   - `paymentIntent.review` is set (an open Review id/object), or
 *   - `latest_charge.review` is set, or
 *   - `latest_charge.outcome.type === 'manual_review'` (Radar's review verdict).
 */
export async function isCheckoutHeldForReview(
  paymentIntentId: string,
  stripe: Stripe
): Promise<boolean> {
  if (!isRadarReviewHoldEnabled()) return false;

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });

    if (pi.review) return true;

    const charge =
      pi.latest_charge && typeof pi.latest_charge === 'object'
        ? (pi.latest_charge as Stripe.Charge)
        : null;

    if (charge?.review) return true;
    if (charge?.outcome?.type === 'manual_review') return true;

    return false;
  } catch (err) {
    // Fail-open: if we cannot read the review state, do NOT hold — a flagged
    // payment that slips through is still caught later by `review.closed`
    // (refunded/disputed reverse via the dispute/refund paths), whereas wrongly
    // holding a legitimate purchase strands a paying customer's tokens forever.
    captureException(err, {
      route: '/api/stripe/webhook',
      phase: 'radar-review-hold-check',
      paymentIntentId,
    });
    return false;
  }
}

/**
 * Release a held credit when its Radar review closes as `approved`.
 *
 * Recovers the `userId` + `package` from the PaymentIntent metadata (propagated
 * by the checkout route via `payment_intent_data.metadata`) and grants via the
 * idempotent `creditAddonTokens`. Any non-`approved` close reason
 * (refunded / refunded_as_fraud / disputed / canceled / …) grants nothing — the
 * hold simply expires with no tokens issued.
 *
 * No-op when the feature flag is off.
 */
export async function handleReviewClosed(
  review: Stripe.Review,
  stripe: Stripe
): Promise<void> {
  if (!isRadarReviewHoldEnabled()) return;

  // Only an explicit `approved` close releases the held grant.
  if (review.closed_reason !== 'approved') return;

  const paymentIntentId = refId(review.payment_intent);
  if (!paymentIntentId) return;

  // The token-pack metadata (userId, package) lives on the PaymentIntent —
  // propagated from the checkout session via `payment_intent_data.metadata`.
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const userId = pi.metadata?.userId;
  const pkg = pi.metadata?.package;

  // Not a token-pack payment (no metadata) → nothing to release.
  if (!userId || !isTokenPackage(pkg)) return;

  await creditAddonTokens(userId, pkg, paymentIntentId);
}

/**
 * `review.opened` — observational only. The actual hold is enforced at
 * `checkout.session.completed` (we simply do not credit a flagged purchase), so
 * there is nothing to mutate here. Kept as a seam for future alerting.
 *
 * No-op when the feature flag is off.
 */
export async function handleReviewOpened(review: Stripe.Review): Promise<void> {
  if (!isRadarReviewHoldEnabled()) return;
  console.info(
    `[stripe-webhook] Radar review opened (${review.id}, reason=${review.opened_reason}); token grant held pending review.`
  );
}

/**
 * `charge.dispute.created` — a customer disputed a charge. If tokens were
 * already granted for the disputed charge's payment intent, claw them back
 * proportionally (full dispute = full reversal) via the shared
 * `reverseAddonTokens` path, which is idempotent on `(chargeId, amount)`.
 *
 * No-op when the feature flag is off, or when the dispute has no customer /
 * charge we can resolve.
 */
export async function handleDisputeCreated(
  dispute: Stripe.Dispute,
  stripe: Stripe
): Promise<void> {
  if (!isRadarReviewHoldEnabled()) return;

  const chargeId = refId(dispute.charge);
  if (!chargeId) return;

  // Resolve customer + payment intent from the charge (the Dispute object does
  // not directly carry the customer).
  const charge = await stripe.charges.retrieve(chargeId);
  const customerId = refId(charge.customer);
  if (!customerId) return;

  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const paymentIntentId = refId(charge.payment_intent);

  // amount is the disputed amount (cents); charge.amount is the original total.
  if (dispute.amount <= 0 || charge.amount <= 0) return;

  await reverseAddonTokens(
    user.id,
    chargeId,
    dispute.amount,
    charge.amount,
    paymentIntentId
  );
}
