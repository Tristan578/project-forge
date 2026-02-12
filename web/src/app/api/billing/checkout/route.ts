import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

const PRICE_IDS: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  creator: process.env.STRIPE_PRICE_CREATOR,
  studio: process.env.STRIPE_PRICE_STUDIO,
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for a subscription upgrade.
 * Body: { tier: 'starter' | 'creator' | 'studio' }
 */
export async function POST(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const body = await req.json();
  const { tier } = body;

  if (!tier || !['starter', 'creator', 'studio'].includes(tier)) {
    return NextResponse.json(
      { error: 'Invalid tier. Choose: starter, creator, or studio' },
      { status: 400 }
    );
  }

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return NextResponse.json(
      { error: 'Stripe price not configured for this tier' },
      { status: 500 }
    );
  }

  const user = authResult.ctx.user;
  const db = getDb();

  // Create or retrieve Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        userId: user.id,
        clerkId: authResult.ctx.clerkId,
      },
    });
    customerId = customer.id;

    // Save customer ID to database
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
  }

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      userId: user.id,
      tier,
    },
    success_url: `${APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${APP_URL}/pricing`,
  });

  return NextResponse.json({ url: session.url });
}
