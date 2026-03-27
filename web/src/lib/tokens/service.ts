import { eq, sql, and, gte } from 'drizzle-orm';
import { getDb, getNeonSql } from '../db/client';
import { users, tokenUsage } from '../db/schema';
import type { TokenPackage } from './pricing';
import { TOKEN_PACKAGES, TIER_MONTHLY_TOKENS } from './pricing';

export interface TokenBalance {
  monthlyRemaining: number;
  monthlyTotal: number;
  addon: number;
  total: number;
  nextRefillDate: string | null;
}

export interface DeductResult {
  success: true;
  usageId: string;
  remaining: TokenBalance;
}

export interface DeductError {
  success: false;
  error: 'INSUFFICIENT_TOKENS';
  balance: TokenBalance;
  cost: number;
}

/** Get current token balance for a user */
export async function getTokenBalance(userId: string): Promise<TokenBalance> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  return {
    monthlyRemaining,
    monthlyTotal: user.monthlyTokens,
    addon: user.addonTokens,
    total: monthlyRemaining + user.addonTokens,
    nextRefillDate: user.billingCycleStart
      ? new Date(
          new Date(user.billingCycleStart).getTime() + 30 * 24 * 60 * 60 * 1000
        ).toISOString()
      : null,
  };
}

/**
 * Deduct tokens from a user's balance.
 * Uses monthly tokens first, then addon tokens.
 * Returns usage ID for refund on failure.
 */
