-- Idempotency for token add-on purchases (audit 2026-05-30, F02).
-- creditAddonTokens previously credited addon_tokens on every Stripe webhook
-- delivery. Stripe redelivers webhooks (retries, at-least-once), so a redelivered
-- token-purchase event double-credited the user. The fix gates the credit on a
-- UNIQUE constraint over stripe_payment_intent + ON CONFLICT DO NOTHING.
--
-- Step 1: remove pre-existing duplicate purchase rows so the UNIQUE index can be
-- built. These duplicates are the audit footprint of the very bug being fixed.
-- We keep the earliest row per payment_intent (min created_at, then min id) and
-- delete the rest. NOTE: this normalises the purchase *records* only — it does
-- NOT reverse any addon_tokens that were over-credited before this migration.
-- Balance reconciliation for affected users is tracked separately (see PR body).
DELETE FROM "token_purchases" a
USING "token_purchases" b
WHERE a."stripe_payment_intent" = b."stripe_payment_intent"
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );
--> statement-breakpoint
-- Step 2: enforce one purchase row per Stripe payment_intent. token_purchases is
-- low-volume append-only, so a plain (non-CONCURRENTLY) unique index is fine and
-- — unlike CONCURRENTLY — is safe to run inside the migration transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_token_purchases_payment_intent"
  ON "token_purchases" ("stripe_payment_intent");
