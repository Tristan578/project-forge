import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { creditAddonTokens } from '@/lib/tokens/service';
import { updateUserStripe } from '@/lib/auth/user-service';
import type { TokenPackage } from '@/lib/tokens/pricing';
import {
  isEventProcessed,
  markEventProcessed,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/lib/billing/subscription-lifecycle';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
}

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

  // Idempotency: skip duplicate webhook deliveries
  if (isEventProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await processEvent(event);
  } catch (err) {
    // Log but still return 200 to Stripe to prevent infinite retries on
    // application errors. The error is logged for manual investigation.
    console.error(`[stripe-webhook] Error processing ${event.type} (${event.id}):`, err);
  }

  markEventProcessed(event.id);
  return NextResponse.json({ received: true });
}

async function processEvent(event: Stripe.Event): Promise<void> {
  const db = getDb();

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

      const subField = invoice.parent?.subscription_details?.subscription ?? null;
      const subscriptionId =
        typeof subField === 'string'
          ? subField
          : subField?.id ?? null;

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
            const [user] = await db
              .select({ id: users.id, stripeCustomerId: users.stripeCustomerId })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1);

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