export async function deductTokens(
  userId: string,
  operation: string,
  tokenCost: number,
  provider?: string,
  metadata?: Record<string, unknown>,
  _retryCount = 0
): Promise<DeductResult | DeductError> {
  if (tokenCost <= 0) {
    // Free operations don't need deduction
    return {
      success: true,
      usageId: 'free',
      remaining: await getTokenBalance(userId),
    };
  }

  const db = getDb();

  // Read current balance
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const totalAvailable = monthlyRemaining + user.addonTokens;

  if (totalAvailable < tokenCost) {
    return {
      success: false,
      error: 'INSUFFICIENT_TOKENS',
      balance: {
        monthlyRemaining,
        monthlyTotal: user.monthlyTokens,
        addon: user.addonTokens,
        total: totalAvailable,
        nextRefillDate: user.billingCycleStart
          ? new Date(
              new Date(user.billingCycleStart).getTime() + 30 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null,
      },
      cost: tokenCost,
    };
  }

  // Determine source split
  let monthlyDeduct = 0;
  let addonDeduct = 0;
  let source: 'monthly' | 'addon' | 'mixed';

  if (monthlyRemaining >= tokenCost) {
    monthlyDeduct = tokenCost;
    source = 'monthly';
  } else if (monthlyRemaining > 0) {
    monthlyDeduct = monthlyRemaining;
    addonDeduct = tokenCost - monthlyRemaining;
    source = 'mixed';
  } else {
    addonDeduct = tokenCost;
    source = 'addon';
  }

  // Atomic update — uses SQL conditional to prevent race conditions
  // Only succeeds if balance hasn't changed since we read it
  const updateResult = await db
    .update(users)
    .set({
      monthlyTokensUsed: sql`${users.monthlyTokensUsed} + ${monthlyDeduct}`,
      addonTokens: sql`${users.addonTokens} - ${addonDeduct}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        // Guard: monthly tokens used hasn't exceeded what we expect
        sql`(${users.monthlyTokens} - ${users.monthlyTokensUsed}) >= ${monthlyDeduct}`,
        // Guard: addon tokens haven't dropped below what we need
        sql`${users.addonTokens} >= ${addonDeduct}`
      )
    )
    .returning({ id: users.id });

  if (updateResult.length === 0) {
    // Race condition: balance changed between read and update. Retry up to 3 times.
    if (_retryCount >= 3) {
      return {
        success: false,
        error: 'INSUFFICIENT_TOKENS',
        balance: await getTokenBalance(userId),
        cost: tokenCost,
      };
    }
    return deductTokens(userId, operation, tokenCost, provider, metadata, _retryCount + 1);
  }

  // Log usage
  const [usageRecord] = await db
    .insert(tokenUsage)
    .values({
      userId,
      operation,
      tokens: tokenCost,
      source,
      provider: provider ?? null,
      metadata: metadata ?? null,
    })
    .returning({ id: tokenUsage.id });

  const remaining = await getTokenBalance(userId);

  return {
    success: true,
    usageId: usageRecord.id,
    remaining,
  };
}

/** Refund tokens from a failed API call */
export async function refundTokens(userId: string, usageId: string): Promise<void> {
  if (usageId === 'free') return;

  const db = getDb();

  // 1. Look up the original usage record
  const [record] = await db
    .select()
    .from(tokenUsage)
    .where(and(eq(tokenUsage.id, usageId), eq(tokenUsage.userId, userId)))
    .limit(1);

  if (!record) return;

  // 2. Atomic idempotent refund using neonSql.transaction().
  // The refund log INSERT uses WHERE NOT EXISTS to atomically check-and-insert.
  // If a refund log already exists for this usageId, the INSERT returns 0 rows
  // and the balance UPDATE is skipped. This prevents the TOCTOU race where two
  // concurrent refund calls both pass a SELECT check before either inserts.
  const neonSql = getNeonSql();

  // Atomic transaction: INSERT refund log + UPDATE balance in one batch.
  // If either fails, both roll back — preventing the case where the log
  // is written but balance isn't credited (permanent token loss).
  // The UPDATE uses EXISTS as a guard: if the INSERT was a no-op (already
  // refunded), the UPDATE also does nothing.
  const refundMetadata = JSON.stringify({ refundedUsageId: usageId });

  const insertStmt = neonSql`
    INSERT INTO token_usage (user_id, operation, tokens, source, provider, metadata)
    SELECT ${userId}::uuid, 'refund', ${-record.tokens}, ${record.source}, ${record.provider}, ${refundMetadata}::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM token_usage
      WHERE user_id = ${userId}::uuid
        AND operation = 'refund'
        AND metadata->>'refundedUsageId' = ${usageId}
    )
  `;

  // Build the UPDATE based on source type
  const updateStmt = record.source === 'monthly'
    ? neonSql`
        UPDATE users
        SET monthly_tokens_used = GREATEST(0, monthly_tokens_used - ${record.tokens}), updated_at = NOW()
        WHERE id = ${userId}::uuid
          AND EXISTS (
            SELECT 1 FROM token_usage
            WHERE user_id = ${userId}::uuid AND operation = 'refund' AND metadata->>'refundedUsageId' = ${usageId}
          )
      `
    : neonSql`
        UPDATE users
        SET addon_tokens = addon_tokens + ${record.tokens}, updated_at = NOW()
        WHERE id = ${userId}::uuid
          AND EXISTS (
            SELECT 1 FROM token_usage
            WHERE user_id = ${userId}::uuid AND operation = 'refund' AND metadata->>'refundedUsageId' = ${usageId}
          )
      `;

  // neonSql.transaction runs both in a single PostgreSQL transaction
  await neonSql.transaction([insertStmt, updateStmt]);
}

/**
 * Refund a specific number of tokens for a partial operation failure.
 * Use this when only a subset of items in a batch operation failed — the caller
 * is responsible for calculating how many tokens to return.
 *
 * Pass `usageId` (from the original `deductTokens` call) so the refund is
 * credited to the correct pool (monthly vs addon).  When the original source
 * was `monthly`, the refund reduces `monthlyTokensUsed`; for `addon` or
 * `mixed` it increases `addonTokens` (matching the `refundTokens` behaviour
 * for the mixed case).
 *
 * For a complete operation failure (all items failed), prefer `refundTokens`
 * which reverses the exact deduction amount from the usage record.
 */
export async function refundTokenAmount(
  userId: string,
  tokens: number,
  reason: string,
  usageId?: string,
): Promise<void> {
  if (tokens <= 0) return;

  const db = getDb();

  // Determine the original source so we credit the right pool.
  let source: 'monthly' | 'addon' | 'mixed' = 'addon';
  if (usageId) {
    const [record] = await db
      .select({ source: tokenUsage.source })
      .from(tokenUsage)
      .where(and(eq(tokenUsage.id, usageId), eq(tokenUsage.userId, userId)))
      .limit(1);
    if (record) source = record.source as 'monthly' | 'addon' | 'mixed';
  }

  if (source === 'monthly') {
    await db
      .update(users)
      .set({
        monthlyTokensUsed: sql`GREATEST(0, ${users.monthlyTokensUsed} - ${tokens})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } else {
    // addon or mixed — refund to addonTokens (consistent with full refundTokens for mixed)
    await db
      .update(users)
      .set({
        addonTokens: sql`${users.addonTokens} + ${tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  await db.insert(tokenUsage).values({
    userId,
    operation: 'partial_refund',
    tokens: -tokens,
    source,
    metadata: { reason, ...(usageId ? { refundedUsageId: usageId } : {}) },
  });
}

/** Credit tokens from an add-on purchase (atomic: balance update + purchase record) */
export async function creditAddonTokens(
  userId: string,
  pkg: TokenPackage,
  stripePaymentIntent: string
): Promise<void> {
  const neonSql = getNeonSql();
  const pkgInfo = TOKEN_PACKAGES[pkg];
  const now = new Date().toISOString();

  // Use neon sql.transaction() to atomically:
  //   1. Increment addon_tokens on the user row
  //   2. Insert the purchase record
  // If either statement fails, neither is committed (PF-977).
  await neonSql.transaction([
    neonSql`
      UPDATE users
      SET addon_tokens = addon_tokens + ${pkgInfo.tokens},
          updated_at   = ${now}
      WHERE id = ${userId}
    `,
    neonSql`
      INSERT INTO token_purchases (user_id, stripe_payment_intent, package, tokens, amount_cents)
      VALUES (${userId}, ${stripePaymentIntent}, ${pkg}, ${pkgInfo.tokens}, ${pkgInfo.priceCents})
    `,
  ]);
}

/** Reset monthly tokens on billing cycle renewal */
export async function resetMonthlyTokens(
  userId: string,
  tier: 'starter' | 'hobbyist' | 'creator' | 'pro'
): Promise<void> {
  const db = getDb();
  const allocation = TIER_MONTHLY_TOKENS[tier];

  await db
    .update(users)
    .set({
      monthlyTokens: allocation,
      monthlyTokensUsed: 0,
      billingCycleStart: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Get usage history for a user (last 30 days by default) */
export async function getUsageHistory(
  userId: string,
  days: number = 30
): Promise<{ operation: string; tokens: number; provider: string | null; createdAt: Date }[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return db
    .select({
      operation: tokenUsage.operation,
      tokens: tokenUsage.tokens,
      provider: tokenUsage.provider,
      createdAt: tokenUsage.createdAt,
    })
    .from(tokenUsage)
    .where(and(eq(tokenUsage.userId, userId), gte(tokenUsage.createdAt, since)))
    .orderBy(tokenUsage.createdAt);
}
