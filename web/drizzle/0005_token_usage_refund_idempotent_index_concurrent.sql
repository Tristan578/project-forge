-- Idempotency for token refunds under concurrency (#8662, PF-838) — STEP 2 of 2.
-- Enforce one refund row per (user_id, operation, refundedUsageId) over the
-- refund/partial_refund subset of token_usage. The matching ON CONFLICT clause in
-- refundTokens / refundTokenAmount (lib/tokens/service.ts) makes concurrent refunds
-- for the same usageId credit exactly once.
--
-- token_usage is a high-write table (every AI generation appends a row). A plain
-- CREATE UNIQUE INDEX takes a SHARE lock for the duration of a full table scan,
-- blocking all writes for the lock window — proportional to TABLE size, not to the
-- small partial-predicate result. CONCURRENTLY avoids that lock, mirroring
-- 0002_credit_txn_idempotent_index. The trade-offs of CONCURRENTLY:
--   - It must NOT run inside a transaction (Postgres requirement). The neon-http
--     migrator issues each .sql file as stateless HTTP statements (no surrounding
--     BEGIN/COMMIT), so this runs un-wrapped — same as 0002.
--   - If duplicate keys still exist it leaves an INVALID index. 0004 dedups first;
--     run 0004 before this file.
-- @see https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "uq_token_usage_refund_idempotent"
  ON "token_usage" ("user_id", "operation", ((metadata->>'refundedUsageId')))
  WHERE "operation" IN ('refund', 'partial_refund');
