---
"@spawnforge/web": patch
---

Fix P0 production blockers batch 1: update all AI model references to claude-*-4-6, consolidate hardcoded token costs into pricing.ts, add leaderboard management API routes (create/list/configure/delete), close leaderboard dedup TOCTOU (already fixed via atomic CTE).
