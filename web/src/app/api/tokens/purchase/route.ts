import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import type { TokenPackage } from '@/lib/tokens/pricing';
import { TOKEN_PACKAGES } from '@/lib/tokens/pricing';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';
import { getStripe } from '@/lib/billing/stripe-client';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { sanctionsPurchaseBlock } from '@/lib/security/sanctionsGeoBlock';

const purchaseSchema = z.object({
  package: z.enum(['spark', 'blaze', 'inferno']),
});

const PACKAGE_PRICE_IDS: Record<string, string | undefined> = {
  spark: process.env.STRIPE_PRICE_TOKEN_SPARK,
  blaze: process.env.STRIPE_PRICE_TOKEN_BLAZE,
  inferno: process.env.STRIPE_PRICE_TOKEN_INFERNO,
};

async function POST_impl(req: NextRequest) {
  // Sanctions (#9331): no sale to a buyer whose location is known to be in a
  // listed jurisdiction. An unknown location is not refused here: Checkout
  // collects the billing address and the webhook refunds a listed one.
  const geoBlocked = sanctionsPurchaseBlock(req);
  if (geoBlocked) return geoBlocked;

  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `tokens-purchase:${id}`, max: 5, windowSeconds: 60 },
    validate: purchaseSchema,
  });
  if (mid.error) return mid.error;

  // Only paid tiers can buy tokens
  const tierCheck = assertTier(mid.authContext!.user, ['hobbyist', 'creator', 'pro']);
  if (tierCheck) return tierCheck;

  const { package: pkg } = mid.body as z.infer<typeof purchaseSchema>;

  const priceId = PACKAGE_PRICE_IDS[pkg];
  if (!priceId) {
    return internalError('Stripe price not configured for this package');
  }

  try {
    const user = mid.authContext!.user;
    const pkgInfo = TOKEN_PACKAGES[pkg as TokenPackage];

    // Create Stripe Checkout session for one-time payment
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      // Stripe's SessionCreateParams doesn't accept an explicit `undefined`
      // for these under exactOptionalPropertyTypes; conditional spread keeps
      // exactly one of the two set, matching the prior ??/ternary behavior.
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email }),
      line_items: [{ price: priceId, quantity: 1 }],
      // Sanctions (#9331): always collect the billing address so the webhook
      // can refund, instead of credit, a buyer in a listed jurisdiction. Saved
      // onto an existing customer too (`customer_update` needs `customer`).
      billing_address_collection: 'required',
      ...(user.stripeCustomerId ? { customer_update: { address: 'auto' as const } } : {}),
      metadata: {
        userId: user.id,
        package: pkg,
        tokens: pkgInfo.tokens.toString(),
      },
      // Propagate the token-pack identity onto the PaymentIntent so the Radar
      // fraud-review handler (PF-913) can recover userId + package from
      // `review.payment_intent` when releasing a held grant — the Review object
      // does not carry the checkout session's metadata.
      payment_intent_data: {
        metadata: {
          userId: user.id,
          package: pkg,
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}?purchase=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}?purchase=cancelled`,
    });

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (error) {
    captureException(error, { route: '/api/tokens/purchase' });
    return internalError('Failed to create checkout session');
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
