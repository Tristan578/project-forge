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

import { and, eq } from 'drizzle-orm';
import { getDb, getNeonSql } from '@/lib/db/client';
import { users, creditTransactions, tokenPurchases } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

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
 *
 * All mutations are wrapped in a single neon sql.transaction() for
 * atomicity (PF-77). Balance is computed from the snapshot + planned
 * mutations since neon-http transactions don't support interactive SELECTs.
 */
export async function handleSubscriptionCreated(
  customerId: string,
  subscriptionId: string,
  tier: Tier
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const neonSql = getNeonSql();
  const allocation = TIER_MONTHLY_TOKENS[tier];
  const now = new Date().toISOString();

  // After this transaction: monthlyTokens = allocation, used = 0
  const balanceAfter = allocation + user.addonTokens + user.earnedCredits;

  await neonSql.transaction([
    neonSql`
      UPDATE users
      SET tier                   = ${tier},
          stripe_subscription_id = ${subscriptionId},
          monthly_tokens         = ${allocation},
          monthly_tokens_used    = 0,
          billing_cycle_start    = ${now},
          updated_at             = ${now}
      WHERE id = ${user.id}
    `,
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      VALUES (${user.id}, 'monthly_grant', ${allocation}, ${balanceAfter}, ${`subscription_created:${tier}`}, ${subscriptionId})
    `,
  ]);
}

/**
 * Handle a subscription being updated (plan change, status change, etc.).
 *
 * Key distinction from `handleSubscriptionCreated`:
 * - Only adjusts tokens when the tier actually changes
 * - On upgrade: grants the difference in token allocation immediately
 * - On downgrade: caps tokens to the new tier's allocation
 * - On status change only (same tier): no token change
 *
 * PF-77: Replaced broken db.transaction() (neon-http doesn't support it)
 * with neonSql.transaction(). All conditional logic is computed before
 * the transaction; only DML statements go inside.
 */
export async function handleSubscriptionUpdated(
  customerId: string,
  subscriptionId: string,
  newTier: Tier,
  subscriptionStatus: string
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const neonSql = getNeonSql();
  const now = new Date().toISOString();
  const currentTier = user.tier as Tier;
  const tierChanged = currentTier !== newTier;

  // If subscription is past_due or unpaid, only update the subscription ID
  // -- let the invoice.payment_failed handler deal with grace period
  if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid') {
    await neonSql`
      UPDATE users
      SET stripe_subscription_id = ${subscriptionId},
          updated_at             = ${now}
      WHERE id = ${user.id}
    `;
    return;
  }

  if (!tierChanged) {
    // No tier change -- update tier + subscription ID in case out of sync,
    // but don't reset tokens. Handles status changes like active -> trialing.
    await neonSql`
      UPDATE users
      SET tier                   = ${newTier},
          stripe_subscription_id = ${subscriptionId},
          updated_at             = ${now}
      WHERE id = ${user.id}
    `;
    return;
  }

  // Tier actually changed -- adjust token allocation atomically.
  const oldAllocation = TIER_MONTHLY_TOKENS[currentTier];
  const newAllocation = TIER_MONTHLY_TOKENS[newTier];
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);

  if (newAllocation > oldAllocation) {
    // Upgrade: grant the difference in tokens immediately
    const difference = newAllocation - oldAllocation;
    const newMonthlyTokens = monthlyRemaining + difference;
    const balanceAfter = newMonthlyTokens + user.addonTokens + user.earnedCredits;

    await neonSql.transaction([
      neonSql`
        UPDATE users
        SET tier                   = ${newTier},
            stripe_subscription_id = ${subscriptionId},
            monthly_tokens         = ${newMonthlyTokens},
            monthly_tokens_used    = 0,
            updated_at             = ${now}
        WHERE id = ${user.id}
      `,
      neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        VALUES (${user.id}, 'adjustment', ${difference}, ${balanceAfter}, ${`upgrade:${currentTier}->${newTier}`}, ${subscriptionId})
      `,
    ]);
  } else {
    // Downgrade: cap monthly tokens to new allocation, reset used counter
    // User keeps any addon tokens they purchased
    const balanceAfter = newAllocation + user.addonTokens + user.earnedCredits;

    await neonSql.transaction([
      neonSql`
        UPDATE users
        SET tier                   = ${newTier},
            stripe_subscription_id = ${subscriptionId},
            monthly_tokens         = ${newAllocation},
            monthly_tokens_used    = 0,
            updated_at             = ${now}
        WHERE id = ${user.id}
      `,
      neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        VALUES (${user.id}, 'adjustment', ${newAllocation - oldAllocation}, ${balanceAfter}, ${`downgrade:${currentTier}->${newTier}`}, ${subscriptionId})
      `,
    ]);
  }
}

/**
 * Handle a subscription being deleted (cancelled).
 *
 * - Reverts user to starter (free) tier
 * - Zeros out monthly tokens (addon tokens are preserved)
 * - Clears subscription ID
 * - Records an audit transaction
 *
 * All mutations atomic via neon sql.transaction() (PF-77).
 */
export async function handleSubscriptionDeleted(
  customerId: string,
  subscriptionId: string
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const neonSql = getNeonSql();
  const previousTier = user.tier as Tier;
  const starterAllocation = TIER_MONTHLY_TOKENS['starter'];
  const now = new Date().toISOString();

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const balanceAfter = starterAllocation + user.addonTokens + user.earnedCredits;

  await neonSql.transaction([
    neonSql`
      UPDATE users
      SET tier                   = 'starter',
          stripe_subscription_id = NULL,
          monthly_tokens         = ${starterAllocation},
          monthly_tokens_used    = 0,
          updated_at             = ${now}
      WHERE id = ${user.id}
    `,
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      VALUES (${user.id}, 'adjustment', ${-monthlyRemaining}, ${balanceAfter}, ${`cancellation:${previousTier}->starter`}, ${subscriptionId})
    `,
  ]);
}

