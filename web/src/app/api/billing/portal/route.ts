import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { requireStepUp } from '@/lib/auth/step-up';
import { STEP_UP_ROUTES } from '@/lib/auth/security-policy';
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

  // Step-up: the billing portal can cancel subscriptions and change payment
  // methods. Require a recent re-verification before opening it.
  const stepUp = await requireStepUp(STEP_UP_ROUTES['billing-portal'].config);
  if (!stepUp.ok) return stepUp.response;

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
