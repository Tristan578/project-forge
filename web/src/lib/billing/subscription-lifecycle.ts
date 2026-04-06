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
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
import { users, creditTransactions, tokenPurchases } from '@/lib/db/schema';
import type { Tier, User } from '@/lib/db/schema';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

/**
 * Helper: look up a user by their Stripe customer ID.
 * Returns null if no user is found (graceful handling for orphan events).
 */
export async function findUserByStripeCustomer(customerId: string): Promise<User | null> {
  const [user] = await queryWithResilience(() =>
    getDb()
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1)
  );
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
  await queryWithResilience(() =>
    neonSql.transaction([
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
    ])
  );
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
    await queryWithResilience(() =>
      neonSql`
        UPDATE users
        SET stripe_subscription_id = ${subscriptionId},
            updated_at             = ${now}
        WHERE id = ${user.id}
      `
    );
    return;
  }

  if (!tierChanged) {
    // No tier change -- update tier + subscription ID in case out of sync,
    // but don't reset tokens. Handles status changes like active -> trialing.
    await queryWithResilience(() =>
      neonSql`
        UPDATE users
        SET tier                   = ${newTier},
            stripe_subscription_id = ${subscriptionId},
            updated_at             = ${now}
        WHERE id = ${user.id}
      `
    );
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

    await queryWithResilience(() =>
      neonSql.transaction([
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
      ])
    );
  } else {
    // Downgrade: cap monthly tokens to new allocation, reset used counter.
    // User keeps any addon tokens they purchased.
    await queryWithResilience(() =>
      neonSql.transaction([
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
      ])
    );
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
  await queryWithResilience(() =>
    neonSql.transaction([
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
    ])
  );
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

  await queryWithResilience(() => neonSql.transaction(statements));
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

  const balance = await getTotalBalance(user.id);
  await queryWithResilience(() =>
    getDb().insert(creditTransactions).values({
      userId: user.id,
      transactionType: 'adjustment',
      amount: 0,
      balanceAfter: balance,
      source: `payment_failed:attempt_${attemptCount}`,
      referenceId: invoiceId,
    })
  );

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
  const neonSql = getNeonSql();

  // --- Try to find the original token purchase for precise reversal ---
  if (paymentIntentId) {
    const [purchase] = await queryWithResilience(() =>
      getDb()
        .select()
        .from(tokenPurchases)
        .where(
          and(
            eq(tokenPurchases.userId, userId),
            eq(tokenPurchases.stripePaymentIntent, paymentIntentId)
          )
        )
        .limit(1)
    );

    if (purchase) {
      // Atomic claim-then-deduct using a CTE (PF-7514 / #8187).
      //
      // Previous code had a TOCTOU race: it read purchase.refundedCents in JS,
      // computed tokensToDeduct in JS, then ran a 3-statement neonSql.transaction.
      // The claim UPDATE (statement 1) guarded with WHERE refunded_cents < X,
      // but statements 2-3 ran unconditionally — two concurrent webhooks both
      // reading stale refundedCents=0 would both deduct tokens.
      //
      // Fix: a single SQL statement where the CTE atomically claims the refund
      // increment and computes tokensToDeduct. The audit INSERT and user UPDATE
      // both depend on the claim via EXISTS/JOIN, so they only execute when the
      // claim actually succeeds.
      const now = new Date().toISOString();

      // Step 1: Read the old refunded_cents with FOR UPDATE (row lock).
      // Step 2: UPDATE only if the old value < amountRefunded (claim guard).
      // Step 3: Compute tokens_to_deduct from the delta (new - old).
      // Step 4: Audit INSERT + user UPDATE depend on deduction > 0.
      //
      // RETURNING reads post-UPDATE values, so we capture pre-UPDATE state
      // via a separate SELECT...FOR UPDATE CTE.
      await queryWithResilience(() =>
        neonSql`
        WITH old_state AS (
          SELECT refunded_cents, tokens, amount_cents
          FROM token_purchases
          WHERE id = ${purchase.id}
          FOR UPDATE
        ),
        claim AS (
          UPDATE token_purchases
          SET refunded_cents = ${amountRefunded}
          FROM old_state
          WHERE token_purchases.id = ${purchase.id}
            AND old_state.refunded_cents < ${amountRefunded}
          RETURNING old_state.refunded_cents AS old_refunded_cents,
                    old_state.tokens,
                    old_state.amount_cents
        ),
        deduction AS (
          SELECT FLOOR(
            claim.tokens * LEAST(
              (${amountRefunded}::int - claim.old_refunded_cents)::float
                / NULLIF(claim.amount_cents, 0),
              1
            )
          )::int AS tokens_to_deduct
          FROM claim
        ),
        audit AS (
          INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
          SELECT ${userId}, 'adjustment', -LEAST(d.tokens_to_deduct, u.addon_tokens),
                 GREATEST(0, u.monthly_tokens - u.monthly_tokens_used) + GREATEST(0, u.addon_tokens - d.tokens_to_deduct) + u.earned_credits,
                 ${`charge_refunded:${chargeId}`}, ${chargeId}
          FROM deduction d, users u
          WHERE u.id = ${userId} AND d.tokens_to_deduct > 0
          RETURNING id
        )
        UPDATE users
        SET addon_tokens = GREATEST(0, addon_tokens - d.tokens_to_deduct),
            updated_at   = ${now}
        FROM deduction d
        WHERE users.id = ${userId} AND d.tokens_to_deduct > 0
        RETURNING users.id
      `
      );
      // If claim matched 0 rows (already refunded), the entire CTE chain
      // produces no rows — done. If amount_cents=0 (comped purchase),
      // NULLIF returns NULL and the deduction rounds to 0, skipping audit+update.
      return;
    }
  }

  // --- Fallback: no purchase record found (non-addon charge or legacy) ---
  // Atomic idempotent deduction using a CTE (PF-7514 / #8187).
  //
  // Previous code had a TOCTOU race: SELECT for existingRefund, then INSERT
  // if not found. Two concurrent webhooks could both see "no existing refund"
  // and both insert + deduct.
  //
  // Fix: CTE INSERT...WHERE NOT EXISTS atomically checks and inserts. The
  // user UPDATE depends on the INSERT via EXISTS, so it only runs when the
  // INSERT actually created a row.
  const refundRatio = Math.min(amountRefunded / amountTotal, 1);
  const source = `charge_refunded:${chargeId}`;
  const now = new Date().toISOString();

  await queryWithResilience(() =>
    neonSql`
      WITH audit AS (
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${userId}, 'adjustment',
               -LEAST(FLOOR(u.addon_tokens * ${refundRatio})::int, u.addon_tokens),
               GREATEST(0, u.monthly_tokens - u.monthly_tokens_used)
                 + GREATEST(0, u.addon_tokens - FLOOR(u.addon_tokens * ${refundRatio})::int)
                 + u.earned_credits,
               ${source}, ${chargeId}
        FROM users u
        WHERE u.id = ${userId}
          AND FLOOR(u.addon_tokens * ${refundRatio})::int > 0
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.user_id = ${userId}
              AND ct.reference_id = ${chargeId}
              AND ct.source = ${source}
          )
        RETURNING amount
      )
      UPDATE users
      SET addon_tokens = GREATEST(0, addon_tokens - ABS((SELECT amount FROM audit))),
          updated_at   = ${now}
      WHERE id = ${userId}
        AND EXISTS (SELECT 1 FROM audit)
    `
  );
}

/**
 * Get the total token balance for a user (monthly remaining + addon + earned).
 *
 * Used by handleInvoicePaymentFailed which doesn't need transactional writes.
 */
async function getTotalBalance(userId: string): Promise<number> {
  const [user] = await queryWithResilience(() =>
    getDb()
      .select({
        monthlyTokens: users.monthlyTokens,
        monthlyTokensUsed: users.monthlyTokensUsed,
        addonTokens: users.addonTokens,
        earnedCredits: users.earnedCredits,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  );

  if (!user) return 0;
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  return monthlyRemaining + user.addonTokens + user.earnedCredits;
}
