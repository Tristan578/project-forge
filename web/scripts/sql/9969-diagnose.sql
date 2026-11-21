-- 9969 — production schema drift diagnostic.
-- READ-ONLY. Creates nothing, changes nothing. Safe to run against production.
--
-- Run all four blocks in the Neon SQL console. Block 2 decides which repair
-- path applies, so do not skip it.

-- ── 1. How many application tables does production actually have? ────────────
-- This is the number `assertMigrationMayRun` reads as `applicationTableCount`.
SELECT count(*)::int AS public_base_tables
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';


-- ── 2. THE DECIDING QUESTION: does the migration journal exist, and is it
--       populated? Note the schema — it is `drizzle`, NOT `public`. ───────────
SELECT to_regclass('drizzle.__drizzle_migrations')::text AS journal_table;

-- If the above returns NULL, stop here and report it — the journal does not
-- exist at all. If it returns a name, run this:
SELECT count(*)::int AS journal_rows FROM drizzle.__drizzle_migrations;

-- And this, to see what it believes was applied:
SELECT id, hash, created_at,
       to_timestamp(created_at / 1000) AS created_at_readable
FROM drizzle.__drizzle_migrations
ORDER BY created_at;


-- ── 3. Which of the 32 ORM tables are missing? ───────────────────────────────
-- The list is generated from web/src/lib/db/schema.ts by a parser that asserts
-- its match count equals the number of pgTable( declarations (32 = 32), so it
-- cannot silently under-report the way the first two diffs on this issue did.
WITH expected(table_name) AS (
  VALUES
    ('api_keys'), ('asset_purchases'), ('asset_reviews'), ('cost_log'),
    ('credit_transactions'), ('featured_games'), ('feedback'), ('game_comments'),
    ('game_forks'), ('game_likes'), ('game_ratings'), ('game_reports'),
    ('game_tags'), ('generation_jobs'), ('graph_edges'), ('graph_nodes'),
    ('leaderboard_entries'), ('leaderboards'), ('marketplace_assets'),
    ('moderation_appeals'), ('projects'), ('provider_keys'), ('published_games'),
    ('seller_profiles'), ('tier_config'), ('token_config'), ('token_purchases'),
    ('token_usage'), ('user_follows'), ('users'), ('waitlist_signups'),
    ('webhook_events')
)
SELECT e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'present' END AS status
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_type   = 'BASE TABLE'
 AND t.table_name   = e.table_name
ORDER BY status DESC, e.table_name;


-- ── 4. Summary count, so the answer is one number rather than a scan ─────────
WITH expected(table_name) AS (
  VALUES
    ('api_keys'), ('asset_purchases'), ('asset_reviews'), ('cost_log'),
    ('credit_transactions'), ('featured_games'), ('feedback'), ('game_comments'),
    ('game_forks'), ('game_likes'), ('game_ratings'), ('game_reports'),
    ('game_tags'), ('generation_jobs'), ('graph_edges'), ('graph_nodes'),
    ('leaderboard_entries'), ('leaderboards'), ('marketplace_assets'),
    ('moderation_appeals'), ('projects'), ('provider_keys'), ('published_games'),
    ('seller_profiles'), ('tier_config'), ('token_config'), ('token_purchases'),
    ('token_usage'), ('user_follows'), ('users'), ('waitlist_signups'),
    ('webhook_events')
)
SELECT count(*) FILTER (WHERE t.table_name IS NOT NULL)::int AS present,
       count(*) FILTER (WHERE t.table_name IS NULL)::int     AS missing,
       count(*)::int                                          AS expected_total
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_type   = 'BASE TABLE'
 AND t.table_name   = e.table_name;
