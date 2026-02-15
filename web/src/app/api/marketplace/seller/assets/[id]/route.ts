import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { users, marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const db = getDb();
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check ownership
    const [asset] = await db
      .select()
      .from(marketplaceAssets)
      .where(and(eq(marketplaceAssets.id, assetId), eq(marketplaceAssets.sellerId, user.id)))
      .limit(1);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const body = await req.json();
    const { name, description, priceTokens, license, tags, status } = body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (priceTokens !== undefined) updates.priceTokens = priceTokens;
    if (license !== undefined) updates.license = license;
    if (tags !== undefined) updates.tags = tags;
    if (status !== undefined) {
      updates.status = status;
      if (status === 'published') {
        updates.publishedAt = new Date();
      }
    }

    await db
      .update(marketplaceAssets)
      .set(updates)
      .where(eq(marketplaceAssets.id, assetId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating asset:', error);
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 });
  }
}
