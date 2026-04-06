-- Partial unique index for idempotent credit transaction inserts (#8261).
-- Only enforces when reference_id IS NOT NULL — PostgreSQL treats NULL as
-- distinct in unique indexes, so without the WHERE clause, audit rows that
-- omit reference_id (deductCredits, grantMonthlyCredits, processRollover)
-- would bypass the constraint entirely. The partial index protects the
-- retry-sensitive paths that always supply a reference_id:
--   - handleInvoicePaymentFailed (subscription-lifecycle.ts)
--   - marketplace purchase (purchase/route.ts)
--   - refundCredits (creditManager.ts — uses NOT EXISTS guard too)
CREATE UNIQUE INDEX "idx_credit_txn_idempotent" ON "credit_transactions" ("user_id","source","reference_id") WHERE "reference_id" IS NOT NULL;
