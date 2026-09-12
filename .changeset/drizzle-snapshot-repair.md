---
"web": patch
---

Repair the Drizzle snapshot history so `drizzle-kit generate` emits correct incremental migrations.

The repo carried one snapshot against 13 journal entries. `generate` diffs against the latest snapshot, so it was twelve migrations stale — and rather than merely emitting a destructive diff, it stalled on an interactive rename prompt, threw for want of a TTY, and exited 0 having written nothing.

`0012_snapshot.json` now describes the current schema. Adding one nullable column and running `generate` produces exactly that one `ALTER TABLE`.
