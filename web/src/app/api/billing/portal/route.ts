import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { authenticateRequest } from '@/lib/auth/api-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for managing subscriptions.
 */
export async function POST() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const user = authResult.ctx.user;

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: 'No Stripe customer found. Please subscribe to a plan first.' },
      { status: 400 }
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${APP_URL}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}
