import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
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

    // Check if already purchased. A purchase is only "complete" once the
    // buyer was actually charged — i.e. a marketplace_purchase deduction
    // credit_transaction exists. A bare asset_purchases row with NO deduction
    // is an orphan from a pre-fix interrupted charge (#8636): the buyer was
    // NOT charged and must be allowed to retry, not hard-blocked with 409.
    // Free purchases (priceTokens === 0) never create a deduction, so they
    // are always treated as complete on row existence.
    const [existing] = await queryWithResilience(() => getDb()
      .select({ priceTokens: assetPurchases.priceTokens })
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1));

    if (existing) {
      if (existing.priceTokens === 0) {
        return conflict('Already purchased');
      }
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
        return conflict('Already purchased');
      }
      // Orphan row, no charge — fall through; the atomic transaction's
      // ON CONFLICT DO NOTHING gate keeps the existing row and re-attempts
      // the charge idempotently.
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

    // Get seller (needed for the atomic transaction below).
    const [seller] = await queryWithResilience(() => getDb().select().from(users).where(eq(users.id, asset.sellerId)).limit(1));
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // 70% to seller, 30% platform fee
    const sellerEarnings = Math.floor(price * 0.7);

    // ATOMIC PURCHASE (#8636, Sentry HIGH).
    //
    // Previously the purchase ran as a SEQUENCE of independently-committed
    // statements: assetPurchases INSERT (idempotency gate) → buyer-balance
    // UPDATE → seller-balance UPDATE → buyer/seller creditTransactions INSERTs.
    // A crash anywhere in that window (timeout / OOM / cold-start kill) left
    // the buyer CHARGED but with no deduction credit_transaction row. The
    // download gate keys off exactly that row, so the buyer paid yet could
    // never download — and the orphan assetPurchases row turned every retry
    // into a 409. The buyer was charged for an asset they can never obtain.
    //
    // Fix: run ALL money movement in ONE getNeonSql() -> neonSql.transaction()
    // so it is all-or-nothing. db.transaction() is unsupported on neon-http
    // (throws) — the raw tagged-template transaction array is the only path.
    //
    // The whole charge is gated, in SQL, on the buyer having sufficient
    // balance RIGHT NOW (not on the pre-read snapshot). Each dependent
    // statement is chained via `EXISTS (SELECT 1 FROM <prior CTE>)` so if the
    // gate INSERT conflicts (concurrent purchase) or the balance guard fails
    // (balance changed after the pre-check), NOTHING downstream takes effect —
    // no orphan rows, no partial charge. balance_after is computed inside the
    // CTE from the buyer's pre-deduction row, mirroring the audit semantics
    // the download gate and refunds rely on.
    const neonSql = getNeonSql();
    const txnResults = await queryWithResilience(() =>
      neonSql.transaction([
        // Buyer side: gate INSERT + deduction audit + balance UPDATE, all
        // chained so the deduction only commits when the buyer is solvent and
        // the idempotency gate actually inserted a fresh row.
        neonSql`
          WITH gate AS (
            INSERT INTO asset_purchases (buyer_id, asset_id, price_tokens, license)
            VALUES (${user.id}, ${assetId}, ${price}, ${asset.license})
            ON CONFLICT (buyer_id, asset_id) DO NOTHING
            RETURNING id
          ),
          buyer_txn AS (
            INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
            SELECT ${user.id}, 'deduction', ${-price},
                   GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits - ${price},
                   'marketplace_purchase', ${assetId}
            FROM users
            WHERE id = ${user.id}
              AND GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits >= ${price}
              -- The gate INSERT (above, first statement of this CTE) guarantees
              -- the asset_purchases row exists. Reference the table directly —
              -- NOT the gate CTE's RETURNING — so a pre-fix ORPHAN row (present
              -- but never charged) still permits the charge instead of being
              -- permanently blocked. The ON CONFLICT below keeps the deduction
              -- idempotent if a charge already completed.
              AND EXISTS (
                SELECT 1 FROM asset_purchases
                WHERE buyer_id = ${user.id} AND asset_id = ${assetId}
              )
            ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
            RETURNING id
          )
          UPDATE users
          SET
            monthly_tokens_used = monthly_tokens_used
              + LEAST(${price}, GREATEST(0, monthly_tokens - monthly_tokens_used)),
            addon_tokens = addon_tokens
              - LEAST(
                  GREATEST(0, ${price} - GREATEST(0, monthly_tokens - monthly_tokens_used)),
                  addon_tokens
                ),
            earned_credits = earned_credits
              - LEAST(
                  GREATEST(0,
                    ${price}
                    - GREATEST(0, monthly_tokens - monthly_tokens_used)
                    - addon_tokens
                  ),
                  earned_credits
                ),
            updated_at = NOW()
          WHERE id = ${user.id}
            AND EXISTS (SELECT 1 FROM buyer_txn)
          RETURNING id
        `,
        // Seller side: credit earnings + audit, gated on the buyer charge
        // having committed (buyer deduction row present for THIS purchase).
        neonSql`
          WITH charged AS (
            SELECT 1 AS ok
            FROM credit_transactions
            WHERE user_id = ${user.id}
              AND source = 'marketplace_purchase'
              AND reference_id = ${assetId}
          ),
          seller_upd AS (
            UPDATE users
            SET earned_credits = earned_credits + ${sellerEarnings},
                updated_at = NOW()
            WHERE id = ${seller.id}
              AND EXISTS (SELECT 1 FROM charged)
            RETURNING earned_credits
          )
          INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
          SELECT ${seller.id}, 'earned', ${sellerEarnings},
                 (SELECT earned_credits FROM seller_upd),
                 'marketplace_sale', ${`${assetId}:${user.id}`}
          WHERE EXISTS (SELECT 1 FROM seller_upd)
          ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        `,
        // Download count: only when the buyer was actually charged.
        neonSql`
          UPDATE marketplace_assets
          SET download_count = download_count + 1
          WHERE id = ${assetId}
            AND EXISTS (
              SELECT 1 FROM credit_transactions
              WHERE user_id = ${user.id}
                AND source = 'marketplace_purchase'
                AND reference_id = ${assetId}
            )
        `,
      ])
    );

    // neonSql.transaction([...]) resolves to one result-set per statement, in
    // order. The FIRST statement (buyer charge) RETURNS the buyer row id ONLY
    // when the full buyer charge committed (gate inserted/present, balance
    // sufficient, deduction recorded). An empty first result-set → either the
    // idempotency gate conflicted on a completed charge, or the balance guard
    // failed (balance changed since the pre-check). Either way the whole
    // transaction rolled back atomically, so there is no orphan row to clean
    // up — distinguish only for the client's response.
    const buyerChargeRows = (txnResults?.[0] ?? []) as Array<{ id: string }>;
    if (buyerChargeRows.length === 0) {
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
        // Fully completed on a prior attempt — buyer was already charged.
        return conflict('Already purchased');
      }
      // Gate conflicted but no completed charge, or balance changed — safe to
      // retry. No partial state was committed.
      return NextResponse.json({ error: 'Balance changed, please retry' }, { status: 409 });
    }

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
