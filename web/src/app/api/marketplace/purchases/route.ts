import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { assetPurchases } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const db = getDb();

    const purchases = await db
      .select({ assetId: assetPurchases.assetId })
      .from(assetPurchases)
      .where(eq(assetPurchases.buyerId, user.id));

    return NextResponse.json({ assetIds: purchases.map((p) => p.assetId) });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 });
  }
}
