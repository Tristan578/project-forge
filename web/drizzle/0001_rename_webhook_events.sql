-- Rename table from processed_webhook_events to webhook_events
ALTER TABLE "processed_webhook_events" RENAME TO "webhook_events";--> statement-breakpoint

-- Add source column (text, NOT NULL, defaults to 'stripe' for existing rows)
ALTER TABLE "webhook_events" ADD COLUMN "source" text NOT NULL DEFAULT 'stripe';--> statement-breakpoint

-- Rename processed_at to claimed_at (more accurate: row is inserted at claim time, not completion)
ALTER TABLE "webhook_events" RENAME COLUMN "processed_at" TO "claimed_at";--> statement-breakpoint

-- Add expires_at column (timestamp with time zone, NOT NULL, default 72h from now)
ALTER TABLE "webhook_events" ADD COLUMN "expires_at" timestamp with time zone NOT NULL DEFAULT (NOW() + interval '72 hours');
