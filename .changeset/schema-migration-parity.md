---
"web": patch
---

Backfill all schema-to-migration drift (#8707) with migration 0006: `users.banned`, `token_purchases.refunded_cents`, `projects.theme`, `published_games.thumbnail`, the `idx_published_games_slug` index, and the `leaderboards`, `leaderboard_entries`, and `moderation_appeals` tables (plus their enums) now exist in the migration chain, not just via `db:push`. Every statement is idempotent, so the migration is a no-op against production while fully provisioning a fresh database. A new schema-migration parity test checks every schema.ts column and named index against a migrations-only PGlite, failing CI on any future drift; the test harness no longer carries reconciliation patches.
