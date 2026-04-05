-- Add unique index for idempotent credit transaction inserts.
-- Prevents duplicate audit records when queryWithResilience retries
-- after a commit-but-no-ack transient failure (#8261).
CREATE UNIQUE INDEX "idx_credit_txn_idempotent" ON "credit_transactions" ("user_id","source","reference_id");
