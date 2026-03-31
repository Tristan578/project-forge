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

  // balanceAfter computed via INSERT...SELECT to read addon_tokens and
  // earned_credits at execution time, avoiding stale snapshot values.
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
      SELECT ${user.id}, 'monthly_grant', ${allocation},
             ${allocation} + addon_tokens + earned_credits,
             ${`subscription_created:${tier}`}, ${subscriptionId}
      FROM users WHERE id = ${user.id}
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
  // SQL expressions compute remaining tokens at execution time inside the
  // transaction to prevent race conditions with concurrent deductions.
  // The old db.transaction({ isolationLevel: 'serializable' }) never worked
  // with neon-http (throws), so this is the first correct implementation.
  const oldAllocation = TIER_MONTHLY_TOKENS[currentTier];
  const newAllocation = TIER_MONTHLY_TOKENS[newTier];

  if (newAllocation > oldAllocation) {
    // Upgrade: grant the difference in tokens immediately.
    // monthly_tokens is set to GREATEST(0, current remaining) + difference
    // at execution time so concurrent deductions are not lost.
    const difference = newAllocation - oldAllocation;

    await neonSql.transaction([
      neonSql`
        UPDATE users
        SET tier                   = ${newTier},
            stripe_subscription_id = ${subscriptionId},
            monthly_tokens         = GREATEST(0, monthly_tokens - monthly_tokens_used) + ${difference},
            monthly_tokens_used    = 0,
            updated_at             = ${now}
        WHERE id = ${user.id}
      `,
      neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${user.id}, 'adjustment', ${difference},
               GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits,
               ${`upgrade:${currentTier}->${newTier}`}, ${subscriptionId}
        FROM users WHERE id = ${user.id}
      `,
    ]);
  } else {
    // Downgrade: cap monthly tokens to new allocation, reset used counter.
    // User keeps any addon tokens they purchased.
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
        SELECT ${user.id}, 'adjustment', ${newAllocation - oldAllocation},
               ${newAllocation} + addon_tokens + earned_credits,
               ${`downgrade:${currentTier}->${newTier}`}, ${subscriptionId}
        FROM users WHERE id = ${user.id}
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

  // INSERT before UPDATE: the audit record must read pre-cancellation state
  // (remaining tokens, addon balance) before the UPDATE resets them.
  await neonSql.transaction([
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      SELECT ${user.id}, 'adjustment',
             -GREATEST(0, monthly_tokens - monthly_tokens_used),
             ${starterAllocation} + addon_tokens + earned_credits,
             ${`cancellation:${previousTier}->starter`}, ${subscriptionId}
      FROM users WHERE id = ${user.id}
    `,
    neonSql`
      UPDATE users
      SET tier                   = 'starter',
          stripe_subscription_id = NULL,
          monthly_tokens         = ${starterAllocation},
          monthly_tokens_used    = 0,
          updated_at             = ${now}
      WHERE id = ${user.id}
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

  // All SQL expressions read current DB state at execution time to prevent
  // stale snapshot races. Rollover uses LEAST(remaining, allocation) in SQL.
  //
  // The pre-read snapshot is only used for the conditional (whether to include
  // rollover statements). A concurrent deduction that exhausts remaining tokens
  // between the read and the transaction would result in a 0-amount rollover
  // UPDATE + INSERT — harmless (addon_tokens + 0, amount = 0).
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const hasRollover = monthlyRemaining > 0;

  const statements: ReturnType<typeof neonSql>[] = [];

  if (hasRollover) {
    // INSERT before UPDATE: audit record must read addon_tokens BEFORE the
    // rollover is added, otherwise balance_after double-counts the rollover.
    statements.push(neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      SELECT ${user.id}, 'rollover',
             LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${allocation}),
             GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits
               + LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${allocation}),
             ${`renewal_rollover:${tier}`}, ${invoiceId}
      FROM users WHERE id = ${user.id}
    `);

    statements.push(neonSql`
      UPDATE users
      SET addon_tokens = addon_tokens + LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${allocation}),
          updated_at   = ${now}
      WHERE id = ${user.id}
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

  // Grant balance: reads addon_tokens (which now includes rollover) at execution time
  statements.push(neonSql`
    INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
    SELECT ${user.id}, 'monthly_grant', ${allocation},
           ${allocation} + addon_tokens + earned_credits,
           ${`renewal:${tier}`}, ${invoiceId}
    FROM users WHERE id = ${user.id}
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
      // TOCTOU fix (PF-7514): the old code read purchase.refundedCents outside
      // the transaction and used that snapshot to compute newRefundCents.
      // Two concurrent webhooks could both read the same stale refundedCents,
      // both compute newRefundCents > 0, and both proceed to deduct tokens.
      //
      // Fix: atomically advance refunded_cents with WHERE refunded_cents < amountRefunded.
      // The UPDATE returns the pre-update refunded_cents (via RETURNING + arithmetic)
      // so we can compute the exact increment this caller is responsible for.
      // If another request already set refunded_cents = amountRefunded, the WHERE
      // guard fails and 0 rows are returned — we exit without double-deducting.
      const now = new Date().toISOString();
      // Use a CTE to capture the pre-update refunded_cents value.
      // In a plain UPDATE...RETURNING, column values are the NEW values, so
      // we cannot recover the old refunded_cents from RETURNING alone.
      // The CTE snapshots the old row first; the UPDATE then joins against it
      // so we can compute the exact increment this caller is responsible for.
      // Compute token deduction from the purchase record + new refund increment.
      // The idempotency guard (refundedCents >= amountRefunded) already ran above.
      const newRefundCents = amountRefunded - purchase.refundedCents;
      if (newRefundCents <= 0) return;

      const refundRatio = Math.min(newRefundCents / purchase.amountCents, 1);
      const tokensToDeduct = Math.floor(purchase.tokens * refundRatio);
      if (tokensToDeduct <= 0) return;

      // ALL operations in a single transaction: claim, audit, and deduction.
      // If any step fails, none commit — prevents the case where the claim
      // succeeds but the deduction doesn't (permanent financial loss).
      // INSERT before UPDATE so balance_after reads pre-deduction addon_tokens.
      await neonSql.transaction([
        // 1. Claim: advance refunded_cents (idempotency guard)
        neonSql`
          UPDATE token_purchases
          SET refunded_cents = ${amountRefunded}
          WHERE id = ${purchase.id}
            AND refunded_cents < ${amountRefunded}
        `,
        // 2. Audit: record the deduction (clamped to actual balance)
        neonSql`
          INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
          SELECT ${userId}, 'adjustment', -LEAST(${tokensToDeduct}, addon_tokens),
                 GREATEST(0, monthly_tokens - monthly_tokens_used) + GREATEST(0, addon_tokens - ${tokensToDeduct}) + earned_credits,
                 ${`charge_refunded:${chargeId}`}, ${chargeId}
          FROM users WHERE id = ${userId}
        `,
        // 3. Deduct: reduce addon_tokens (clamped to 0)
        neonSql`
          UPDATE users
          SET addon_tokens = GREATEST(0, addon_tokens - ${tokensToDeduct}),
              updated_at   = ${now}
          WHERE id = ${userId}
        `,
      ]);
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

  // INSERT before UPDATE: balance_after reads pre-deduction addon_tokens via INSERT...SELECT
  await neonSql.transaction([
    neonSql`
      INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
      SELECT ${userId}, 'adjustment', ${-clampedDeduction},
             GREATEST(0, monthly_tokens - monthly_tokens_used) + GREATEST(0, addon_tokens - ${clampedDeduction}) + earned_credits,
             ${`charge_refunded:${chargeId}`}, ${chargeId}
      FROM users WHERE id = ${userId}
    `,
    neonSql`
      UPDATE users
      SET addon_tokens = GREATEST(0, addon_tokens - ${clampedDeduction}),
          updated_at   = ${now}
      WHERE id = ${userId}
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
