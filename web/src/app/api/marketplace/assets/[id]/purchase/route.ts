import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { users, marketplaceAssets, assetPurchases, creditTransactions } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { validationError, conflict, forbidden, paymentRequired, internalError } from '@/lib/api/errors';

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user, clerkId } = authResult.ctx;

    const db = getDb();

    // Rate limit: 10 purchase requests per minute per user
    const rl = await rateLimit(`purchase:${clerkId}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

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
      return validationError('Asset not available');
    }

    // Check if already purchased
    const [existing] = await db
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1);

    if (existing) {
      return conflict('Already purchased');
    }

    // Check if user is trying to buy their own asset
    if (asset.sellerId === user.id) {
      return forbidden('Cannot purchase your own asset');
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

      // Increment download count atomically to avoid lost updates under
      // concurrent free-asset purchases (PF-111).
      await db
        .update(marketplaceAssets)
        .set({ downloadCount: sql`${marketplaceAssets.downloadCount} + 1` })
        .where(eq(marketplaceAssets.id, assetId));

      return NextResponse.json({ success: true, downloadUrl: asset.assetFileUrl });
    }

    // Check user balance
    const totalBalance = user.monthlyTokens - user.monthlyTokensUsed + user.addonTokens + user.earnedCredits;
    if (totalBalance < price) {
      return paymentRequired('Insufficient tokens');
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
      return paymentRequired('Insufficient tokens');
    }

    // 70% to seller, 30% platform fee
    const sellerEarnings = Math.floor(price * 0.7);

    // Get seller
    const [seller] = await db.select().from(users).where(eq(users.id, asset.sellerId)).limit(1);
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Update buyer balance atomically — WHERE guards prevent race conditions
    const updateResult = await db
      .update(users)
      .set({
        earnedCredits: sql`${users.earnedCredits} - ${earnedUsed}`,
        addonTokens: sql`${users.addonTokens} - ${addonUsed}`,
        monthlyTokensUsed: sql`${users.monthlyTokensUsed} + ${monthlyUsed}`,
      })
      .where(and(
        eq(users.id, user.id),
        sql`${users.earnedCredits} >= ${earnedUsed}`,
        sql`${users.addonTokens} >= ${addonUsed}`,
        sql`(${users.monthlyTokens} - ${users.monthlyTokensUsed}) >= ${monthlyUsed}`,
      ))
      .returning({ id: users.id });

    if (updateResult.length === 0) {
      return NextResponse.json({ error: 'Balance changed, please retry' }, { status: 409 });
    }

    // Update seller balance atomically — use SQL expression to avoid lost
    // updates under concurrent purchases (PF-974). RETURNING gives us the
    // actual post-update balance for the audit log, not a stale in-memory value.
    const [sellerUpdate] = await db
      .update(users)
      .set({
        earnedCredits: sql`${users.earnedCredits} + ${sellerEarnings}`,
      })
      .where(eq(users.id, seller.id))
      .returning({ earnedCredits: users.earnedCredits });

    // Read buyer's actual post-deduction balance from DB for accurate audit log.
    const [buyerBalance] = await db
      .select({
        earnedCredits: users.earnedCredits,
        addonTokens: users.addonTokens,
        monthlyTokens: users.monthlyTokens,
        monthlyTokensUsed: users.monthlyTokensUsed,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const buyerBalanceAfter = buyerBalance
      ? buyerBalance.earnedCredits + buyerBalance.addonTokens + (buyerBalance.monthlyTokens - buyerBalance.monthlyTokensUsed)
      : totalBalance - price;

    // Record purchase
    await db.insert(assetPurchases).values({
      buyerId: user.id,
      assetId,
      priceTokens: price,
      license: asset.license,
    });

    // Increment download count atomically
    await db
      .update(marketplaceAssets)
      .set({ downloadCount: sql`${marketplaceAssets.downloadCount} + 1` })
      .where(eq(marketplaceAssets.id, assetId));

    // Record buyer transaction with actual post-update balance
    await db.insert(creditTransactions).values({
      userId: user.id,
      transactionType: 'deduction',
      amount: -price,
      balanceAfter: buyerBalanceAfter,
      source: 'marketplace_purchase',
      referenceId: assetId,
    });

    // Record seller transaction with actual post-update balance from RETURNING
    await db.insert(creditTransactions).values({
      userId: seller.id,
      transactionType: 'earned',
      amount: sellerEarnings,
      balanceAfter: sellerUpdate?.earnedCredits ?? (seller.earnedCredits + sellerEarnings),
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
    captureException(error, { route: '/api/marketplace/assets/[id]/purchase' });
    console.error('Error purchasing asset:', error);
    return internalError('Failed to purchase asset');
  }
}
