import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { logger } from '@/lib/logging/logger';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

const stripeSecret = process.env.STRIPE_SECRET_KEY;

/**
 * GET /api/billing/status
 * Get current billing status for the authenticated user.
 * Includes subscription status from Stripe when available.
 */
export async function GET() {
  try {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const user = authResult.ctx.user;
  const rl = await rateLimit(`user:billing-status:${user.id}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);
  const reqLog = logger.child({ endpoint: 'GET /api/billing/status', userId: user.id });

  // Calculate next refill date (30 days after billing cycle start)
  let nextRefillDate: string | null = null;
  if (user.billingCycleStart) {
    const nextRefill = new Date(user.billingCycleStart);
    nextRefill.setDate(nextRefill.getDate() + 30);
    nextRefillDate = nextRefill.toISOString();
  }

  // Fetch subscription status from Stripe if available
  let subscriptionStatus: string | null = null;
  if (stripeSecret && user.stripeSubscriptionId) {
    try {
      const stripe = new Stripe(stripeSecret, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      subscriptionStatus = subscription.status;
    } catch (err) {
      // Stripe unavailable or subscription not found — gracefully degrade
      reqLog.warn('Stripe subscription lookup failed', {
        subscriptionId: user.stripeSubscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    tier: user.tier,
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: user.stripeSubscriptionId,
    billingCycleStart: user.billingCycleStart?.toISOString() ?? null,
    nextRefillDate,
    subscriptionStatus,
  });
  } catch (err) {
    captureException(err, { route: '/api/billing/status' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
