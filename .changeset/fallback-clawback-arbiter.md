---
"web": patch
---

Fix the fallback refund-clawback path in `reverseAddonTokens` so concurrent redelivery of the same `charge.refunded` webhook degrades to a clean no-op instead of a unique violation. The fallback audit INSERT was guarded only by a snapshot-level `NOT EXISTS` subquery; two concurrent deliveries could both pass it, and the loser then collided with the `idx_credit_txn_idempotent` partial unique index, failing the statement loudly (500/Stripe retry noise). The audit CTE now carries the same `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` arbiter the precise path already uses, with `NOT EXISTS` retained as the sequential-redelivery fast path; the dependent balance UPDATE stays suppressed whenever the audit row is swallowed, so no deduction can occur without its audit row. `refundCredits` in `creditManager.ts` carried the same NOT-EXISTS-only pattern on its `credit_refund` audit INSERT and receives the identical arbiter. (#8729)
