import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { creditAddonTokens, resetMonthlyTokens } from '@/lib/tokens/service';
import { updateUserStripe, updateUserTier } from '@/lib/auth/user-service';
import type { TokenPackage } from '@/lib/tokens/pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });

// Map Stripe price IDs to tiers
function tierFromPriceId(priceId: string): Tier | null {
  const map: Record<string, Tier> = {
    [process.env.STRIPE_PRICE_STARTER ?? '']: 'hobbyist',
    [process.env.STRIPE_PRICE_CREATOR ?? '']: 'creator',
    [process.env.STRIPE_PRICE_STUDIO ?? '']: 'pro',
  };
  return map[priceId] ?? null;
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
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = getDb();

  switch (event.type) {
    // New subscription created
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
      const priceId = subscription.items.data[0]?.price?.id;
      const tier = priceId ? tierFromPriceId(priceId) : null;

      // Find user by Stripe customer ID
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.stripeCustomerId, customerId))
        .limit(1);

      if (user && tier) {
        await updateUserTier(user.id, tier);
        await db
          .update(users)
          .set({ stripeSubscriptionId: subscription.id, updatedAt: new Date() })
          .where(eq(users.id, user.id));

        // Reset monthly tokens on subscription change
        await resetMonthlyTokens(user.id, tier);
      }
      break;
    }

    // Subscription cancelled
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.stripeCustomerId, customerId))
        .limit(1);

      if (user) {
        await updateUserTier(user.id, 'starter');
        await db
          .update(users)
          .set({
            stripeSubscriptionId: null,
            monthlyTokens: 0,
            monthlyTokensUsed: 0,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }
      break;
    }

    // Invoice paid — monthly renewal
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customerId) break;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.stripeCustomerId, customerId))
        .limit(1);

      if (user) {
        await resetMonthlyTokens(
          user.id,
          user.tier as 'starter' | 'hobbyist' | 'creator' | 'pro'
        );
      }
      break;
    }

    // One-time payment completed (token purchase)
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
          const stripeCustomerId =
            typeof session.customer === 'string' ? session.customer : session.customer.id;
          await updateUserStripe(userId, stripeCustomerId);
        }
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
