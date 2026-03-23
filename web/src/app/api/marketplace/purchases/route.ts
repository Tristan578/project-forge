import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { assetPurchases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const rl = await rateLimit(`user:marketplace-purchases:${user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const db = getDb();

    const purchases = await db
      .select({ assetId: assetPurchases.assetId })
      .from(assetPurchases)
      .where(eq(assetPurchases.buyerId, user.id));

    return NextResponse.json({ assetIds: purchases.map((p) => p.assetId) });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    captureException(error, { route: '/api/marketplace/purchases' });
    return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 });
  }
}
