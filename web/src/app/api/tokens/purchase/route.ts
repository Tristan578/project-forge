import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import type { TokenPackage } from '@/lib/tokens/pricing';
import { TOKEN_PACKAGES } from '@/lib/tokens/pricing';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';
import { getStripe } from '@/lib/billing/stripe-client';

const purchaseSchema = z.object({
  package: z.enum(['spark', 'blaze', 'inferno']),
});

const PACKAGE_PRICE_IDS: Record<string, string | undefined> = {
  spark: process.env.STRIPE_PRICE_TOKEN_SPARK,
  blaze: process.env.STRIPE_PRICE_TOKEN_BLAZE,
  inferno: process.env.STRIPE_PRICE_TOKEN_INFERNO,
};

export async function POST(req: NextRequest) {
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
      customer: user.stripeCustomerId ?? undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        userId: user.id,
        package: pkg,
        tokens: pkgInfo.tokens.toString(),
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
