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
import { featuresFromSummary } from '@/lib/billing/entitlements';

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
 *
 * Idempotent under Stripe at-least-once redelivery (#8711): BOTH the reset
 * UPDATE and the grant INSERT are gated on `NOT EXISTS` of the canonical
 * `subscription_created:%` anchor for this subscription id. The gate is keyed
 * on the SUBSCRIPTION ID, never the (mutable) tier — so a tier change between
 * an event's deliveries cannot defeat it. On first fire the anchor is absent,
 * so the UPDATE resets the cycle and the INSERT writes the anchor; on every
 * redelivery the committed anchor makes both a no-op, preserving any spend the
 * user accrued in between (an unconditional re-zero would refund that spend).
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
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions
            WHERE user_id = ${user.id}
              AND source LIKE 'subscription_created:%'
              AND reference_id = ${subscriptionId}
          )
      `,
      neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${user.id}, 'monthly_grant', ${allocation},
               ${allocation} + addon_tokens + earned_credits,
               ${`subscription_created:${tier}`}, ${subscriptionId}
        FROM users WHERE id = ${user.id}
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions
            WHERE user_id = ${user.id}
              AND source LIKE 'subscription_created:%'
              AND reference_id = ${subscriptionId}
          )
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
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
          ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
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
          ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
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
 * Idempotent under Stripe at-least-once redelivery (#8712) via the single-CTE
 * "audit INSERT is the arbiter" idiom: the cancellation audit row is written
 * first, gated on `NOT EXISTS` of any prior `cancellation:%` row for this
 * subscription id, and the reset UPDATE only runs `WHERE EXISTS (SELECT 1 FROM
 * audit)`. The anchor is keyed on the SUBSCRIPTION ID, never `previousTier`:
 * on redelivery `findUserByStripeCustomer` re-reads the now-starter tier, so a
 * tier-keyed source ('cancellation:starter->starter') would dodge the
 * exact-source ON CONFLICT and write a bogus duplicate audit row with a phantom
 * amount; the tier-independent gate blocks both the duplicate row AND the
 * re-zero (which would otherwise refund any starter-tier spend accrued between
 * deliveries). One atomic statement → no transaction array needed.
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

  // Single CTE: the audit INSERT reads pre-cancellation state (remaining
  // tokens, addon balance) and is the arbiter — the UPDATE cannot reset the
  // balance unless a fresh audit row was written this delivery.
  await queryWithResilience(() =>
    neonSql`
      WITH audit AS (
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${user.id}, 'adjustment',
               -GREATEST(0, monthly_tokens - monthly_tokens_used),
               ${starterAllocation} + addon_tokens + earned_credits,
               ${`cancellation:${previousTier}->starter`}, ${subscriptionId}
        FROM users WHERE id = ${user.id}
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions
            WHERE user_id = ${user.id}
              AND source LIKE 'cancellation:%'
              AND reference_id = ${subscriptionId}
          )
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        RETURNING id
      )
      UPDATE users
      SET tier                   = 'starter',
          stripe_subscription_id = NULL,
          monthly_tokens         = ${starterAllocation},
          monthly_tokens_used    = 0,
          updated_at             = ${now}
      WHERE id = ${user.id}
        AND EXISTS (SELECT 1 FROM audit)
    `
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
  // The pre-read snapshot is only a statement-count optimization (whether to
  // bother pushing the rollover CTE). It is NOT load-bearing for correctness:
  // the rollover's amount is computed in SQL (LEAST(remaining, allocation)) and
  // its idempotency is gated in SQL on the per-invoice `renewal:tier` grant row
  // (see the CTE below, #8709). So a redelivery that flips this flag back ON —
  // because the fresh read now shows remaining > 0 after the cycle reset — still
  // cannot leak a rollover. A concurrent deduction that exhausts remaining tokens
  // between the read and the transaction likewise just yields a 0-amount rollover.
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  const hasRollover = monthlyRemaining > 0;

  const statements: ReturnType<typeof neonSql>[] = [];

  if (hasRollover) {
    // Single data-modifying CTE so the audit INSERT is the *arbiter* of the
    // addon credit: the UPDATE adds only what the INSERT actually inserted.
    //
    // Idempotency is gated on the per-invoice renewal grant row via the
    // NOT EXISTS below — the SAME anchor the reset uses (#8611) — NOT on the
    // rollover's own `renewal_rollover:tier` row. Why this matters: when the
    // first fire has no remaining tokens (remaining == 0) the rollover statement
    // is skipped entirely (hasRollover is false), so the `renewal_rollover`
    // anchor is NEVER written — yet the reset + grant still run, marking the
    // invoice processed via the renewal grant. A later redelivery (after the user
    // spends part of the fresh allocation) sees remaining > 0, flips hasRollover
    // back ON, and — gated only on the missing `renewal_rollover` anchor — would
    // credit a free rollover into the non-expiring addon balance (#8709). Gating
    // on the always-written renewal grant row closes that: the grant
    // INSERT below runs AFTER this CTE, so on the FIRST fire the grant row does
    // not exist yet → NOT EXISTS is true → rollover runs; on ANY redelivery the
    // committed grant row makes NOT EXISTS false → the INSERT matches 0 rows,
    // RETURNING is empty, and COALESCE(...,0) makes the addon UPDATE a no-op.
    //
    // The gate matches `source LIKE 'renewal:%'`, NOT the tier-specific
    // `renewal:<tier>` literal (#8710): `tier` is read mutably from
    // `user.tier` at processing time, so if the user's tier changes between an
    // invoice's original delivery and a redelivery, a tier-keyed anchor would
    // differ ('renewal:pro' != the committed 'renewal:creator'), re-opening
    // every gate → double rollover + double grant. `'renewal:%'` is
    // tier-independent yet still excludes the rollover's own
    // `renewal_rollover:<tier>` rows: in a LIKE pattern the 8th char is a
    // literal ':' which cannot match the '_' in 'renewal_rollover', so only the
    // `renewal:<tier>` grant rows qualify. (Gating on reference_id alone is
    // wrong — `payment_failed:attempt_N` rows share the invoice id.)
    // (The `renewal_rollover` ON CONFLICT arbiter is retained as defence in depth
    // and to keep the audit row's own identity.) Both INSERT and UPDATE read the
    // same statement snapshot, so balance_after still reads pre-rollover addon.
    statements.push(neonSql`
      WITH rollover_ins AS (
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${user.id}, 'rollover',
               LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${allocation}),
               GREATEST(0, monthly_tokens - monthly_tokens_used) + addon_tokens + earned_credits
                 + LEAST(GREATEST(0, monthly_tokens - monthly_tokens_used), ${allocation}),
               ${`renewal_rollover:${tier}`}, ${invoiceId}
        FROM users WHERE id = ${user.id}
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions
            WHERE user_id      = ${user.id}
              AND source LIKE 'renewal:%'
              AND reference_id = ${invoiceId}
          )
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        RETURNING amount
      )
      UPDATE users
      SET addon_tokens = addon_tokens + COALESCE((SELECT amount FROM rollover_ins), 0),
          updated_at   = ${now}
      WHERE id = ${user.id}
    `);
  }

  // Reset monthly tokens for the new billing cycle.
  //
  // Gated on the renewal grant row so a REDELIVERED invoice.paid does not
  // re-zero monthly_tokens_used. Statements in a neonSql.transaction see prior
  // statements' effects, but the grant INSERT below runs AFTER this reset: on
  // the FIRST fire the grant row does not exist yet → NOT EXISTS is true → the
  // reset runs. On a redelivery the grant row from the first fire is already
  // committed → NOT EXISTS is false → the reset is skipped, preserving any
  // tokens the user spent since the original renewal (and not re-stamping
  // billing_cycle_start). Without this guard, spend interleaved between the
  // first fire and a redelivery is silently gifted back (monthly_tokens_used
  // reset to 0) — the same class of money bug as the rollover double-credit
  // (#8708) fixed above, on the reset half of the same handler.
  //
  // Matches `source LIKE 'renewal:%'` (tier-independent), NOT the mutable
  // `renewal:<tier>` literal, for the same reason as the rollover gate (#8710):
  // a tier change between deliveries must not re-open the reset.
  statements.push(neonSql`
    UPDATE users
    SET monthly_tokens      = ${allocation},
        monthly_tokens_used = 0,
        billing_cycle_start = ${now},
        updated_at          = ${now}
    WHERE id = ${user.id}
      AND NOT EXISTS (
        SELECT 1 FROM credit_transactions
        WHERE user_id      = ${user.id}
          AND source LIKE 'renewal:%'
          AND reference_id = ${invoiceId}
      )
  `);

  // Grant balance: reads addon_tokens (which now includes rollover) at execution time.
  //
  // Gated on the tier-independent `renewal:%` anchor (#8710): the ON CONFLICT
  // arbiter keys on (user_id, source, reference_id), so a cross-tier redelivery
  // whose source is 'renewal:pro' would NOT collide with the committed
  // 'renewal:creator' grant row and would write a SECOND grant for the same
  // invoice. The NOT EXISTS gate closes that — on any redelivery a prior
  // `renewal:%` row for this invoice makes the INSERT match 0 rows.
  statements.push(neonSql`
    INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
    SELECT ${user.id}, 'monthly_grant', ${allocation},
           ${allocation} + addon_tokens + earned_credits,
           ${`renewal:${tier}`}, ${invoiceId}
    FROM users WHERE id = ${user.id}
      AND NOT EXISTS (
        SELECT 1 FROM credit_transactions
        WHERE user_id      = ${user.id}
          AND source LIKE 'renewal:%'
          AND reference_id = ${invoiceId}
      )
    ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
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
    }).onConflictDoNothing()
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

  // Per-tranche idempotency key (#8706). Stripe fires `charge.refunded` once per
  // refund with a STABLE `charge.id` and a CUMULATIVE `amount_refunded`. Keying
  // the audit row on `chargeId` alone collides on `idx_credit_txn_idempotent`
  // when one charge is refunded incrementally (e.g. 2450c, then a cumulative
  // 4900c): the second clawback's audit INSERT hits the duplicate key, the whole
  // CTE rolls back, the deduction is permanently lost, and the webhook 500s into
  // an infinite Stripe retry. Suffixing the cumulative amount makes every tranche
  // a distinct key, so successive incremental refunds each record their own row.
  const refundRef = `${chargeId}:${amountRefunded}`;

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
      // increment and computes tokensToDeduct. The audit INSERT depends on the
      // claim (JOIN on `deduction`), and the user UPDATE depends on the audit
      // (`EXISTS (SELECT 1 FROM audit)`), so a balance change is impossible
      // without a matching credit_transactions row. The `EXISTS (audit)` gate is
      // load-bearing because of the #8706 `ON CONFLICT ... DO NOTHING` backstop:
      // when the audit INSERT is swallowed by a pre-existing row for the same
      // (user, source, reference_id), the audit CTE is empty and the deduction
      // is suppressed — mirroring the fallback path. Without it, an ON CONFLICT
      // hit would silently debit the balance with no audit row.
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
                 ${`charge_refunded:${chargeId}`}, ${refundRef}
          FROM deduction d, users u
          WHERE u.id = ${userId} AND d.tokens_to_deduct > 0
          ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
          RETURNING id
        )
        UPDATE users
        SET addon_tokens = GREATEST(0, addon_tokens - d.tokens_to_deduct),
            updated_at   = ${now}
        FROM deduction d
        WHERE users.id = ${userId} AND d.tokens_to_deduct > 0
          AND EXISTS (SELECT 1 FROM audit)
        RETURNING users.id
      `
      );
      // If claim matched 0 rows (already refunded), the entire CTE chain
      // produces no rows — done.
      //
      // Edge case — amount_cents=0 (comped purchase): NULLIF(amount_cents,0)
      // yields NULL, so the division is NULL and LEAST(NULL, 1) collapses to 1
      // (Postgres LEAST/GREATEST ignore NULL args). The deduction is therefore
      // FLOOR(tokens * 1) = ALL of the purchase's tokens (capped at the user's
      // addon balance), i.e. a full clawback of the comped grant — NOT a no-op.
      // Reviewed as acceptable: refunding a comped purchase reclaims the tokens
      // it granted. (Behaviour locked by the real-DB test, #8608.)
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
  // Fix: CTE INSERT...WHERE NOT EXISTS checks and inserts in one statement.
  // The user UPDATE depends on the INSERT via EXISTS, so it only runs when
  // the INSERT actually created a row.
  //
  // NOT EXISTS alone is NOT concurrency-safe (#8729): it is a snapshot-level
  // read, so two CONCURRENT deliveries of the same `charge.refunded` webhook
  // can both pass it, and the loser then raises a unique violation on
  // `idx_credit_txn_idempotent` — a loud 500/retry instead of a no-op. The
  // `ON CONFLICT (user_id, source, reference_id) ... DO NOTHING` arbiter on
  // the audit INSERT (mirroring the precise path, #8706) degrades that loser
  // to a clean no-op: the audit CTE returns no rows, so the dependent user
  // UPDATE is suppressed and no deduction happens without an audit row. The
  // NOT EXISTS is kept as the cheap snapshot-level fast path for ordinary
  // sequential redelivery.
  //
  // NOTE: integer-typed bound params (`${amountRefunded}`, `${amountTotal}`) MUST
  // be cast (`::bigint`). The neon-http driver sends bound params as text with no
  // type annotation; without a cast Postgres can mis-infer the type from the
  // surrounding integer columns and throw `invalid input syntax for type
  // integer`. (The original `::float8` cast bug was caught by the real-DB test,
  // #8608; the same class applies to the integer math below.)
  //
  // Incremental refunds on this fallback path (no purchase row to anchor exact
  // token proportions) reconstruct a STABLE original base from the FIRST tranche
  // we already recorded, rather than re-applying the cumulative ratio to the
  // shrinking CURRENT balance (#8706). Each fallback audit row stores the
  // cumulative refunded cents in its `reference_id` (`<chargeId>:<cents>`) and the
  // tokens it clawed in `amount`, so for a later tranche:
  //
  //     base   = total * prior_clawed / prior_cum_cents   (independent of `cur`)
  //     target = ratio * base = amountRefunded * prior_clawed / prior_cum_cents
  //     delta  = target - prior_clawed                    (clamped >=0, <= cur)
  //
  // The `total` cancels, so the target is exact integer math with no float. Because
  // the base is derived from the recorded clawback (NOT the live balance), a spend
  // OR a NEW addon purchase landing between webhook deliveries can never inflate
  // the clawback — `delta` is capped at the cumulative target and at `cur`, so the
  // path NEVER over-deducts. A true redelivery (same cumulative amount) yields
  // delta 0 AND fails the NOT EXISTS guard; an out-of-order lower cumulative yields
  // a negative delta clamped to 0. The first tranche (no prior rows) falls back to
  // a ratio of the current balance, identical to the single-refund behavior.
  const source = `charge_refunded:${chargeId}`;
  const now = new Date().toISOString();

  await queryWithResilience(() =>
    neonSql`
      WITH prior AS (
        -- Aggregate this charge's prior fallback clawbacks. source is
        -- charge-specific (it embeds the chargeId), so it scopes precisely; the
        -- LIKE '%:%' filter excludes any legacy chargeId-only rows that predate
        -- the per-tranche key so split_part always has a cents segment to parse.
        SELECT
          COALESCE(SUM(ABS(ct.amount)), 0)::int AS clawed_tokens,
          COALESCE(MAX(split_part(ct.reference_id, ':', 2)::bigint), 0)::bigint AS cum_cents
        FROM credit_transactions ct
        WHERE ct.user_id = ${userId}
          AND ct.source = ${source}
          AND ct.reference_id LIKE '%:%'
      ),
      calc AS (
        SELECT u.addon_tokens AS cur, p.clawed_tokens, p.cum_cents
        FROM users u CROSS JOIN prior p
        WHERE u.id = ${userId}
      ),
      deduction AS (
        SELECT GREATEST(0, LEAST(
          CASE
            WHEN c.clawed_tokens > 0 AND c.cum_cents > 0
              THEN (${amountRefunded}::bigint * c.clawed_tokens / c.cum_cents)::int - c.clawed_tokens
            ELSE (c.cur::bigint * ${amountRefunded}::bigint / NULLIF(${amountTotal}::bigint, 0))::int
          END,
          c.cur
        ))::int AS to_deduct
        FROM calc c
      ),
      audit AS (
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${userId}, 'adjustment',
               -(SELECT to_deduct FROM deduction),
               GREATEST(0, u.monthly_tokens - u.monthly_tokens_used)
                 + GREATEST(0, u.addon_tokens - (SELECT to_deduct FROM deduction))
                 + u.earned_credits,
               ${source}, ${refundRef}
        FROM users u
        WHERE u.id = ${userId}
          AND (SELECT to_deduct FROM deduction) > 0
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.user_id = ${userId}
              AND ct.reference_id = ${refundRef}
              AND ct.source = ${source}
          )
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
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
 * Handle a Stripe `entitlements.active_entitlement_summary.updated` event
 * (PF-911 / #8821).
 *
 * Stripe is the source of truth for which product features a customer is
 * entitled to; this replaces the hand-rolled tier→capability flags. The event
 * payload already carries the customer's full current entitlement set, so we
 * persist the active feature `lookup_key`s onto `users.active_features` directly
 * from the summary (no extra Active Entitlements API round-trip needed). The
 * web client then maps those keys onto canUseAI/canUseMCP/canPublish.
 *
 * Persistence is a single idempotent `neonSql` UPDATE keyed on the user's
 * stripe_customer_id — the event is authoritative and last-write-wins is correct
 * (every delivery carries the complete set, so re-applying a redelivered event
 * is a no-op). No credit_transactions audit row is written: this changes feature
 * gating, not token balances. Returns silently for orphan events (no matching
 * user) — matching every other lifecycle handler.
 *
 * The `summary` argument is the raw `event.data.object`; reading it defensively
 * lives in `featuresFromSummary`, so an empty/malformed payload persists `[]`
 * (an authoritative "no active features") rather than throwing.
 */
export async function handleEntitlementsUpdated(
  customerId: string,
  summary: unknown
): Promise<void> {
  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  const features = featuresFromSummary(summary);
  const neonSql = getNeonSql();
  const now = new Date().toISOString();

  // jsonb column: serialize the string[] so neon-http stores a JSON array, not
  // a Postgres text[]. ::jsonb cast makes the parameter binding unambiguous.
  await queryWithResilience(() =>
    neonSql`
      UPDATE users
      SET active_features = ${JSON.stringify(features)}::jsonb,
          updated_at      = ${now}
      WHERE id = ${user.id}
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
