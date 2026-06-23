import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getStripe } from '@/lib/billing/stripe-client';
import { buildPortalSessionParams } from '@/lib/billing/portal-config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for managing subscriptions.
 *
 * Plan switching across the 4 tiers, payment-method update, and the cancellation
 * retention coupon are all governed by the Stripe portal configuration (managed
 * in the Dashboard, or pinned via STRIPE_PORTAL_CONFIGURATION_ID). The optional
 * `?flow=cancel` query param deep-links the customer straight into the
 * cancellation/retention flow. See `buildPortalSessionParams`.
 */
export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `billing-portal:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const user = mid.authContext!.user;

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No Stripe customer found. Please subscribe to a plan first.' },
      { status: 400 }
    );
  }

  const flow = req.nextUrl.searchParams.get('flow');

  try {
    const session = await getStripe().billingPortal.sessions.create(
      buildPortalSessionParams({
        customer: user.stripeCustomerId,
        returnUrl: `${APP_URL}/dashboard`,
        flow,
        subscriptionId: user.stripeSubscriptionId,
      })
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    captureException(error, { route: '/api/billing/portal' });
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}
