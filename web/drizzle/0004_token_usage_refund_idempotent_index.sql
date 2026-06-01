-- Idempotency for token refunds under concurrency (#8662, PF-838).
-- refundTokens / refundTokenAmount previously guarded their refund INSERT with
-- WHERE NOT EXISTS. Under READ COMMITTED that is a snapshot check, NOT a lock:
-- two concurrent refunds for the same usageId can each miss the other's
-- uncommitted INSERT and both credit the user. The fix mirrors creditAddonTokens
-- (audit F02 / migration 0003): a UNIQUE partial index + ON CONFLICT DO NOTHING,
-- so the database serialises the second insert to a no-op and the credit fires
-- exactly once.
--
-- The index is keyed per-operation: a 'refund' and a 'partial_refund' for the
-- same usageId remain independently idempotent (preserving the prior NOT EXISTS
-- semantics, which scoped on operation). The partial predicate keeps the index to
-- the small refund subset of token_usage and excludes the NULL refundedUsageId
-- rows of no-usageId partial refunds, which are intentionally non-idempotent.
--
-- Step 1: remove pre-existing duplicate refund rows so the UNIQUE index can be
-- built. A duplicate (user_id, operation, refundedUsageId) row is the audit
-- footprint of the very race being fixed. We keep the earliest row per key (min
-- created_at, then min id) and delete the rest. NOTE: this normalises the refund
-- *records* only — it does NOT reverse any tokens that were over-credited before
-- this migration. Balance reconciliation for affected users is tracked separately
-- (see PR body).
DELETE FROM "token_usage" a
USING "token_usage" b
WHERE a."operation" IN ('refund', 'partial_refund')
  AND b."operation" IN ('refund', 'partial_refund')
  AND a."user_id" = b."user_id"
  AND a."operation" = b."operation"
  AND (a."metadata"->>'refundedUsageId') IS NOT NULL
  AND (b."metadata"->>'refundedUsageId') IS NOT NULL
  AND (a."metadata"->>'refundedUsageId') = (b."metadata"->>'refundedUsageId')
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );
--> statement-breakpoint
-- Step 2: enforce one refund row per (user_id, operation, refundedUsageId). The
-- partial predicate restricts the index to refund/partial_refund rows, so this is
-- a small index over a low-volume subset — a plain (non-CONCURRENTLY) index is
-- fine and, unlike CONCURRENTLY, is safe to run inside the migration transaction
-- alongside the Step 1 dedup.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_token_usage_refund_idempotent"
  ON "token_usage" ("user_id", "operation", ((metadata->>'refundedUsageId')))
  WHERE "operation" IN ('refund', 'partial_refund');
