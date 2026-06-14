/**
 * Admin comp-tier token grant (#8744).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The alpha is paid-only: an approved tester is comped a paid tier by an admin
 * setting `users.tier` via `PATCH /api/admin/users/[id]`. Before this module
 * that PATCH wrote the tier column alone — it granted NO tokens. Because
 * `createGenerationHandler` meters every `/api/generate/*` call through the
 * platform token path, a comped "pro" user holding 0 tokens was blocked at the
 * very first generation, so the 5-10 minute "idea -> playable game" journey
 * never started. A tier with no tokens is a tier in name only.
 *
 * WHAT IT DOES
 * ------------
 * `applyAdminTierChange` performs the tier change AND the token grant as one
 * atomic `neonSql.transaction([...])` (neon-http; `db.transaction()` throws),
 * mirroring the subscription-lifecycle grant idiom:
 *   1. UPDATE users — set the new tier, ABSOLUTE-set monthly_tokens to the new
 *      tier's full allocation, reset monthly_tokens_used, stamp a fresh billing
 *      cycle, and fold the optional `banned` flag into the same write.
 *   2. INSERT a `credit_transactions` audit row (type 'adjustment') whose
 *      balance_after is read from the LIVE addon_tokens + earned_credits at
 *      execution time (INSERT...SELECT), not a stale JS snapshot.
 *
 * Absolute-set (not upgrade-diff) is deliberate: a comped-from-zero user would
 * be under-granted by a difference calculation, and an absolute set makes a
 * repeated PATCH balance-idempotent — re-comping the same tier lands the same
 * spendable balance rather than stacking.
 *
 * Idempotency: each admin action is an intentional one-shot, so reference_id is
 * `<grantedByClerkId>:<ISO timestamp>` — unique per call so a legitimately
 * repeated old->new tier change is NOT collapsed by the partial unique index on
 * (user_id, source, reference_id). `ON CONFLICT DO NOTHING` is kept purely as a
 * defensive backstop; unlike the webhook handlers there is no `NOT EXISTS` gate
 * (admin edits are not redelivered events).
 *
 * Caller contract: invoke ONLY when the tier actually changes. A banned-only or
 * same-tier edit must stay a plain UPDATE in the route — calling this on a
 * no-op tier change would re-grant a full allocation and wipe accrued spend.
 */

import { getNeonSql, queryWithResilience } from '@/lib/db/client';
import type { Tier } from '@/lib/db/schema';
import { TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

export interface AdminTierChangeOptions {
  /**
   * The user's tier BEFORE this change. Passed in (not re-read) because the
   * route already loaded the user for its 404 + tier-changed check — this
   * avoids a redundant read and makes the audit `source` deterministic.
   */
  previousTier: Tier;
  /** Clerk ID of the admin performing the change (for the audit reference_id). */
  grantedByClerkId: string;
  /**
   * Optional ban-state change to fold into the same atomic write.
   * `true` -> banned=1, `false` -> banned=0, omitted -> preserve the column.
   */
  banned?: boolean;
}

/**
 * Apply an admin tier change: set the tier, grant the new tier's full monthly
 * allocation, and write an audit row — atomically. See module header for the
 * full rationale and the caller contract (only call on a real tier change).
 */
export async function applyAdminTierChange(
  userId: string,
  newTier: Tier,
  options: AdminTierChangeOptions
): Promise<void> {
  const neonSql = getNeonSql();
  const allocation = TIER_MONTHLY_TOKENS[newTier];
  const now = new Date().toISOString();

  // null -> COALESCE preserves the existing column; 1/0 -> explicit set.
  // The ::int cast guards neon-http's text-param type inference for the null.
  const bannedParam = options.banned === undefined ? null : options.banned ? 1 : 0;

  const source = `admin_tier_change:${options.previousTier}->${newTier}`;
  // Unique per admin action so repeated old->new changes each record (and the
  // idempotency index never collapses two distinct intentional grants).
  const referenceId = `${options.grantedByClerkId}:${now}`;

  // balance_after is computed via INSERT...SELECT so addon_tokens and
  // earned_credits are read at execution time. The UPDATE runs first but does
  // not touch those columns, so the SELECT reads their correct current values.
  await queryWithResilience(() =>
    neonSql.transaction([
      neonSql`
        UPDATE users
        SET tier                = ${newTier},
            monthly_tokens      = ${allocation},
            monthly_tokens_used = 0,
            billing_cycle_start = ${now},
            banned              = COALESCE(${bannedParam}::int, banned),
            updated_at          = ${now}
        WHERE id = ${userId}
      `,
      neonSql`
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${userId}, 'adjustment', ${allocation},
               ${allocation} + addon_tokens + earned_credits,
               ${source}, ${referenceId}
        FROM users WHERE id = ${userId}
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
      `,
    ])
  );
}
