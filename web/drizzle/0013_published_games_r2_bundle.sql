-- Private publication snapshots. Existing rows remain on the legacy project
-- fallback until their next publication; no data is copied during migration.
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "cdn_bundle_key" text;
--> statement-breakpoint
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "published_scene_data" jsonb;
