-- Partial unique index for idempotent credit transaction inserts (#8261).
-- PostgreSQL treats NULL values as distinct in unique indexes, so rows with
-- NULL reference_id would never conflict regardless. The WHERE clause excludes
-- those rows from the index entirely, reducing index size and write overhead.
-- Retry-sensitive paths that always supply a reference_id are protected:
--   - handleInvoicePaymentFailed (subscription-lifecycle.ts)
--   - marketplace purchase (purchase/route.ts)
--   - refundCredits (creditManager.ts — uses NOT EXISTS guard too)
CREATE UNIQUE INDEX "idx_credit_txn_idempotent" ON "credit_transactions" ("user_id","source","reference_id") WHERE "reference_id" IS NOT NULL;
