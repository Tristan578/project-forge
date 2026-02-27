import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { users, marketplaceAssets, assetPurchases } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const db = getDb();
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get asset
    const [asset] = await db
      .select()
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.id, assetId))
      .limit(1);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Check if user purchased it or owns it
    const [purchase] = await db
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1);

    const isOwner = asset.sellerId === user.id;

    if (!purchase && !isOwner) {
      return NextResponse.json({ error: 'Not authorized to download' }, { status: 403 });
    }

    if (!asset.assetFileUrl) {
      return NextResponse.json({ error: 'No file available' }, { status: 404 });
    }

    // Validate URL against allowed domains to prevent open redirect
    const allowedHosts = (process.env.ASSET_CDN_HOSTS || 'localhost').split(',').map(h => h.trim());
    try {
      const fileUrl = new URL(asset.assetFileUrl);
      if (!allowedHosts.some(host => fileUrl.hostname === host || fileUrl.hostname.endsWith(`.${host}`))) {
        console.error(`Blocked redirect to disallowed host: ${fileUrl.hostname}`);
        return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
    }

    return NextResponse.redirect(asset.assetFileUrl);
  } catch (error) {
    console.error('Error downloading asset:', error);
    return NextResponse.json({ error: 'Failed to download asset' }, { status: 500 });
  }
}
