-- Stripe billing meters: claim-before-emit protocol columns (PF-978 / #8970).
--
-- Adds token_usage.meter_attempted_at and token_usage.metered_at — both
-- nullable timestamps used by web/src/lib/billing/meterEvents.ts to report
-- net-confirmed generation usage to a Stripe billing meter without any
-- Stripe call on the request path. meter_attempted_at is set by a guarded
-- UPDATE ... WHERE meter_attempted_at IS NULL immediately before the
-- meterEvents.create call (the "claim"); metered_at is set only after that
-- call confirms success. NULL/NULL is the default state for every existing
-- row and for all rows while BILLING_METERS_ENABLED is unset — this
-- migration alone has zero behavioral effect. See specs/stripe-billing-meters.md
-- section 4 for the full claim/repair-state rules.
--
-- Idempotent (IF NOT EXISTS) per the 0006/0008 convention.
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "meter_attempted_at" timestamp with time zone;
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "metered_at" timestamp with time zone;
