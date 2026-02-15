import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { users, marketplaceAssets, assetPurchases, creditTransactions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
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

    if (asset.status !== 'published') {
      return NextResponse.json({ error: 'Asset not available' }, { status: 400 });
    }

    // Check if already purchased
    const [existing] = await db
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: 'Already purchased' }, { status: 400 });
    }

    // Check if user is trying to buy their own asset
    if (asset.sellerId === user.id) {
      return NextResponse.json({ error: 'Cannot purchase your own asset' }, { status: 400 });
    }

    const price = asset.priceTokens;

    // For free assets, just record purchase
    if (price === 0) {
      await db.insert(assetPurchases).values({
        buyerId: user.id,
        assetId,
        priceTokens: 0,
        license: asset.license,
      });

      // Increment download count
      await db
        .update(marketplaceAssets)
        .set({ downloadCount: asset.downloadCount + 1 })
        .where(eq(marketplaceAssets.id, assetId));

      return NextResponse.json({ success: true, downloadUrl: asset.assetFileUrl });
    }

    // Check user balance
    const totalBalance = user.monthlyTokens - user.monthlyTokensUsed + user.addonTokens + user.earnedCredits;
    if (totalBalance < price) {
      return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 });
    }

    // Deduct tokens (use earned credits first, then addon, then monthly)
    let remaining = price;
    let earnedUsed = 0;
    let addonUsed = 0;
    let monthlyUsed = 0;

    if (user.earnedCredits > 0) {
      earnedUsed = Math.min(remaining, user.earnedCredits);
      remaining -= earnedUsed;
    }

    if (remaining > 0 && user.addonTokens > 0) {
      addonUsed = Math.min(remaining, user.addonTokens);
      remaining -= addonUsed;
    }

    if (remaining > 0) {
      const availableMonthly = user.monthlyTokens - user.monthlyTokensUsed;
      monthlyUsed = Math.min(remaining, availableMonthly);
      remaining -= monthlyUsed;
    }

    if (remaining > 0) {
      return NextResponse.json({ error: 'Insufficient tokens' }, { status: 400 });
    }

    // 70% to seller, 30% platform fee
    const sellerEarnings = Math.floor(price * 0.7);

    // Get seller
    const [seller] = await db.select().from(users).where(eq(users.id, asset.sellerId)).limit(1);
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Update buyer balance
    await db
      .update(users)
      .set({
        earnedCredits: user.earnedCredits - earnedUsed,
        addonTokens: user.addonTokens - addonUsed,
        monthlyTokensUsed: user.monthlyTokensUsed + monthlyUsed,
      })
      .where(eq(users.id, user.id));

    // Update seller balance
    await db
      .update(users)
      .set({
        earnedCredits: seller.earnedCredits + sellerEarnings,
      })
      .where(eq(users.id, seller.id));

    // Record purchase
    await db.insert(assetPurchases).values({
      buyerId: user.id,
      assetId,
      priceTokens: price,
      license: asset.license,
    });

    // Increment download count
    await db
      .update(marketplaceAssets)
      .set({ downloadCount: asset.downloadCount + 1 })
      .where(eq(marketplaceAssets.id, assetId));

    // Record buyer transaction
    await db.insert(creditTransactions).values({
      userId: user.id,
      transactionType: 'deduction',
      amount: -price,
      balanceAfter: totalBalance - price,
      source: 'marketplace_purchase',
      referenceId: assetId,
    });

    // Record seller transaction
    await db.insert(creditTransactions).values({
      userId: seller.id,
      transactionType: 'earned',
      amount: sellerEarnings,
      balanceAfter: seller.earnedCredits + sellerEarnings,
      source: 'marketplace_sale',
      referenceId: assetId,
    });

    return NextResponse.json({
      success: true,
      downloadUrl: asset.assetFileUrl,
      tokensCharged: price,
      sellerEarnings,
    });
  } catch (error) {
    console.error('Error purchasing asset:', error);
    return NextResponse.json({ error: 'Failed to purchase asset' }, { status: 500 });
  }
}
