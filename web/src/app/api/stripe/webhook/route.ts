/**
 * POST /api/stripe/webhook — Stripe webhook handler.
 *
 * Verifies Stripe signature, processes subscription lifecycle events
 * (checkout completed, subscription updated/deleted, invoice paid/failed),
 * and syncs billing state to the database. Uses event-level idempotency
 * via claimEvent() — safe to replay on webhook redelivery.
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { creditAddonTokens } from '@/lib/tokens/service';
import { updateUserStripe } from '@/lib/auth/user-service';
import type { TokenPackage } from '@/lib/tokens/pricing';
import {
  claimEvent,
  releaseEvent,
  finalizeEvent,
} from '@/lib/billing/webhookIdempotency';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleChargeRefunded,
} from '@/lib/billing/subscription-lifecycle';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getStripe } from '@/lib/billing/stripe-client';

// Map Stripe price IDs to tiers
function tierFromPriceId(priceId: string): Tier | null {
  const map: Record<string, Tier> = {
    [process.env.STRIPE_PRICE_STARTER ?? '']: 'hobbyist',
    [process.env.STRIPE_PRICE_CREATOR ?? '']: 'creator',
    [process.env.STRIPE_PRICE_STUDIO ?? '']: 'pro',
  };
  return map[priceId] ?? null;
}

/** Extract Stripe customer ID string from a customer field (string or object). */
function resolveCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook secret not configured' }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency: atomically claim the event so only one concurrent
  // delivery processes it. If claimEvent returns false, another request
  // already owns this event ID.
  if (!(await claimEvent(event.id, 'stripe'))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await processEvent(event);
  } catch (err) {
    // Processing failed — release the claim so Stripe can redeliver.
    // If releaseEvent itself fails, the short in-flight TTL (5 min)
    // will auto-expire the claim, allowing Stripe to retry.
    try {
      await releaseEvent(event.id, 'stripe');
    } catch (releaseErr) {
      console.error(`[stripe-webhook] Failed to release claim for ${event.id}:`, releaseErr);
    }
    captureException(err, { route: '/api/stripe/webhook', eventType: event.type, eventId: event.id });
    console.error(`[stripe-webhook] Error processing ${event.type} (${event.id}):`, err);
    // Return 500 so Stripe retries the webhook delivery.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  // Processing succeeded — extend the claim TTL to the full 72h window
  // so this event is considered "processed" and duplicates are rejected.
  // If finalization fails, do NOT release the claim: the event was already
  // processed, and releasing would allow duplicate processing on redeliver.
  try {
    await finalizeEvent(event.id);
  } catch (err) {
    console.error(`[stripe-webhook] Failed to finalize claim for ${event.id}:`, err);
    captureException(err, { route: '/api/stripe/webhook', eventType: event.type, eventId: event.id, phase: 'finalize' });
  }

  return NextResponse.json({ received: true });
}

async function processEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // -----------------------------------------------------------
    // New subscription created
    // -----------------------------------------------------------
    case 'customer.subscription.created': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = resolveCustomerId(subscription.customer);
      if (!customerId) break;

      const priceId = subscription.items.data[0]?.price?.id;
      const tier = priceId ? tierFromPriceId(priceId) : null;
      if (!tier) break;

      await handleSubscriptionCreated(customerId, subscription.id, tier);
      try { const { trackSubscriptionStarted } = await import('@/lib/analytics/events.server'); await trackSubscriptionStarted(tier); } catch { /* analytics non-critical */ }
      break;
    }

    // -----------------------------------------------------------
    // Subscription updated (tier change, status change, etc.)
    // -----------------------------------------------------------
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = resolveCustomerId(subscription.customer);
      if (!customerId) break;

      const priceId = subscription.items.data[0]?.price?.id;
      const tier = priceId ? tierFromPriceId(priceId) : null;
      if (!tier) break;

      await handleSubscriptionUpdated(
        customerId,
        subscription.id,
        tier,
        subscription.status
      );
      break;
    }

    // -----------------------------------------------------------
    // Subscription cancelled / deleted
    // -----------------------------------------------------------
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = resolveCustomerId(subscription.customer);
      if (!customerId) break;

      await handleSubscriptionDeleted(customerId, subscription.id);
      break;
    }

    // -----------------------------------------------------------
    // Invoice paid -- monthly renewal token grant
    // -----------------------------------------------------------
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = resolveCustomerId(invoice.customer);
      if (!customerId) break;

      // v22 (dahlia) nests subscription under invoice.parent; pre-dahlia uses top-level invoice.subscription.
      // Keep both reads until Dashboard webhook endpoint is confirmed on 2026-03-25.dahlia.
      const subField = invoice.parent?.subscription_details?.subscription
        ?? (invoice as unknown as { subscription?: string | { id: string } | null }).subscription
        ?? null;
      const subscriptionId =
        typeof subField === 'string'
          ? subField
          : (subField && typeof subField === 'object' && 'id' in subField) ? subField.id : null;

      await handleInvoicePaid(customerId, invoice.id, subscriptionId);
      break;
    }

    // -----------------------------------------------------------
    // Invoice payment failed -- grace period handling
    // -----------------------------------------------------------
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = resolveCustomerId(invoice.customer);
      if (!customerId) break;

      const attemptCount = invoice.attempt_count ?? 1;
      const nextAttempt = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null;

      await handleInvoicePaymentFailed(
        customerId,
        invoice.id,
        attemptCount,
        nextAttempt
      );
      break;
    }

    // -----------------------------------------------------------
    // Charge refunded — reverse addon token credits (PF-480)
    // -----------------------------------------------------------
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const customerId = resolveCustomerId(charge.customer);
      if (!customerId) break;

      const paymentIntentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id ?? null;

      await handleChargeRefunded(
        customerId,
        charge.id,
        charge.amount_refunded,
        charge.amount,
        paymentIntentId
      );
      break;
    }

    // -----------------------------------------------------------
    // One-time payment completed (token add-on purchase)
    // -----------------------------------------------------------
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'payment') break;

      const userId = session.metadata?.userId;
      const pkg = session.metadata?.package as TokenPackage | undefined;
      const paymentIntent =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;

      if (userId && pkg && paymentIntent) {
        await creditAddonTokens(userId, pkg, paymentIntent);

        // Save Stripe customer ID if not already stored
        if (session.customer) {
          const stripeCustomerId = resolveCustomerId(session.customer);
          if (stripeCustomerId) {
            const [user] = await queryWithResilience(() => getDb()
              .select({ id: users.id, stripeCustomerId: users.stripeCustomerId })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1));

            if (user && !user.stripeCustomerId) {
              await updateUserStripe(userId, stripeCustomerId);
            }
          }
        }
      }
      break;
    }
  }
}
