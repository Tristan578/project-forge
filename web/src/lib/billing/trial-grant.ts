/**
 * One-time trial token grant for brand-new accounts (PF-174 / #7715).
 *
 * A signed-up, non-paying user has `tier = 'starter'` and `monthly_tokens = 0`:
 * `syncUserFromClerk` only upserts identity columns, and the only writers of
 * `TIER_MONTHLY_TOKENS[tier]` are the Stripe subscription handlers, which fire
 * after the user already pays. So without this module a new user cannot use a
 * single AI panel until they subscribe.
 *
 * `grantTrialTokens` runs from the Clerk `user.created` webhook. Clerk delivers
 * at least once, and the route's own retry queue replays failures, so the grant
 * has to be idempotent. It is idempotent at the DATABASE, not in JavaScript:
 * the `credit_transactions` audit row (`source = 'trial_grant'`,
 * `reference_id = users.id`) is the arbiter, exactly like the payment-intent
 * row in `creditAddonTokens` and the refund row in `refundTokenAmount`
 * (`web/src/lib/tokens/service.ts`). A second invocation inserts nothing and
 * therefore updates nothing.
 */

import { getNeonSql, queryWithResilience } from '@/lib/db/client';
import { TRIAL_GRANT_TOKENS } from '@/lib/tokens/pricing';

/**
 * Grant the one-time trial token allocation to a brand-new user.
 *
 * Single-statement CTE: the INSERT into `credit_transactions` is gated on
 * `NOT EXISTS` of a prior `trial_grant` row for the user and guarded by
 * `ON CONFLICT ... DO NOTHING` against the partial unique index
 * `idx_credit_txn_idempotent` (`web/drizzle/0002_credit_txn_idempotent_index.sql`,
 * on `(user_id, source, reference_id) WHERE reference_id IS NOT NULL`), so even
 * two concurrent redeliveries insert at most one row. The `users` UPDATE runs
 * only when that INSERT returned a row. One statement commits or rolls back as
 * a unit — no transaction wrapper, and no `db.transaction()` (neon-http
 * throws on it).
 *
 * The `${userId}::uuid` casts are load-bearing (see `refundTokenAmount`):
 * neon-http binds template parameters as text, and without the cast the
 * ON CONFLICT arbiter inference against the uuid-typed index fails at runtime.
 *
 * `billing_cycle_start` is deliberately NOT set. The balance and status routes
 * derive "next refill" from it and nothing refills a trial account — only the
 * Stripe subscription handlers write a cycle start, which is what keeps the
 * Token Dashboard's "Next refill" honest for a free account (#7715 review).
 *
 * `transaction_type` reuses the existing `'monthly_grant'` enum value; there is
 * no `'trial'` value and adding one would need a migration this feature does
 * not. `source = 'trial_grant'` is the disambiguator, mirroring how the
 * subscription handlers pair `'monthly_grant'` with their own `source`.
 *
 * @param userId the INTERNAL `users.id` UUID returned by `syncUserFromClerk`,
 *   never the raw Clerk id.
 */
export async function grantTrialTokens(userId: string): Promise<void> {
  const neonSql = getNeonSql();
  const now = new Date().toISOString();

  await queryWithResilience(() =>
    neonSql`
      WITH grant_ins AS (
        INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)
        SELECT ${userId}::uuid, 'monthly_grant', ${TRIAL_GRANT_TOKENS},
               ${TRIAL_GRANT_TOKENS} + addon_tokens + earned_credits,
               'trial_grant', ${userId}
        FROM users
        WHERE id = ${userId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM credit_transactions
            WHERE user_id = ${userId}::uuid AND source = 'trial_grant'
          )
        ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
        RETURNING id
      )
      UPDATE users
      SET monthly_tokens      = ${TRIAL_GRANT_TOKENS},
          monthly_tokens_used = 0,
          updated_at          = ${now}
      WHERE id = ${userId}::uuid
        AND EXISTS (SELECT 1 FROM grant_ins)
    `
  );
}
