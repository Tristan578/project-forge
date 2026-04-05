import { eq, and, gte } from 'drizzle-orm';
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

  // Atomic deduction via UPDATE...WHERE...RETURNING (PF-996).
  // The UPDATE's WHERE guards prevent the race condition (only succeeds if
  // balance hasn't changed). We need the RETURNING result to check success,
  // so this runs as a standalone statement (not in a transaction).
  //
  // The usage INSERT runs separately after. If it fails, the deduction still
  // stands — worst case is a missing usage record (recoverable via admin
  // tooling). This is acceptable because the UPDATE's WHERE guard is the
  // critical atomicity point for financial correctness.
  const neonSql = getNeonSql();
  const now = new Date().toISOString();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const updateRows = await neonSql`
    UPDATE users
    SET monthly_tokens_used = monthly_tokens_used + ${monthlyDeduct},
        addon_tokens = addon_tokens - ${addonDeduct},
        updated_at = ${now}
    WHERE id = ${userId}
      AND (monthly_tokens - monthly_tokens_used) >= ${monthlyDeduct}
      AND addon_tokens >= ${addonDeduct}
    RETURNING id
  `;

  if (updateRows.length === 0) {
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

  // Log usage — if this fails, the deduction already committed (acceptable:
  // user lost tokens without a usage record, but this is extremely rare and
  // recoverable via admin tooling). We don't wrap in a transaction because
  // the UPDATE's WHERE guard is the critical atomicity point.
  const usageResult = await neonSql`
    INSERT INTO token_usage (user_id, operation, tokens, source, provider, metadata)
    VALUES (${userId}, ${operation}, ${tokenCost}, ${source}, ${provider ?? null}, ${metadataJson}::jsonb)
    RETURNING id
  `;

  const usageId = (usageResult[0] as { id: string }).id;
  const remaining = await getTokenBalance(userId);

  return {
    success: true,
    usageId,
    remaining,
  };
}

/** Refund tokens from a failed API call */
export interface RefundResult {
  /** Whether tokens were actually credited (false = already refunded or record not found) */
  refunded: boolean;
}

export async function refundTokens(userId: string, usageId: string): Promise<RefundResult> {
  if (usageId === 'free') return { refunded: false };

  const db = getDb();

  // 1. Look up the original usage record
  const [record] = await db
    .select()
    .from(tokenUsage)
    .where(and(eq(tokenUsage.id, usageId), eq(tokenUsage.userId, userId)))
    .limit(1);

  if (!record) return { refunded: false };

  // 2. Atomic idempotent refund using a CTE.
  // The CTE INSERT uses WHERE NOT EXISTS to check-and-insert in one step.
  // The UPDATE's WHERE depends on the CTE's RETURNING output (not a table scan),
  // so it only runs when the INSERT actually inserted a row — preventing
  // double-crediting when a pre-existing refund row matches.
  const neonSql = getNeonSql();
  const refundMetadata = JSON.stringify({ refundedUsageId: usageId });

  // Build the CTE-based single statement based on source type
  const setClause = record.source === 'monthly'
    ? neonSql`monthly_tokens_used = GREATEST(0, monthly_tokens_used - ${record.tokens})`
    : neonSql`addon_tokens = addon_tokens + ${record.tokens}`;

  const result = await neonSql`
    WITH ins AS (
      INSERT INTO token_usage (user_id, operation, tokens, source, provider, metadata)
      SELECT ${userId}::uuid, 'refund', ${-record.tokens}, ${record.source}, ${record.provider}, ${refundMetadata}::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM token_usage
        WHERE user_id = ${userId}::uuid
          AND operation = 'refund'
          AND metadata->>'refundedUsageId' = ${usageId}
      )
      RETURNING id
    )
    UPDATE users
    SET ${setClause}, updated_at = NOW()
    WHERE id = ${userId}::uuid
      AND EXISTS (SELECT 1 FROM ins)
    RETURNING id
  `;
  // If the CTE idempotency guard skipped the INSERT, the UPDATE also
  // does nothing (EXISTS check), so result is empty → already refunded.
  return { refunded: result.length > 0 };
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

  // Atomic idempotent refund using a CTE.
  // When usageId is provided, the CTE INSERT uses WHERE NOT EXISTS to prevent
  // duplicate partial refunds. The UPDATE depends on the CTE's RETURNING output
  // so it only runs when the INSERT actually inserted — preventing double-credit.
  // When no usageId, the INSERT always succeeds (no idempotency needed).
  const neonSql = getNeonSql();
  const metadata = JSON.stringify({
    reason,
    ...(usageId ? { refundedUsageId: usageId } : {}),
  });

  const setClause = source === 'monthly'
    ? neonSql`monthly_tokens_used = GREATEST(0, monthly_tokens_used - ${tokens})`
    : neonSql`addon_tokens = addon_tokens + ${tokens}`;

  if (usageId) {
    // Idempotent path: CTE INSERT + UPDATE in a single statement
    await neonSql`
      WITH ins AS (
        INSERT INTO token_usage (user_id, operation, tokens, source, metadata)
        SELECT ${userId}, 'partial_refund', ${-tokens}, ${source}, ${metadata}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM token_usage
          WHERE user_id = ${userId}
            AND operation = 'partial_refund'
            AND metadata->>'refundedUsageId' = ${usageId}
        )
        RETURNING id
      )
      UPDATE users
      SET ${setClause}, updated_at = NOW()
      WHERE id = ${userId}
        AND EXISTS (SELECT 1 FROM ins)
    `;
  } else {
    // No usageId: no idempotency guard needed, use transaction for atomicity
    await neonSql.transaction([
      neonSql`
        INSERT INTO token_usage (user_id, operation, tokens, source, metadata)
        VALUES (${userId}, 'partial_refund', ${-tokens}, ${source}, ${metadata}::jsonb)
      `,
      neonSql`
        UPDATE users
        SET ${setClause}, updated_at = NOW()
        WHERE id = ${userId}
      `,
    ]);
  }
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
