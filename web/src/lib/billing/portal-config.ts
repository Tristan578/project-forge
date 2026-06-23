import type Stripe from 'stripe';

/**
 * Portal session builder for the Stripe Customer Portal.
 *
 * Plan switching across the 4 tiers, payment-method update, and the cancellation
 * retention coupon are all defined on a Stripe **portal configuration** object
 * (Dashboard → Settings → Billing → Customer portal, or via the API). Adaptive
 * Pricing is a separate Dashboard toggle. None of that requires code here — the
 * portal renders whatever the active configuration allows.
 *
 * This helper layers two optional, fully env-guarded behaviours on top of the
 * Dashboard default:
 *
 *  1. `STRIPE_PORTAL_CONFIGURATION_ID` — pin the session to a specific portal
 *     configuration (e.g. a versioned config that enables plan switching across
 *     hobbyist/creator/pro + payment-method update + retention coupon). When
 *     unset, Stripe falls back to the account's default (Dashboard-managed)
 *     configuration, so the portal keeps working with zero code config.
 *
 *  2. `flow=cancel` — deep-link the customer straight into the subscription
 *     cancellation flow, where the Dashboard-configured retention coupon is
 *     offered. Requires a subscription id; if the user has no subscription on
 *     file the flow is silently omitted and the portal opens home instead.
 *
 * Every addition is omit-when-absent: a missing env var, unknown flow, or
 * missing subscription id yields the original `{ customer, return_url }` params,
 * so missing provisioning never breaks the route, CI, or existing behaviour.
 */

export type PortalFlow = 'cancel' | undefined;

export interface BuildPortalParamsInput {
  customer: string;
  returnUrl: string;
  /** Optional deep-link flow. Only `'cancel'` is recognised; anything else is ignored. */
  flow?: string | null;
  /**
   * The user's active Stripe subscription id. Required for the `cancel` flow —
   * Stripe rejects a `subscription_cancel` flow without it. When absent, the
   * cancel flow is skipped (portal opens home).
   */
  subscriptionId?: string | null;
  /** Override for the portal configuration id. Defaults to STRIPE_PORTAL_CONFIGURATION_ID. */
  configurationId?: string;
}

/** True when `flow` requests the cancellation/retention deep-link. */
export function isCancelFlow(flow?: string | null): boolean {
  return flow === 'cancel';
}

/**
 * Build the params for `stripe.billingPortal.sessions.create`.
 *
 * Pure + env-guarded: returns the minimal valid params when no optional config
 * is present, and layers `configuration` / `flow_data` on only when explicitly
 * provided (and, for the cancel flow, only when a subscription id is available).
 */
export function buildPortalSessionParams(
  input: BuildPortalParamsInput
): Stripe.BillingPortal.SessionCreateParams {
  const { customer, returnUrl, flow, subscriptionId } = input;

  const params: Stripe.BillingPortal.SessionCreateParams = {
    customer,
    return_url: returnUrl,
  };

  const configurationId =
    input.configurationId ?? process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  // Trim to treat a whitespace-only env var as absent.
  if (configurationId && configurationId.trim().length > 0) {
    params.configuration = configurationId.trim();
  }

  // The retention/cancel deep-link requires a concrete subscription to cancel.
  if (isCancelFlow(flow) && subscriptionId && subscriptionId.trim().length > 0) {
    params.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscriptionId.trim() },
      // After the cancel flow completes, send the customer back to the dashboard.
      after_completion: {
        type: 'redirect',
        redirect: { return_url: returnUrl },
      },
    };
  }

  return params;
}
