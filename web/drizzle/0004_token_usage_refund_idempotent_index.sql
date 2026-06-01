-- Idempotency for token refunds under concurrency (#8662, PF-838) — STEP 1 of 2.
-- refundTokens / refundTokenAmount previously guarded their refund INSERT with
-- WHERE NOT EXISTS. Under READ COMMITTED that is a snapshot check, NOT a lock:
-- two concurrent refunds for the same usageId can each miss the other's
-- uncommitted INSERT and both credit the user. The fix mirrors creditAddonTokens
-- (audit F02 / migration 0003): a UNIQUE partial index + ON CONFLICT DO NOTHING,
-- so the database serialises the second insert to a no-op and the credit fires
-- exactly once.
--
-- This migration (0004) removes pre-existing duplicate refund rows so the UNIQUE
-- index can be built. The index itself is created in 0005 with CONCURRENTLY, which
-- Postgres forbids inside a transaction — hence the two-file split: 0004 is the
-- transactional dedup, 0005 is the non-transactional index build. Run 0004 before
-- 0005.
--
-- The index is keyed per-operation: a 'refund' and a 'partial_refund' for the
-- same usageId remain independently idempotent (preserving the prior NOT EXISTS
-- semantics, which scoped on operation). The partial predicate keeps the index to
-- the small refund subset of token_usage and excludes the NULL refundedUsageId
-- rows of no-usageId partial refunds, which are intentionally non-idempotent.
--
-- A duplicate (user_id, operation, refundedUsageId) row is the audit footprint of
-- the very race being fixed. We keep the earliest row per key (min created_at, then
-- min id) and delete the rest. NOTE: this normalises the refund *records* only — it
-- does NOT reverse any tokens that were over-credited before this migration. Balance
-- reconciliation for affected users is tracked separately (see PR body).
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
