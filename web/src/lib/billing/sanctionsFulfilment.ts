/**
 * Sanctions check at fulfilment (#9331): the Stripe webhook's half of the
 * purchase block in `web/src/lib/security/sanctionsGeoBlock.ts`.
 *
 * The purchase routes refuse up front only when a KNOWN signal (today, the
 * Vercel IP country) is listed; a buyer Vercel cannot place is let through to
 * Checkout, which now requires a billing address. This module reads that
 * address (and, for a one-time payment, the card's issuing country) when the
 * payment completes, and refuses to grant anything to a listed one:
 *
 *  - token pack (`checkout.session.completed`, mode `payment`): no credit; the
 *    payment is refunded in full;
 *  - subscription (`checkout.session.completed`, mode `subscription`): the
 *    subscription is cancelled and its first invoice's payment refunded;
 *    `customer.subscription.created`, an upgrade in `customer.subscription.updated`
 *    and a non-empty entitlement summary are not applied for a customer whose
 *    saved address is listed.
 *
 * A refund this module issues marks the charge first
 * ({@link SANCTIONS_REFUND_METADATA_KEY}), so the `charge.refunded` it causes
 * does not claw back addon tokens the buyer never received.
 *
 * Every lookup here fails OPEN (returns "not restricted") on a Stripe error and
 * reports it: the address on the Checkout Session needs no lookup, so a listed
 * buyer is still caught there, and a Stripe outage must not strand a lawful
 * buyer's purchase.
 */
import type Stripe from 'stripe';
import { captureException, sentryLogger } from '@/lib/monitoring/sentry-server';
import {
  findRestrictedSignal,
  type CountrySignal,
  type CountrySource,
  type RestrictedMatch,
} from '@/lib/security/sanctionsGeoBlock';

/** Charge metadata key set on a payment this module refunds. */
export const SANCTIONS_REFUND_METADATA_KEY = 'spawnforge_sanctions_refund';

/** A Stripe address as a country signal. `state` carries the region, when any. */
export function addressSignal(
  source: CountrySource,
  address: Pick<Stripe.Address, 'country' | 'state'> | null | undefined,
): CountrySignal {
  return { source, country: address?.country ?? null, region: address?.state ?? null };
}

/** The listed jurisdiction the Checkout Session's billing address is in, if any. */
export function checkoutSessionRestriction(
  session: Pick<Stripe.Checkout.Session, 'customer_details'>,
): RestrictedMatch | null {
  return findRestrictedSignal([addressSignal('stripe-checkout-address', session.customer_details?.address)]);
}

/**
 * The listed jurisdiction the customer's saved billing address is in, if any.
 * Fails open (`null`) when the customer cannot be read.
 */
export async function customerBillingRestriction(
  stripe: Stripe,
  customerId: string,
): Promise<RestrictedMatch | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ('deleted' in customer && customer.deleted) return null;
    return findRestrictedSignal([addressSignal('stripe-customer-address', (customer as Stripe.Customer).address)]);
  } catch (err) {
    captureException(err, { route: '/api/stripe/webhook', phase: 'sanctions-customer-lookup' });
    return null;
  }
}

function chargeOf(pi: Stripe.PaymentIntent): Stripe.Charge | null {
  return pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
}

/**
 * The listed jurisdiction the payment's card was issued in, if any. Fails open
 * (`null`) when the PaymentIntent cannot be read.
 */
export async function paymentCardRestriction(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<RestrictedMatch | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const country = chargeOf(pi)?.payment_method_details?.card?.country ?? null;
    return findRestrictedSignal([{ source: 'stripe-card', country }]);
  } catch (err) {
    captureException(err, { route: '/api/stripe/webhook', phase: 'sanctions-card-lookup', paymentIntentId });
    return null;
  }
}

/** Whether a charge was refunded by {@link refundRestrictedPayment}. */
export function isSanctionsRefund(charge: Pick<Stripe.Charge, 'metadata'>): boolean {
  return Boolean(charge.metadata?.[SANCTIONS_REFUND_METADATA_KEY]);
}

