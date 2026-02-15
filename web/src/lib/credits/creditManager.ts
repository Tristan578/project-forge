import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
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
 * Deduct credits using waterfall: monthly → purchased → earned.
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

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const totalAvailable = monthlyRemaining + user.addonTokens + user.earnedCredits;

  if (totalAvailable < amount) {
    return { success: false, balance: { monthly: monthlyRemaining, purchased: user.addonTokens, earned: user.earnedCredits, total: totalAvailable } };
  }

  // Waterfall deduction
  let remaining = amount;
  let monthlyDeduct = 0;
  let addonDeduct = 0;
  let earnedDeduct = 0;

  // 1. Monthly first
  if (remaining > 0 && monthlyRemaining > 0) {
    monthlyDeduct = Math.min(remaining, monthlyRemaining);
    remaining -= monthlyDeduct;
  }
  // 2. Purchased second
  if (remaining > 0 && user.addonTokens > 0) {
    addonDeduct = Math.min(remaining, user.addonTokens);
    remaining -= addonDeduct;
  }
  // 3. Earned last
  if (remaining > 0 && user.earnedCredits > 0) {
    earnedDeduct = Math.min(remaining, user.earnedCredits);
    remaining -= earnedDeduct;
  }

  await db
    .update(users)
    .set({
      monthlyTokensUsed: sql`${users.monthlyTokensUsed} + ${monthlyDeduct}`,
      addonTokens: sql`${users.addonTokens} - ${addonDeduct}`,
      earnedCredits: sql`${users.earnedCredits} - ${earnedDeduct}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const balance = await getBalance(userId);

  // Audit trail
  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'deduction',
    amount: -amount,
    balanceAfter: balance.total,
    source: actionType,
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
