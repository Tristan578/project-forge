import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logging/logger';
import { captureException } from '@/lib/monitoring/sentry-server';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
}

const PRICE_IDS: Record<string, string | undefined> = {
  hobbyist: process.env.STRIPE_PRICE_STARTER,
  creator: process.env.STRIPE_PRICE_CREATOR,
  pro: process.env.STRIPE_PRICE_STUDIO,
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for a subscription upgrade.
 * Body: { tier: 'hobbyist' | 'creator' | 'pro' }
 */
export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `billing-checkout:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const user = mid.authContext!.user;
  const reqLog = logger.child({ endpoint: 'POST /api/billing/checkout', userId: user.id });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { tier } = body as { tier?: string };

  if (!tier || !['hobbyist', 'creator', 'pro'].includes(tier)) {
    return NextResponse.json(
      { error: 'Invalid tier. Choose: hobbyist, creator, or pro' },
      { status: 400 }
    );
  }

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    reqLog.error('Stripe price not configured', { tier });
    return NextResponse.json(
      { error: 'Stripe price not configured for this tier' },
      { status: 500 }
    );
  }

  try {
    const db = getDb();

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
          clerkId: mid.authContext!.clerkId,
        },
      });
      customerId = customer.id;

      // Save customer ID to database
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
      reqLog.info('Stripe customer created', { customerId });
    }

    // Create Stripe Checkout session
    const session = await getStripe().checkout.sessions.create({
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

    reqLog.info('Checkout session created', { tier, sessionId: session.id });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    captureException(error, { route: '/api/billing/checkout' });
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
