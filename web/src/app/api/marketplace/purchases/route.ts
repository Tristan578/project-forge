import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { assetPurchases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:marketplace-purchases:${id}`, max: 30, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const purchases = await queryWithResilience(() => getDb()
      .select({ assetId: assetPurchases.assetId })
      .from(assetPurchases)
      .where(eq(assetPurchases.buyerId, user.id)));

    return NextResponse.json({ assetIds: purchases.map((p) => p.assetId) });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    captureException(error, { route: '/api/marketplace/purchases' });
    return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 });
  }
}
