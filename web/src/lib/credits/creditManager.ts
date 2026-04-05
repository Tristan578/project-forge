import { eq } from 'drizzle-orm';
import { getDb, getNeonSql } from '../db/client';
import { users } from '../db/schema';
import { TIER_MONTHLY_TOKENS } from '../tokens/pricing';

export interface CreditBalance {
  monthly: number;
  purchased: number;
  earned: number;
  total: number;
}

/** Get the 3-pool credit balance for a user */
export async function getBalance(userId: string): Promise<CreditBalance> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  return {
    monthly: monthlyRemaining,
    purchased: user.addonTokens,
    earned: user.earnedCredits,
    total: monthlyRemaining + user.addonTokens + user.earnedCredits,
  };
}

/**
 * Deduct credits using an atomic SQL UPDATE with waterfall: monthly → purchased → earned.
 *
 * Uses a single UPDATE...WHERE...RETURNING to atomically check balance and apply
 * the deduction. If no rows are returned the balance was insufficient — concurrent
 * requests cannot both pass the balance check (fixes #8023 TOCTOU race condition).
 *
 * Records a credit transaction for audit.
 */
export async function deductCredits(
  userId: string,
  amount: number,
  actionType: string
): Promise<{ success: boolean; balance: CreditBalance }> {
  if (amount <= 0) {
    return { success: true, balance: await getBalance(userId) };
  }

  const neonSql = getNeonSql();

  // Atomic waterfall deduction via a single UPDATE...WHERE...RETURNING (PF-996).
  //
  // The UPDATE's WHERE clause includes the balance check so concurrent requests
  // cannot both pass: only one UPDATE succeeds when balance is at the limit.
  //
  // Waterfall logic (all in SQL):
  //   1. Deduct from monthly first (monthly_tokens - monthly_tokens_used)
  //   2. Then from addon_tokens
  //   3. Then from earned_credits
  //
  // The audit INSERT runs as a separate statement after the UPDATE. If the audit
  // INSERT fails, the deduction still stands — the worst case is a missing audit
  // row (not a financial loss), recoverable via admin tooling.
  const rows = await neonSql`
    UPDATE users
    SET
      monthly_tokens_used = monthly_tokens_used
        + LEAST(
            ${amount},
            GREATEST(0, monthly_tokens - monthly_tokens_used)
          ),
      addon_tokens = addon_tokens
        - LEAST(
            GREATEST(0, ${amount} - GREATEST(0, monthly_tokens - monthly_tokens_used)),
            addon_tokens
          ),
      earned_credits = earned_credits
        - LEAST(
            GREATEST(0,
              ${amount}
              - GREATEST(0, monthly_tokens - monthly_tokens_used)
              - addon_tokens
            ),
            earned_credits
          ),
      updated_at = NOW()
    WHERE
      id = ${userId}
      AND GREATEST(0, monthly_tokens - monthly_tokens_used)
            + addon_tokens
            + earned_credits >= ${amount}
    RETURNING
      id,
      monthly_tokens,
      monthly_tokens_used,
      addon_tokens,
      earned_credits
  `;

  if (rows.length === 0) {
    // Either user not found or insufficient balance.
    // Check which it is so we can give a correct response.
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error(`User not found: ${userId}`);

    const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
    const totalAvailable = monthlyRemaining + user.addonTokens + user.earnedCredits;
    return {
      success: false,
      balance: {
        monthly: monthlyRemaining,
        purchased: user.addonTokens,
        earned: user.earnedCredits,
        total: totalAvailable,
      },
    };
  }

  const updated = rows[0] as {
    monthly_tokens: number;
    monthly_tokens_used: number;
    addon_tokens: number;
    earned_credits: number;
  };

  const monthlyRemaining = Math.max(0, updated.monthly_tokens - updated.monthly_tokens_used);
  const balance: CreditBalance = {
    monthly: monthlyRemaining,
    purchased: updated.addon_tokens,
    earned: updated.earned_credits,
    total: monthlyRemaining + updated.addon_tokens + updated.earned_credits,
  };

  // Audit trail — INSERT after deduction but the UPDATE already committed
  // via RETURNING. Since the deduction uses WHERE guards, the worst case
  // if the audit INSERT fails is a missing audit row (not a financial loss).
  // We use neonSql here for consistency with the raw SQL UPDATE above.
  await neonSql`
    INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source)
    VALUES (${userId}, 'deduction', ${-amount}, ${balance.total}, ${actionType})
  `;

  return { success: true, balance };
}

