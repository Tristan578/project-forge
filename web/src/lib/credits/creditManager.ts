import { eq, sql } from 'drizzle-orm';
import { getDb, getNeonSql } from '../db/client';
import { users, creditTransactions } from '../db/schema';
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

  // Atomic waterfall deduction via a single UPDATE...RETURNING.
  //
  // The WHERE clause includes the balance check so concurrent requests cannot
  // both pass: only one UPDATE succeeds when balance is at the limit.
  //
  // Waterfall logic (all in SQL):
  //   1. Deduct from monthly first (monthly_tokens - monthly_tokens_used)
  //   2. Then from addon_tokens
  //   3. Then from earned_credits
  //
  // The LEAST/GREATEST expressions compute each pool's contribution safely.
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

  // Audit trail — separate insert after the atomic deduction
  const db = getDb();
  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'deduction',
    amount: -amount,
    balanceAfter: balance.total,
    source: actionType,
  });

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

  // Restore credits to the addon (purchased) pool.
  // We use addon because the original deduction may have spanned pools
  // and monthly tokens may have since reset.
  await db
    .update(users)
    .set({
      addonTokens: sql`${users.addonTokens} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const balance = await getBalance(userId);

  // Audit trail
  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'refund',
    amount,
    balanceAfter: balance.total,
    source: 'credit_refund',
    referenceId: transactionId,
  });

  return { success: true, balance };
}

/** Grant monthly credits at billing cycle start */
export async function grantMonthlyCredits(
  userId: string,
  tierId: string
): Promise<void> {
  const db = getDb();
  const allocation = TIER_MONTHLY_TOKENS[tierId as keyof typeof TIER_MONTHLY_TOKENS] ?? 0;

  await db
    .update(users)
    .set({
      monthlyTokens: allocation,
      monthlyTokensUsed: 0,
      billingCycleStart: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const balance = await getBalance(userId);

  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'monthly_grant',
    amount: allocation,
    balanceAfter: balance.total,
    source: tierId,
  });
}

/** Roll unused monthly tokens up to tier cap */
export async function processRollover(
  userId: string,
  tierId: string
): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  if (monthlyRemaining <= 0) return;

  // Cap rollover at monthly allocation (simple cap)
  const cap = TIER_MONTHLY_TOKENS[tierId as keyof typeof TIER_MONTHLY_TOKENS] ?? 0;
  const rolloverAmount = Math.min(monthlyRemaining, cap);
  if (rolloverAmount <= 0) return;

  await db
    .update(users)
    .set({
      addonTokens: sql`${users.addonTokens} + ${rolloverAmount}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const balance = await getBalance(userId);

  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'rollover',
    amount: rolloverAmount,
    balanceAfter: balance.total,
    source: tierId,
  });
}
