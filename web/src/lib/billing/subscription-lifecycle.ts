/**
 * Subscription lifecycle management.
 *
 * Handles the complete lifecycle of a Stripe subscription:
 * - New subscription creation (grant initial tokens)
 * - Tier changes via subscription.updated (upgrade/downgrade)
 * - Monthly renewal via invoice.paid (rollover + grant)
 * - Payment failures via invoice.payment_failed (grace period)
 * - Cancellation via subscription.deleted (revert to free)
 *
 * All operations are idempotent via webhook event ID tracking and
 * produce audit records in the credit_transactions table.
 */

import { eq, sql, and } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { users, creditTransactions, tokenPurchases } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';
import { updateUserTier } from '@/lib/auth/user-service';

/** Minimal query interface shared by both db and transaction handles. */
type Queryable = Pick<ReturnType<typeof getDb>, 'select'>;

/**
 * Helper: look up a user by their Stripe customer ID.
 * Returns null if no user is found (graceful handling for orphan events).
 */
export async function findUserByStripeCustomer(customerId: string) {
  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  return user ?? null;
}

export async function handleSubscriptionCreated(
  customerId: string,
  subscriptionId: string,
  tier: Tier
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const db = getDb();
  const allocation = TIER_MONTHLY_TOKENS[tier];

  await updateUserTier(user.id, tier);

  await db
    .update(users)
    .set({
      stripeSubscriptionId: subscriptionId,
      monthlyTokens: allocation,
      monthlyTokensUsed: 0,
      billingCycleStart: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const balance = await getTotalBalance(user.id);
  await db.insert(creditTransactions).values({
    userId: user.id,
    transactionType: 'monthly_grant',
    amount: allocation,
    balanceAfter: balance,
    source: `subscription_created:${tier}`,
    referenceId: subscriptionId,
  });
}

export async function handleSubscriptionUpdated(
  customerId: string,
  subscriptionId: string,
  newTier: Tier,
  subscriptionStatus: string
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const db = getDb();
  const currentTier = user.tier as Tier;
  const tierChanged = currentTier !== newTier;

  await db
    .update(users)
    .set({
      stripeSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    return;
  }

  if (!tierChanged) {
    await updateUserTier(user.id, newTier);
    return;
  }

  // Tier actually changed -- adjust token allocation.
  // PF-513: updateUserTier moved inside transaction.
  // PF-514: getTotalBalance uses tx instead of global db.
  // PF-521: serializable isolation prevents interleaving with concurrent deductions.
  const oldAllocation = TIER_MONTHLY_TOKENS[currentTier];
  const newAllocation = TIER_MONTHLY_TOKENS[newTier];

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ tier: newTier, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    if (newAllocation > oldAllocation) {
      const difference = newAllocation - oldAllocation;
      const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);

      await tx
        .update(users)
        .set({
          monthlyTokens: monthlyRemaining + difference,
          monthlyTokensUsed: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      const balance = await getTotalBalance(user.id, tx);
      await tx.insert(creditTransactions).values({
        userId: user.id,
        transactionType: 'adjustment',
        amount: difference,
        balanceAfter: balance,
        source: `upgrade:${currentTier}->${newTier}`,
        referenceId: subscriptionId,
      });
    } else {
      await tx
        .update(users)
        .set({
          monthlyTokens: newAllocation,
          monthlyTokensUsed: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      const balance = await getTotalBalance(user.id, tx);
      await tx.insert(creditTransactions).values({
        userId: user.id,
        transactionType: 'adjustment',
        amount: newAllocation - oldAllocation,
        balanceAfter: balance,
        source: `downgrade:${currentTier}->${newTier}`,
        referenceId: subscriptionId,
      });
    }
  }, { isolationLevel: 'serializable' });
}

export async function handleSubscriptionDeleted(
  customerId: string,
  subscriptionId: string
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const db = getDb();
  const previousTier = user.tier as Tier;
  const starterAllocation = TIER_MONTHLY_TOKENS['starter'];

  await updateUserTier(user.id, 'starter');

  await db
    .update(users)
    .set({
      stripeSubscriptionId: null,
      monthlyTokens: starterAllocation,
      monthlyTokensUsed: 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const balance = await getTotalBalance(user.id);
  await db.insert(creditTransactions).values({
    userId: user.id,
    transactionType: 'adjustment',
    amount: -Math.max(0, user.monthlyTokens - user.monthlyTokensUsed),
    balanceAfter: balance,
    source: `cancellation:${previousTier}->starter`,
    referenceId: subscriptionId,
  });
}

export async function handleInvoicePaid(
  customerId: string,
  invoiceId: string,
  subscriptionId: string | null
): Promise<void> {
  if (!subscriptionId) return;
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;
  if (user.stripeSubscriptionId && user.stripeSubscriptionId !== subscriptionId) return;

  const db = getDb();
  const tier = user.tier as Tier;
  const allocation = TIER_MONTHLY_TOKENS[tier];

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  if (monthlyRemaining > 0) {
    const rolloverAmount = Math.min(monthlyRemaining, allocation);
    await db.update(users).set({
      addonTokens: sql`${users.addonTokens} + ${rolloverAmount}`,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    if (rolloverAmount > 0) {
      const rolloverBalance = await getTotalBalance(user.id);
      await db.insert(creditTransactions).values({
        userId: user.id, transactionType: 'rollover', amount: rolloverAmount,
        balanceAfter: rolloverBalance, source: `renewal_rollover:${tier}`, referenceId: invoiceId,
      });
    }
  }

  await db.update(users).set({
    monthlyTokens: allocation, monthlyTokensUsed: 0,
    billingCycleStart: new Date(), updatedAt: new Date(),
  }).where(eq(users.id, user.id));

  const balance = await getTotalBalance(user.id);
  await db.insert(creditTransactions).values({
    userId: user.id, transactionType: 'monthly_grant', amount: allocation,
    balanceAfter: balance, source: `renewal:${tier}`, referenceId: invoiceId,
  });
}

export async function handleInvoicePaymentFailed(
  customerId: string,
  invoiceId: string,
  attemptCount: number,
  nextPaymentAttempt: Date | null
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const db = getDb();
  const balance = await getTotalBalance(user.id);
  await db.insert(creditTransactions).values({
    userId: user.id, transactionType: 'adjustment', amount: 0,
    balanceAfter: balance, source: `payment_failed:attempt_${attemptCount}`, referenceId: invoiceId,
  });

  if (nextPaymentAttempt) {
    console.warn(`[billing] Payment failed for user ${user.id}, attempt ${attemptCount}. Next retry: ${nextPaymentAttempt.toISOString()}`);
  } else {
    console.warn(`[billing] Payment failed for user ${user.id}, attempt ${attemptCount}. No further retries scheduled -- subscription will be cancelled by Stripe.`);
  }
}

/**
 * Handle a Stripe charge refund (partial or full).
 *
 * PF-526: Multiple partial refunds for the same charge must each deduct
 * tokens based only on the REMAINING un-refunded portion, not the original
 * total. We track cumulative refunded cents in tokenPurchases.refundedCents
 * and use an atomic SQL update with a WHERE guard to prevent races.
 *
 * Token deduction is proportional: if a $49 purchase granted 5000 tokens and
 * $24.50 is refunded, we deduct floor(5000 * 24.50 / 49) = 2500 tokens.
 */
export async function handleChargeRefunded(
  paymentIntentId: string,
  refundAmountCents: number
): Promise<void> {
  if (refundAmountCents <= 0) return;

  const db = getDb();

  // Find the purchase record for this payment intent
  const [purchase] = await db
    .select()
    .from(tokenPurchases)
    .where(eq(tokenPurchases.stripePaymentIntent, paymentIntentId))
    .limit(1);

  if (!purchase) return;

  const remainingCents = purchase.amountCents - purchase.refundedCents;
  if (remainingCents <= 0) return;

  // Clamp refund to what is actually remaining
  const effectiveRefund = Math.min(refundAmountCents, remainingCents);

  // Calculate proportional token deduction based on original total
  const tokensToDeduct = Math.floor(
    (purchase.tokens * effectiveRefund) / purchase.amountCents
  );

  // Atomically update refundedCents with a WHERE guard to prevent races
  const updateResult = await db
    .update(tokenPurchases)
    .set({
      refundedCents: sql`${tokenPurchases.refundedCents} + ${effectiveRefund}`,
    })
    .where(
      and(
        eq(tokenPurchases.id, purchase.id),
        sql`${tokenPurchases.amountCents} - ${tokenPurchases.refundedCents} >= ${effectiveRefund}`
      )
    )
    .returning({ id: tokenPurchases.id });

  if (updateResult.length === 0) return;

  if (tokensToDeduct > 0) {
    await db
      .update(users)
      .set({
        addonTokens: sql`GREATEST(0, ${users.addonTokens} - ${tokensToDeduct})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, purchase.userId));

    const balance = await getTotalBalance(purchase.userId);
    await db.insert(creditTransactions).values({
      userId: purchase.userId,
      transactionType: 'refund',
      amount: -tokensToDeduct,
      balanceAfter: balance,
      source: `charge_refund:${effectiveRefund}c/${purchase.amountCents}c`,
      referenceId: paymentIntentId,
    });
  }
}

/**
 * Get the total token balance for a user (monthly remaining + addon + earned).
 * Accepts an optional transaction handle so callers inside a transaction
 * read from the same snapshot (PF-514).
 */
async function getTotalBalance(userId: string, queryable?: Queryable): Promise<number> {
  const conn = queryable ?? getDb();
  const [user] = await conn
    .select({
      monthlyTokens: users.monthlyTokens,
      monthlyTokensUsed: users.monthlyTokensUsed,
      addonTokens: users.addonTokens,
      earnedCredits: users.earnedCredits,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return 0;
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  return monthlyRemaining + user.addonTokens + user.earnedCredits;
}
