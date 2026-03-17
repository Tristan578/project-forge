import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for managing subscriptions.
 */
export async function POST() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 5 portal requests per minute per user
  const rl = await rateLimit(`billing-portal:${authResult.ctx.user.id}`, 5, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const user = authResult.ctx.user;

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No Stripe customer found. Please subscribe to a plan first.' },
      { status: 400 }
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${APP_URL}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}
