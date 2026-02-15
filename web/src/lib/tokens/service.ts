import { eq, sql, and, gte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users, tokenUsage, tokenPurchases } from '../db/schema';
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
  metadata?: Record<string, unknown>
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
    // Race condition: balance changed between read and update. Retry once.
    return deductTokens(userId, operation, tokenCost, provider, metadata);
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

  const [record] = await db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.id, usageId))
    .limit(1);

  if (!record) return;

  // Reverse the deduction based on source
  if (record.source === 'monthly') {
    await db
      .update(users)
      .set({
        monthlyTokensUsed: sql`GREATEST(0, ${users.monthlyTokensUsed} - ${record.tokens})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } else if (record.source === 'addon') {
    await db
      .update(users)
      .set({
        addonTokens: sql`${users.addonTokens} + ${record.tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } else if (record.source === 'mixed') {
    // For mixed, we refund everything to addon for simplicity
    // (monthly may have reset since the charge)
    await db
      .update(users)
      .set({
        addonTokens: sql`${users.addonTokens} + ${record.tokens}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  // Log refund
  await db.insert(tokenUsage).values({
    userId,
    operation: 'refund',
    tokens: -record.tokens,
    source: record.source,
    provider: record.provider,
    metadata: { refundedUsageId: usageId },
  });
}

/** Credit tokens from an add-on purchase */
export async function creditAddonTokens(
  userId: string,
  pkg: TokenPackage,
  stripePaymentIntent: string
): Promise<void> {
  const db = getDb();
  const pkgInfo = TOKEN_PACKAGES[pkg];

  await db
    .update(users)
    .set({
      addonTokens: sql`${users.addonTokens} + ${pkgInfo.tokens}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await db.insert(tokenPurchases).values({
    userId,
    stripePaymentIntent,
    package: pkg,
    tokens: pkgInfo.tokens,
    amountCents: pkgInfo.priceCents,
  });
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
