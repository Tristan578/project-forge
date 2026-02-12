import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import type { TokenPackage } from '@/lib/tokens/pricing';
import { TOKEN_PACKAGES } from '@/lib/tokens/pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });

const PACKAGE_PRICE_IDS: Record<string, string | undefined> = {
  spark: process.env.STRIPE_PRICE_TOKEN_SPARK,
  blaze: process.env.STRIPE_PRICE_TOKEN_BLAZE,
  inferno: process.env.STRIPE_PRICE_TOKEN_INFERNO,
};

export async function POST(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Only paid tiers can buy tokens
  const tierCheck = assertTier(authResult.ctx.user, ['starter', 'creator', 'studio']);
  if (tierCheck) return tierCheck;

  const body = await req.json();
  const pkg = body.package as string;

  if (!pkg || !(pkg in TOKEN_PACKAGES)) {
    return NextResponse.json(
      { error: 'Invalid package. Choose: spark, blaze, or inferno' },
      { status: 400 }
    );
  }

  const priceId = PACKAGE_PRICE_IDS[pkg];
  if (!priceId) {
    return NextResponse.json(
      { error: 'Stripe price not configured for this package' },
      { status: 500 }
    );
  }

  const user = authResult.ctx.user;
  const pkgInfo = TOKEN_PACKAGES[pkg as TokenPackage];

  // Create Stripe Checkout session for one-time payment
  const session = await stripe.checkout.sessions.create({
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
}
