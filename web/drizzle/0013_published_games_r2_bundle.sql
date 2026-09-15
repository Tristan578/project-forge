-- Published-game R2 bundle key (#7580 / PF-2).
--
-- Adds published_games.cdn_bundle_key: the R2 object key of the game bundle
-- written on publish (`games/{clerkId}/{slug}/bundle.json`). NULL for every
-- pre-existing row and for any publish where the mirror was off or failed —
-- those keep being served from projects.scene_data. When set, /play reads the
-- bundle from R2 first and falls back to Postgres on any read failure.
--
-- Idempotent (IF NOT EXISTS) per the 0006 convention, same as 0011/0012.
ALTER TABLE "published_games" ADD COLUMN IF NOT EXISTS "cdn_bundle_key" text;
