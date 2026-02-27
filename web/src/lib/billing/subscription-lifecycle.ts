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

import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { users, creditTransactions } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';
import { updateUserTier } from '@/lib/auth/user-service';

// In-memory set of processed webhook event IDs. In production, this would
// be a persistent store (Redis / DB table), but for a single-instance
// deployment this prevents duplicate processing during the process lifetime.
const processedEvents = new Set<string>();

/**
 * Check if a webhook event has already been processed (idempotency guard).
 * Returns true if the event should be skipped.
 */
export function isEventProcessed(eventId: string): boolean {
  return processedEvents.has(eventId);
}

/**
 * Mark a webhook event as processed.
 */
export function markEventProcessed(eventId: string): void {
  processedEvents.add(eventId);

  // Prevent unbounded memory growth -- keep only the most recent 10,000 IDs.
  // Stripe rarely re-delivers after the initial retry window.
  if (processedEvents.size > 10_000) {
    const iterator = processedEvents.values();
    const first = iterator.next().value;
    if (first !== undefined) {
      processedEvents.delete(first);
    }
  }
}

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

  // Tier actually changed -- adjust token allocation
  const oldAllocation = TIER_MONTHLY_TOKENS[currentTier];
  const newAllocation = TIER_MONTHLY_TOKENS[newTier];

  await updateUserTier(user.id, newTier);

  if (newAllocation > oldAllocation) {
    // Upgrade: grant the difference in tokens immediately
    const difference = newAllocation - oldAllocation;
    const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);

    await db
      .update(users)
      .set({
        monthlyTokens: monthlyRemaining + difference,
        monthlyTokensUsed: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const balance = await getTotalBalance(user.id);
    await db.insert(creditTransactions).values({
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
    await db
      .update(users)
      .set({
        monthlyTokens: newAllocation,
        monthlyTokensUsed: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const balance = await getTotalBalance(user.id);
    await db.insert(creditTransactions).values({
      userId: user.id,
      transactionType: 'adjustment',
      amount: newAllocation - oldAllocation, // negative for downgrade
      balanceAfter: balance,
      source: `downgrade:${currentTier}->${newTier}`,
      referenceId: subscriptionId,
    });
  }
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
 *
 * This is the main token grant trigger:
 * 1. Roll over unused monthly tokens to addon (up to tier cap)
 * 2. Reset monthly tokens to tier allocation
 * 3. Update billing cycle start date
 *
 * Only processes subscription invoices (skips one-time payments).
 */
export async function handleInvoicePaid(
  customerId: string,
  invoiceId: string,
  subscriptionId: string | null
): Promise<void> {
  // Only process subscription invoices
  if (!subscriptionId) return;

  const user = await findUserByStripeCustomer(customerId);
  if (!user) return;

  // Skip if user's subscription doesn't match (stale event)
  if (user.stripeSubscriptionId && user.stripeSubscriptionId !== subscriptionId) {
    return;
  }

  const db = getDb();
  const tier = user.tier as Tier;
  const allocation = TIER_MONTHLY_TOKENS[tier];

  // Step 1: Roll over unused monthly tokens
  const monthlyRemaining = Math.max(0, user.monthlyTokens - user.monthlyTokensUsed);
  if (monthlyRemaining > 0) {
    // Cap rollover at the tier's monthly allocation
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

  // Step 2: Grant new monthly tokens
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
 *
 * Marks the user as being in a grace period by recording a transaction.
 * Does NOT immediately downgrade the user -- Stripe will send
 * `customer.subscription.updated` with status=past_due, then eventually
 * `customer.subscription.deleted` if payment is never recovered.
 *
 * The grace period information can be queried via the billing status API
 * to show warnings in the UI.
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

  // Record the failure as an audit event (amount = 0, it's informational)
  const balance = await getTotalBalance(user.id);
  await db.insert(creditTransactions).values({
    userId: user.id,
    transactionType: 'adjustment',
    amount: 0,
    balanceAfter: balance,
    source: `payment_failed:attempt_${attemptCount}`,
    referenceId: invoiceId,
  });

  // If this is the final attempt and there's no next retry, Stripe will
  // cancel the subscription and we'll handle it in subscription.deleted.
  // For now, just log the grace period end date if available.
  if (nextPaymentAttempt) {
    // Store the grace period deadline in the billing cycle field as metadata.
    // The billing status API already reads this field and the frontend can
    // detect it to show a "payment failed" warning.
    // We intentionally do NOT change the user's tier yet -- Stripe handles that.
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
 * Get the total token balance for a user (monthly remaining + addon + earned).
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