/** Log a refused fulfilment. Country code and Stripe ids only; no personal data. */
export function logRefusedFulfilment(
  what: string,
  match: RestrictedMatch,
  ids: Record<string, string | null | undefined>,
): void {
  const attributes = {
    ...ids,
    country: match.jurisdiction.country,
    region: match.jurisdiction.region ?? null,
    signal: match.source,
  };
  console.warn(`[stripe-webhook] Sanctions: ${what}`, attributes);
  sentryLogger.warn(`sanctions: ${what}`, attributes);
}

function isAlreadyRefunded(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'charge_already_refunded';
}

/**
 * Refund a payment in full: mark its charge, then refund. Idempotent across
 * webhook redeliveries (Stripe idempotency key, and an already-refunded charge
 * counts as done). Throws on any other failure, so the webhook answers 500
 * and Stripe redelivers.
 */
export async function refundRestrictedPayment(
  stripe: Stripe,
  paymentIntentId: string,
  match: RestrictedMatch,
): Promise<void> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge = chargeOf(pi);
  // No charge yet (nothing was taken) or already refunded: nothing to do, and
  // a refund call would fail on every redelivery.
  if (!charge || charge.refunded) return;
  if (!isSanctionsRefund(charge)) {
    await stripe.charges.update(charge.id, {
      metadata: { [SANCTIONS_REFUND_METADATA_KEY]: match.jurisdiction.country },
    });
  }
  try {
    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: { [SANCTIONS_REFUND_METADATA_KEY]: match.jurisdiction.country },
      },
      { idempotencyKey: `sanctions-refund:${paymentIntentId}` },
    );
  } catch (err) {
    if (!isAlreadyRefunded(err)) throw err;
  }
}

/**
 * Cancel a subscription bought from a listed jurisdiction and refund every
 * paid payment on its first invoice. Safe to repeat: an already-cancelled
 * subscription is not cancelled again, and each refund is idempotent.
 */
export async function cancelRestrictedSubscription(
  stripe: Stripe,
  subscriptionId: string,
  invoiceId: string | null,
  match: RestrictedMatch,
): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.status !== 'canceled') {
    await stripe.subscriptions.cancel(subscriptionId, {
      cancellation_details: { comment: 'Sanctions policy: billing address in a restricted jurisdiction (#9331).' },
    });
  }
  if (!invoiceId) return;
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid' });
  for (const p of payments.data) {
    const pi = p.payment?.payment_intent;
    const paymentIntentId = typeof pi === 'string' ? pi : pi?.id;
    if (paymentIntentId) await refundRestrictedPayment(stripe, paymentIntentId, match);
  }
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Refuse a completed Checkout Session from a listed jurisdiction. Returns true
 * when it refused (the caller must then grant nothing for this session).
 *
 * Signals: the session's billing address; for a one-time payment, also the
 * card's issuing country.
 */
export async function refuseRestrictedCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const paymentIntentId = idOf(session.payment_intent);
  let match = checkoutSessionRestriction(session);
  if (!match && session.mode === 'payment' && paymentIntentId) {
    match = await paymentCardRestriction(stripe, paymentIntentId);
  }
  if (!match) return false;

  if (session.mode === 'subscription') {
    const subscriptionId = idOf(session.subscription);
    logRefusedFulfilment('subscription not granted; cancelling and refunding', match, {
      sessionId: session.id,
      subscriptionId,
    });
    if (subscriptionId) {
      await cancelRestrictedSubscription(stripe, subscriptionId, idOf(session.invoice), match);
    }
    return true;
  }

  logRefusedFulfilment('payment not fulfilled; refunding', match, { sessionId: session.id, paymentIntentId });
  if (paymentIntentId) await refundRestrictedPayment(stripe, paymentIntentId, match);
  return true;
}