/**
 * Refund credits for a specific deduction transaction (PF-488).
 * Restores the amount to the purchased (addon) pool and records an audit trail.
 * Returns the updated balance, or throws if the user is not found.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  transactionId: string
): Promise<{ success: boolean; balance: CreditBalance }> {
  if (amount <= 0) {
    return { success: true, balance: await getBalance(userId) };
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  // Atomic idempotent refund using a CTE (PF-996).
  // The CTE INSERT only succeeds if no refund for this transactionId exists yet
  // (WHERE NOT EXISTS). The UPDATE's WHERE depends on the CTE's RETURNING output,
  // so it only runs when the INSERT actually inserted a row — NOT when a
  // pre-existing refund row happens to match. This prevents double-crediting.
  const neonSql = getNeonSql();

  await neonSql`
    WITH ins AS (
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      SELECT ${userId}, 'refund', ${amount},
             GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + ${amount} + earned_credits,
             'credit_refund', ${transactionId}
      FROM users WHERE id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM credit_transactions
          WHERE user_id = ${userId}
            AND transaction_type = 'refund'
            AND reference_id = ${transactionId}
        )
      RETURNING id
    )
    UPDATE users
    SET addon_tokens = addon_tokens + ${amount},
        updated_at = NOW()
    WHERE id = ${userId}
      AND EXISTS (SELECT 1 FROM ins)
  `;

  const balance = await getBalance(userId);
  return { success: true, balance };
}

/** Grant monthly credits at billing cycle start (PF-996: atomic transaction) */
export async function grantMonthlyCredits(
  userId: string,
  tierId: string
): Promise<void> {
  const neonSql = getNeonSql();
  const allocation = TIER_MONTHLY_TOKENS[tierId as keyof typeof TIER_MONTHLY_TOKENS] ?? 0;
  const now = new Date().toISOString();

  // All mutations atomic via neonSql.transaction() (PF-996).
  // INSERT before UPDATE so balance_after reads pre-grant addon_tokens.
  await neonSql.transaction([
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source)
      SELECT ${userId}, 'monthly_grant', ${allocation},
             ${allocation} + addon_tokens + earned_credits,
             ${tierId}
      FROM users WHERE id = ${userId}
    `,
    neonSql`
      UPDATE users
      SET monthly_tokens      = ${allocation},
          monthly_tokens_used = 0,
          billing_cycle_start = ${now},
          updated_at          = ${now}
      WHERE id = ${userId}
    `,
  ]);
}

/**
 * Roll unused monthly tokens up to tier cap (PF-996: atomic transaction).
 *
 * The pre-read snapshot is used only for the early-exit check (no remaining
 * tokens). The actual rollover amount is computed in SQL at execution time
 * via LEAST/GREATEST so concurrent deductions between the read and the
 * transaction are handled correctly (worst case: 0-amount rollover).
 */
export async function processRollover(
  userId: string,
  tierId: string
): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  if (monthlyRemaining <= 0) return;

  const cap = TIER_MONTHLY_TOKENS[tierId as keyof typeof TIER_MONTHLY_TOKENS] ?? 0;
  if (cap <= 0) return;

  const neonSql = getNeonSql();
  const now = new Date().toISOString();

  // All mutations atomic. INSERT before UPDATE so balance_after reads
  // pre-rollover addon_tokens. Rollover amount computed in SQL at execution
  // time to prevent stale snapshot races.
  await neonSql.transaction([
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source)
      SELECT ${userId}, 'rollover',
             LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${cap}),
             GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits
               + LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${cap}),
             ${tierId}
      FROM users WHERE id = ${userId}
        AND GREATEST(0, monthly_tokens - monthly_tokens_used) > 0
    `,
    neonSql`
      UPDATE users
      SET addon_tokens = addon_tokens + LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${cap}),
          updated_at   = ${now}
      WHERE id = ${userId}
        AND GREATEST(0, monthly_tokens - monthly_tokens_used) > 0
    `,
  ]);
}