/**
 * Handle a successful invoice payment (monthly renewal).
 *
 * All mutations (rollover + reset + grant) are atomic via
 * neon sql.transaction() (PF-77).
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

  const neonSql = getNeonSql();
  const tier = user.tier as Tier;
  const allocation = TIER_MONTHLY_TOKENS[tier];
  const now = new Date().toISOString();

  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const rolloverAmount = monthlyRemaining > 0
    ? Math.min(monthlyRemaining, allocation)
    : 0;

  // Build the statement batch. Order matters for balance computation.
  const statements: ReturnType<typeof neonSql>[] = [];

  if (rolloverAmount > 0) {
    // Rollover remaining tokens into addon bucket
    statements.push(neonSql`
      UPDATE users
      SET addon_tokens = addon_tokens + ${rolloverAmount},
          updated_at   = ${now}
      WHERE id = ${user.id}
    `);

    // Rollover balance: before the monthly reset, after addon increment
    const rolloverBalance = monthlyRemaining + (user.addonTokens + rolloverAmount) + user.earnedCredits;
    statements.push(neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      VALUES (${user.id}, 'rollover', ${rolloverAmount}, ${rolloverBalance}, ${`renewal_rollover:${tier}`}, ${invoiceId})
    `);
  }

  // Reset monthly tokens for the new billing cycle
  statements.push(neonSql`
    UPDATE users
    SET monthly_tokens      = ${allocation},
        monthly_tokens_used = 0,
        billing_cycle_start = ${now},
        updated_at          = ${now}
    WHERE id = ${user.id}
  `);

  // Grant balance: after reset, monthly = allocation, used = 0
  const grantBalance = allocation + (user.addonTokens + rolloverAmount) + user.earnedCredits;
  statements.push(neonSql`
    INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
    VALUES (${user.id}, 'monthly_grant', ${allocation}, ${grantBalance}, ${`renewal:${tier}`}, ${invoiceId})
  `);

  await neonSql.transaction(statements);
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
  const neonSql = getNeonSql();

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

      // Read current user state for clamping and balance computation
      const [user] = await db
        .select({
          addonTokens: users.addonTokens,
          monthlyTokens: users.monthlyTokens,
          monthlyTokensUsed: users.monthlyTokensUsed,
          earnedCredits: users.earnedCredits,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) return;

      const clampedDeduction = Math.min(tokensToDeduct, user.addonTokens);
      const now = new Date().toISOString();
      const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
      const balanceAfter = monthlyRemaining + (user.addonTokens - clampedDeduction) + user.earnedCredits;

      // Atomically update purchase tracking + deduct tokens + audit (PF-77)
      const statements: ReturnType<typeof neonSql>[] = [
        neonSql`
          UPDATE token_purchases
          SET refunded_cents = ${amountRefunded}
          WHERE id = ${purchase.id}
        `,
      ];

      if (clampedDeduction > 0) {
        statements.push(neonSql`
          UPDATE users
          SET addon_tokens = GREATEST(0, addon_tokens - ${clampedDeduction}),
              updated_at   = ${now}
          WHERE id = ${userId}
        `);
      }

      statements.push(neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        VALUES (${userId}, 'adjustment', ${-clampedDeduction}, ${balanceAfter}, ${`charge_refunded:${chargeId}`}, ${chargeId})
      `);

      await neonSql.transaction(statements);
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
    .select({
      addonTokens: users.addonTokens,
      monthlyTokens: users.monthlyTokens,
      monthlyTokensUsed: users.monthlyTokensUsed,
      earnedCredits: users.earnedCredits,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  // Calculate proportional token deduction from current balance (legacy)
  const refundRatio = Math.min(amountRefunded / amountTotal, 1);
  const tokensToDeduct = Math.floor(user.addonTokens * refundRatio);

  if (tokensToDeduct <= 0) return;

  const clampedDeduction = Math.min(tokensToDeduct, user.addonTokens);
  const now = new Date().toISOString();
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const balanceAfter = monthlyRemaining + (user.addonTokens - clampedDeduction) + user.earnedCredits;

  // Atomically deduct tokens + record audit (PF-77)
  await neonSql.transaction([
    neonSql`
      UPDATE users
      SET addon_tokens = GREATEST(0, addon_tokens - ${clampedDeduction}),
          updated_at   = ${now}
      WHERE id = ${userId}
    `,
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      VALUES (${userId}, 'adjustment', ${-clampedDeduction}, ${balanceAfter}, ${`charge_refunded:${chargeId}`}, ${chargeId})
    `,
  ]);
}

/**
 * Get the total token balance for a user (monthly remaining + addon + earned).
 *
 * Used by handleInvoicePaymentFailed which doesn't need transactional writes.
 */
async function getTotalBalance(userId: string): Promise<number> {
  const db = getDb();
  const [user] = await db
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
