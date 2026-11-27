import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { requireStepUp } from '@/lib/auth/step-up';
import { STEP_UP_ROUTES } from '@/lib/auth/security-policy';
import { captureException } from '@/lib/monitoring/sentry-server';
import { getStripe } from '@/lib/billing/stripe-client';
import { buildPortalSessionParams, isCancelFlow } from '@/lib/billing/portal-config';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { sanctionsPurchaseBlock } from '@/lib/security/sanctionsGeoBlock';

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
async function POST_impl(req: NextRequest) {
  // Sanctions (#9331): the portal can switch plans (an upgrade is a sale), so
  // a customer whose location is known to be in a listed jurisdiction is
  // refused it. The cancel flow (`?flow=cancel`) stays open to everyone, so an
  // existing customer can always cancel; it is checked again below once we
  // know the deep link will really be applied.
  const flow = req.nextUrl.searchParams.get('flow');
  const geoBlocked = sanctionsPurchaseBlock(req);
  if (geoBlocked && !isCancelFlow(flow)) return geoBlocked;

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

  // Without a subscription id the cancel deep link is dropped and the portal
  // opens on its home page, where plans can be switched: refuse that too.
  if (geoBlocked && !user.stripeSubscriptionId?.trim()) return geoBlocked;

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
    return redactedJson({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
