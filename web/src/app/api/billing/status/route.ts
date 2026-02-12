import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';

/**
 * GET /api/billing/status
 * Get current billing status for the authenticated user.
 */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const user = authResult.ctx.user;

  // Calculate next refill date (30 days after billing cycle start)
  let nextRefillDate: string | null = null;
  if (user.billingCycleStart) {
    const nextRefill = new Date(user.billingCycleStart);
    nextRefill.setDate(nextRefill.getDate() + 30);
    nextRefillDate = nextRefill.toISOString();
  }

  return NextResponse.json({
    tier: user.tier,
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: user.stripeSubscriptionId,
    billingCycleStart: user.billingCycleStart?.toISOString() ?? null,
    nextRefillDate,
  });
}
