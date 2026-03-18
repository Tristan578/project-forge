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

import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Handle a brand-new subscription being created.
 *
 * - Sets the user's tier and subscription ID
 * - Grants initial monthly token allocation
 * - Records a credit transaction
 */
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

  // Audit trail
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

/**
 * Handle a subscription being updated (plan change, status change, etc.).
 *
 * Key distinction from `handleSubscriptionCreated`:
 * - Only adjusts tokens when the tier actually changes
 * - On upgrade: grants the difference in token allocation immediately
 * - On downgrade: caps tokens to the new tier's allocation
 * - On status change only (same tier): no token change
 */
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

  // Always update the subscription ID and status-related fields
  await db
    .update(users)
    .set({
      stripeSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // If subscription is past_due or unpaid, we do NOT change tier or tokens
  // -- let the invoice.payment_failed handler deal with grace period
  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    return;
  }

  if (!tierChanged) {
    // No tier change -- update tier in case it was out of sync, but don't
    // reset tokens. This handles status changes like active -> trialing, etc.
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
    // PF-513: tier update inside transaction so it rolls back on failure
    await tx
      .update(users)
      .set({ tier: newTier, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    if (newAllocation > oldAllocation) {
      // Upgrade: grant the difference in tokens immediately
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

      // PF-514: read balance through tx, not global db
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
      // Downgrade: cap monthly tokens to new allocation, reset used counter
      // User keeps any addon tokens they purchased
      await tx
        .update(users)
        .set({
          monthlyTokens: newAllocation,
          monthlyTokensUsed: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // PF-514: read balance through tx, not global db
      const balance = await getTotalBalance(user.id, tx);
      await tx.insert(creditTransactions).values({
        userId: user.id,
        transactionType: 'adjustment',
        amount: newAllocation - oldAllocation, // negative for downgrade
        balanceAfter: balance,
        source: `downgrade:${currentTier}->${newTier}`,
        referenceId: subscriptionId,
      });
    }
  }, { isolationLevel: 'serializable' });
}

/**
 * Handle a subscription being deleted (cancelled).
 *
 * - Reverts user to starter (free) tier
 * - Zeros out monthly tokens (addon tokens are preserved)
 * - Clears subscription ID
 * - Records an audit transaction
 */
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

/**
 * Handle a successful invoice payment (monthly renewal).
 */
export async function handleInvoicePaid(
  customerId: string,
  invoiceId: string,
  subscriptionId: string | null
): Promise<void> {
  if (!subscriptionId) return;

  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  if (user.stripeSubscriptionId && user.stripeSubscriptionId !== subscriptionId) {
    return;
  }

  const db = getDb();
  const tier = user.tier as Tier;
  const allocation = TIER_MONTHLY_TOKENS[tier];

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  if (monthlyRemaining > 0) {
    const rolloverAmount = Math.min(monthlyRemaining, allocation);

    await db
      .update(users)
      .set({
        addonTokens: sql`${users.addonTokens} + ${rolloverAmount}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    if (rolloverAmount > 0) {
      const rolloverBalance = await getTotalBalance(user.id);
      await db.insert(creditTransactions).values({
        userId: user.id,
        transactionType: 'rollover',
        amount: rolloverAmount,
        balanceAfter: rolloverBalance,
        source: `renewal_rollover:${tier}`,
        referenceId: invoiceId,
      });
    }
  }

  await db
    .update(users)
    .set({
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
    source: `renewal:${tier}`,
    referenceId: invoiceId,
  });
}

/**
 * Handle a failed invoice payment.
 */
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
    userId: user.id,
    transactionType: 'adjustment',
    amount: 0,
    balanceAfter: balance,
    source: `payment_failed:attempt_${attemptCount}`,
    referenceId: invoiceId,
  });

  if (nextPaymentAttempt) {
    console.warn(
      `[billing] Payment failed for user ${user.id}, attempt ${attemptCount}. ` +
      `Next retry: ${nextPaymentAttempt.toISOString()}`
    );
  } else {
    console.warn(
      `[billing] Payment failed for user ${user.id}, attempt ${attemptCount}. ` +
      `No further retries scheduled -- subscription will be cancelled by Stripe.`
    );
  }
}

/**
 * Handle a charge being refunded (full or partial) (PF-480, PF-734).
 *
 * Looks up the original token purchase via paymentIntentId, then deducts
 * tokens proportionally to the refund amount based on the *purchase* token
 * count (not the user's current balance). Uses the tokenPurchases.refundedCents
 * column for idempotency across multiple partial refunds.
 */
export async function handleChargeRefunded(
  customerId: string,
  chargeId: string,
  amountRefunded: number,
  amountTotal: number,
  paymentIntentId?: string | null
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  if (amountTotal <= 0 || amountRefunded <= 0) return;

  await reverseAddonTokens(user.id, chargeId, amountRefunded, amountTotal, paymentIntentId);
}

/**
 * Reverse addon tokens proportionally to a refund amount (PF-480, PF-734).
 *
 * Looks up the original token purchase via paymentIntentId to determine how
 * many tokens were granted for that specific charge. Calculates the
 * proportional deduction from the *purchase* token count, not from the
 * user's current addon balance. Uses tokenPurchases.refundedCents to track
 * cumulative refunds and prevent double-deduction on duplicate webhooks.
 *
 * Falls back to the legacy balance-based calculation when no matching
 * purchase record is found (e.g. for non-addon charges).
 */
export async function reverseAddonTokens(
  userId: string,
  chargeId: string,
  amountRefunded: number,
  amountTotal: number,
  paymentIntentId?: string | null
): Promise<void> {
  const db = getDb();

  // --- Try to find the original token purchase for precise reversal ---
  if (paymentIntentId) {
    const [purchase] = await db
      .select()
      .from(tokenPurchases)
      .where(
        and(
          eq(tokenPurchases.userId, userId),
          eq(tokenPurchases.stripePaymentIntent, paymentIntentId)
        )
      )
      .limit(1);

    if (purchase) {
      // Idempotency: calculate only the *new* refund increment.
      // Stripe sends cumulative amount_refunded, so we subtract what
      // we've already processed.
      const newRefundCents = amountRefunded - purchase.refundedCents;
      if (newRefundCents <= 0) return; // Already fully processed

      // Proportional tokens based on the purchase's token count
      const refundRatio = Math.min(newRefundCents / purchase.amountCents, 1);
      const tokensToDeduct = Math.floor(purchase.tokens * refundRatio);

      if (tokensToDeduct <= 0) return;

      // Read current addon balance to clamp
      const [user] = await db
        .select({ addonTokens: users.addonTokens })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) return;

      const clampedDeduction = Math.min(tokensToDeduct, user.addonTokens);

      // Update refundedCents on the purchase for idempotency tracking
      await db
        .update(tokenPurchases)
        .set({ refundedCents: amountRefunded })
        .where(eq(tokenPurchases.id, purchase.id));

      if (clampedDeduction > 0) {
        await db
          .update(users)
          .set({
            addonTokens: sql`GREATEST(0, ${users.addonTokens} - ${clampedDeduction})`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }

      const balance = await getTotalBalance(userId);
      await db.insert(creditTransactions).values({
        userId,
        transactionType: 'adjustment',
        amount: -clampedDeduction,
        balanceAfter: balance,
        source: `charge_refunded:${chargeId}`,
        referenceId: chargeId,
      });
      return;
    }
  }

  // --- Fallback: no purchase record found (non-addon charge or legacy) ---
  // Check idempotency via existing credit transaction for this chargeId
  const [existingRefund] = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.userId, userId),
        eq(creditTransactions.referenceId, chargeId),
        eq(creditTransactions.source, `charge_refunded:${chargeId}`)
      )
    )
    .limit(1);

  if (existingRefund) return; // Already processed this charge

  const [user] = await db
    .select({ addonTokens: users.addonTokens })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  // Calculate proportional token deduction from current balance (legacy)
  const refundRatio = Math.min(amountRefunded / amountTotal, 1);
  const tokensToDeduct = Math.floor(user.addonTokens * refundRatio);

  if (tokensToDeduct <= 0) return;

  const clampedDeduction = Math.min(tokensToDeduct, user.addonTokens);

  await db
    .update(users)
    .set({
      addonTokens: sql`GREATEST(0, ${users.addonTokens} - ${clampedDeduction})`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const balance = await getTotalBalance(userId);
  await db.insert(creditTransactions).values({
    userId,
    transactionType: 'adjustment',
    amount: -clampedDeduction,
    balanceAfter: balance,
    source: `charge_refunded:${chargeId}`,
    referenceId: chargeId,
  });
}

/**
 * Get the total token balance for a user (monthly remaining + addon + earned).
 *
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
