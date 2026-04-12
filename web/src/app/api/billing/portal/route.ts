import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getStripe } from '@/lib/billing/stripe-client';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for managing subscriptions.
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

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${APP_URL}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    captureException(error, { route: '/api/billing/portal' });
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}
