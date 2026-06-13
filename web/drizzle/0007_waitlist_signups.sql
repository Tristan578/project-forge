-- Waitlist capture (#8730).
--
-- /sign-up's marketing CTAs promise a waitlist but the page only offered a
-- mailto link; this table is where POST /api/waitlist stores the leads.
-- Sign-ups themselves stay disabled (product decision) — this is lead
-- capture only, so there is deliberately no user_id FK (email only) and no
-- deleteUserAccount cascade change is needed.
--
-- Email is normalized (trim + toLowerCase) by the API BEFORE insert, so the
-- plain unique index on the raw column is the ON CONFLICT arbiter that makes
-- duplicate signups idempotent — no lower(email) expression index needed.
--
-- Idempotent (IF NOT EXISTS) per the 0006 convention, so re-running against
-- a DB that already carries the table is a no-op.
CREATE TABLE IF NOT EXISTS "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_waitlist_signups_email" ON "waitlist_signups" ("email");
