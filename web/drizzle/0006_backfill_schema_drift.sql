-- Backfill schema.ts ↔ migration-chain drift (#8707).
--
-- Everything below already exists in production — it arrived via `drizzle-kit
-- push` without a migration file, so any database provisioned purely from
-- migration history (fresh CI DB, disaster-recovery restore, new region) was
-- missing it. The full drift list was derived by schemaMigrationParity.db.test.ts,
-- which replays this chain into PGlite and selects every schema.ts column:
--
--   1. users.banned                  — read on the auth path (api-auth.ts
--                                      rejects banned > 0); added in 34c8018b.
--   2. token_purchases.refunded_cents — partial-refund money path (PF-526).
--   3. projects.theme                — editor theme persistence.
--   4. published_games.thumbnail     — game card art on play/community pages.
--   5. leaderboards                  — whole table + leaderboard_sort_order enum.
--   6. leaderboard_entries           — whole table.
--   7. moderation_appeals            — whole table + appeal_status enum.
--
-- Every statement is idempotent (IF NOT EXISTS / duplicate_object guard) so the
-- migration is a no-op against production while fully provisioning a fresh DB.
-- CREATE TYPE has no IF NOT EXISTS; the DO blocks swallow duplicate_object only.
DO $$ BEGIN
  CREATE TYPE "public"."leaderboard_sort_order" AS ENUM('desc', 'asc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."appeal_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD COLUMN IF NOT EXISTS "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "theme" text;--> statement-breakpoint
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "thumbnail" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leaderboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL CONSTRAINT "leaderboards_game_id_published_games_id_fk" REFERENCES "public"."published_games"("id") ON DELETE cascade ON UPDATE no action,
	"name" text NOT NULL,
	"sort_order" "leaderboard_sort_order" DEFAULT 'desc' NOT NULL,
	"max_entries" integer DEFAULT 100 NOT NULL,
	"min_score" integer,
	"max_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leaderboard_id" uuid NOT NULL CONSTRAINT "leaderboard_entries_leaderboard_id_leaderboards_id_fk" REFERENCES "public"."leaderboards"("id") ON DELETE cascade ON UPDATE no action,
	"player_name" text NOT NULL,
	"score" integer NOT NULL,
	"metadata" jsonb,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL CONSTRAINT "moderation_appeals_user_id_users_id_fk" REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
	"content_id" text NOT NULL,
	"content_type" text NOT NULL,
	"reason" text NOT NULL,
	"status" "appeal_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leaderboards_game_name" ON "leaderboards" ("game_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leaderboards_game" ON "leaderboards" ("game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leaderboard_entries_leaderboard_score" ON "leaderboard_entries" ("leaderboard_id","score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leaderboard_entries_leaderboard_created" ON "leaderboard_entries" ("leaderboard_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moderation_appeals_user" ON "moderation_appeals" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_moderation_appeals_status" ON "moderation_appeals" ("status");
