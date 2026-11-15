-- Viewer-initiated game reports + auto-hide bookkeeping (PF-681 / #8354).
--
-- Adds:
--   * published_games.report_count — monotonic count of DISTINCT reporters.
--     Bumped only when a game_reports row is actually inserted (the unique
--     index below is what makes "distinct" true), never decremented by an
--     admin approve, so the moderation history of a repeatedly-reported game
--     survives a restore.
--   * published_games.flagged_at — when the row first flipped to 'flagged'.
--     NULL for every pre-existing row and cleared again on admin approve /
--     successful appeal. A second reporter must NOT overwrite it, which is why
--     the report route's UPDATE guards the write with
--     `WHEN pg.status = 'published'`.
--   * game_report_reason enum + game_reports table.
--
-- uq_game_reports_reporter_game is load-bearing, not decorative: it is the
-- ON CONFLICT arbiter that makes a repeat report from the same account a no-op,
-- and therefore the ONLY defence against a single user inflating report_count
-- past the auto-hide threshold on their own. idx_game_reports_game mirrors the
-- game_ratings pattern (uq_game_ratings_user_game + idx_game_ratings_game) for
-- the admin queue's per-game lookups.
--
-- No ON DELETE CASCADE, matching every other published_games child table
-- (game_ratings, game_comments, game_likes). Account deletion removes these
-- rows explicitly in deleteUserAccount (web/src/lib/auth/user-service.ts) —
-- both the reports FILED BY the departing user and the reports FILED AGAINST
-- their games — and an admin "delete" is a soft-remove to 'unpublished', never
-- a row delete.
--
-- Idempotent (IF NOT EXISTS / DO $$ guards) per the 0006 convention.
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "report_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "flagged_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."game_report_reason" AS ENUM('sexual_content', 'violence', 'hate_speech', 'copyright', 'spam', 'other');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" "game_report_reason" NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "game_reports" ADD CONSTRAINT "game_reports_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "game_reports" ADD CONSTRAINT "game_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_game_reports_reporter_game" ON "game_reports" USING btree ("game_id","reporter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_game_reports_game" ON "game_reports" USING btree ("game_id");
