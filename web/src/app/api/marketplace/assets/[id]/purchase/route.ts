import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users, marketplaceAssets, assetPurchases, creditTransactions } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';
import { validationError, conflict, forbidden, paymentRequired, internalError } from '@/lib/api/errors';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `purchase:${id}`, max: 10, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    // Get asset
    const [asset] = await queryWithResilience(() => getDb()
      .select()
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.id, assetId))
      .limit(1));

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (asset.status !== 'published') {
      return validationError('Asset not available');
    }

    // Check if already purchased
    const [existing] = await queryWithResilience(() => getDb()
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1));

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
      const inserted = await queryWithResilience(() => getDb().insert(assetPurchases).values({
        buyerId: user.id,
        assetId,
        priceTokens: 0,
        license: asset.license,
      }).onConflictDoNothing().returning({ id: assetPurchases.id }));

      // Only increment download count when a new purchase row was actually
      // inserted. On retry (conflict → no insert), skip to avoid double-counting.
      if (inserted.length > 0) {
        await queryWithResilience(() => getDb()
          .update(marketplaceAssets)
          .set({ downloadCount: sql`${marketplaceAssets.downloadCount} + 1` })
          .where(eq(marketplaceAssets.id, assetId)));
      }

      return NextResponse.json({ success: true, downloadUrl: asset.assetFileUrl });
    }

    // Check user balance
    const totalBalance = user.monthlyTokens - user.monthlyTokensUsed + user.addonTokens + user.earnedCredits;
    if (totalBalance < price) {
      return paymentRequired('Insufficient tokens');
    }

    // IDEMPOTENCY GATE: Insert purchase row FIRST. If a concurrent request
    // already inserted, onConflictDoNothing returns empty → abort before
    // touching any balances. This prevents the double-charge race condition
    // where two requests both pass the `existing` check, both mutate balances,
    // but only one purchase row is actually created.
    const purchaseInserted = await queryWithResilience(() => getDb().insert(assetPurchases).values({
      buyerId: user.id,
      assetId,
      priceTokens: price,
      license: asset.license,
    }).onConflictDoNothing().returning({ id: assetPurchases.id }));

    if (purchaseInserted.length === 0) {
      // Conflict — but was the buyer actually charged? If the INSERT committed
      // on a previous attempt but the HTTP response was lost (neon-http retry),
      // the purchase row exists but balance mutations never ran. Check for the
      // deduction credit_transaction to distinguish "fully completed" from
      // "orphan row from lost-ack retry" (Copilot review finding).
      const [existingTxn] = await queryWithResilience(() => getDb()
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(and(
          eq(creditTransactions.userId, user.id),
          eq(creditTransactions.source, 'marketplace_purchase'),
          eq(creditTransactions.referenceId, assetId),
        ))
        .limit(1));

      if (existingTxn) {
        // Fully completed — buyer was already charged
        return conflict('Already purchased');
      }
      // Orphan purchase row — fall through to charge the buyer
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
    const [seller] = await queryWithResilience(() => getDb().select().from(users).where(eq(users.id, asset.sellerId)).limit(1));
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Update buyer balance atomically — WHERE guards prevent race conditions
    const updateResult = await queryWithResilience(() => getDb()
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
      .returning({ id: users.id }));

    if (updateResult.length === 0) {
      // Balance changed after purchase insert — roll back the purchase row so
      // user can retry. Without this delete, the idempotency gate permanently
      // blocks the user from completing the purchase (Sentry HIGH severity).
      await queryWithResilience(() => getDb()
        .delete(assetPurchases)
        .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId))));
      return NextResponse.json({ error: 'Balance changed, please retry' }, { status: 409 });
    }

    // Update seller balance atomically — use SQL expression to avoid lost
    // updates under concurrent purchases (PF-974). RETURNING gives us the
    // actual post-update balance for the audit log, not a stale in-memory value.
    const [sellerUpdate] = await queryWithResilience(() => getDb()
      .update(users)
      .set({
        earnedCredits: sql`${users.earnedCredits} + ${sellerEarnings}`,
      })
      .where(eq(users.id, seller.id))
      .returning({ earnedCredits: users.earnedCredits }));

    // Read buyer's actual post-deduction balance from DB for accurate audit log.
    const [buyerBalance] = await queryWithResilience(() => getDb()
      .select({
        earnedCredits: users.earnedCredits,
        addonTokens: users.addonTokens,
        monthlyTokens: users.monthlyTokens,
        monthlyTokensUsed: users.monthlyTokensUsed,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1));
    const buyerBalanceAfter = buyerBalance
      ? buyerBalance.earnedCredits + buyerBalance.addonTokens + (buyerBalance.monthlyTokens - buyerBalance.monthlyTokensUsed)
      : totalBalance - price;

    // Increment download count (purchase row was successfully inserted above)
    await queryWithResilience(() => getDb()
      .update(marketplaceAssets)
      .set({ downloadCount: sql`${marketplaceAssets.downloadCount} + 1` })
      .where(eq(marketplaceAssets.id, assetId)));

    // Record buyer transaction with actual post-update balance
    // onConflictDoNothing: idempotent under retry (unique on userId+source+referenceId)
    await queryWithResilience(() => getDb().insert(creditTransactions).values({
      userId: user.id,
      transactionType: 'deduction',
      amount: -price,
      balanceAfter: buyerBalanceAfter,
      source: 'marketplace_purchase',
      referenceId: assetId,
    }).onConflictDoNothing());

    // Record seller transaction with actual post-update balance from RETURNING.
    // referenceId must be unique per purchase (asset:buyer), not per asset —
    // otherwise repeat sales of the same asset silently drop seller earnings.
    await queryWithResilience(() => getDb().insert(creditTransactions).values({
      userId: seller.id,
      transactionType: 'earned',
      amount: sellerEarnings,
      balanceAfter: sellerUpdate?.earnedCredits ?? (seller.earnedCredits + sellerEarnings),
      source: 'marketplace_sale',
      referenceId: `${assetId}:${user.id}`,
    }).onConflictDoNothing());

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
