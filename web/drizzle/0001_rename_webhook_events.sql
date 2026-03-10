-- Rename processed_webhook_events to webhook_events and add source/expires_at columns.
-- The schema now uses 'webhook_events' with additional columns for multi-source
-- idempotency (Stripe + Clerk) and automatic TTL-based expiry.

ALTER TABLE "processed_webhook_events" RENAME TO "webhook_events";--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "source" text NOT NULL DEFAULT 'stripe';--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "expires_at" timestamp with time zone NOT NULL DEFAULT (NOW() + interval '72 hours');
