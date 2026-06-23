/**
 * POST /api/billing/checkout — create a Stripe Checkout session for subscription upgrade.
 *
 * Requires authentication. Rate-limited. Returns a Stripe Checkout URL.
 * The subscription is activated via the stripe/webhook handler on successful payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logging/logger';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';
import { getStripe } from '@/lib/billing/stripe-client';
import { isStripeTaxEnabled } from '@/lib/billing/stripe-tax';
import type Stripe from 'stripe';

const checkoutSchema = z.object({
  tier: z.enum(['hobbyist', 'creator', 'pro']),
});

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
    validate: checkoutSchema,
  });
  if (mid.error) return mid.error;

  const user = mid.authContext!.user;
  const reqLog = logger.child({ endpoint: 'POST /api/billing/checkout', userId: user.id });

  const { tier } = mid.body as z.infer<typeof checkoutSchema>;

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    reqLog.error('Stripe price not configured', { tier });
    return internalError('Stripe price not configured for this tier');
  }

  try {
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
      await queryWithResilience(() => getDb().update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id)));
      reqLog.info('Stripe customer created', { customerId });
    }

    // Create Stripe Checkout session.
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        userId: user.id,
        tier,
      },
      success_url: `${APP_URL}/dashboard?upgraded=true`,
      cancel_url: `${APP_URL}/pricing`,
    };

    // Stripe Tax (S2 compliance, PF-912): when enabled in the dashboard, collect
    // the customer's billing address so Checkout can compute and apply tax. Guarded
    // by STRIPE_TAX_ENABLED so the route no-ops safely when Stripe Tax is not yet
    // provisioned — turning automatic_tax on without registrations would make the
    // session.create call throw. Tax is reflected in the integer-cent amount_total /
    // charge.amount fields, which the webhook already reconciles unchanged.
    if (isStripeTaxEnabled()) {
      sessionParams.automatic_tax = { enabled: true };
      // automatic_tax requires a billing address. For an existing/saved customer,
      // Stripe also requires customer_update.address so the collected address is
      // persisted back onto the customer (otherwise session.create rejects).
      sessionParams.billing_address_collection = 'required';
      sessionParams.customer_update = { address: 'auto' };
      // Let customers self-report a VAT/GST/tax ID for B2B reverse-charge handling.
      sessionParams.tax_id_collection = { enabled: true };
    }

    const session = await getStripe().checkout.sessions.create(sessionParams);

    reqLog.info('Checkout session created', { tier, sessionId: session.id });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    captureException(error, { route: '/api/billing/checkout' });
    return internalError('Failed to create checkout session');
  }
}
