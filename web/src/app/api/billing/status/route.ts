import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { logger } from '@/lib/logging/logger';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getStripe } from '@/lib/billing/stripe-client';

/**
 * GET /api/billing/status
 * Get current billing status for the authenticated user.
 * Includes subscription status from Stripe when available.
 */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `billing-status:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const user = mid.authContext!.user;
  const reqLog = logger.child({ endpoint: 'GET /api/billing/status', userId: user.id });

  try {
    // Calculate next refill date (30 days after billing cycle start)
    let nextRefillDate: string | null = null;
    if (user.billingCycleStart) {
      const nextRefill = new Date(user.billingCycleStart);
      nextRefill.setDate(nextRefill.getDate() + 30);
      nextRefillDate = nextRefill.toISOString();
    }

    // Fetch subscription status from Stripe if available
    let subscriptionStatus: string | null = null;
    if (process.env.STRIPE_SECRET_KEY && user.stripeSubscriptionId) {
      try {
        const subscription = await getStripe().subscriptions.retrieve(user.stripeSubscriptionId);
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
      // Echo the persisted active entitlement feature set (PF-911 / #8821) so the
      // client can sync it alongside `tier` in fetchBillingStatus. Without this,
      // a downgrade (webhook nullifies active_features + drops tier) updates the
      // store's tier but leaves a STALE non-empty activeFeatures array, which
      // hasCapability prioritizes over the tier fallback — keeping paid
      // capabilities live until a full profile refresh (#8831).
      activeFeatures: user.activeFeatures ?? null,
    });
  } catch (error) {
    captureException(error, { route: '/api/billing/status', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
