---
"web": patch
---

Apply production schema changes with migrations instead of `drizzle-kit push`.

`cd.yml` pushed `schema.ts` straight onto production on every schema-touching deploy. `drizzle-kit push` exits 0 on failure, applies without a transaction, and silently skips a destructive diff in CI, so four migrations' worth of tables, columns and indexes never landed and nothing went red — including two unique indexes guarding the credit and refund paths against double-processing.

Production now applies recorded migrations and records them, a drift check runs immediately afterwards and again daily, and `db:push` refuses a migrate-managed database.
