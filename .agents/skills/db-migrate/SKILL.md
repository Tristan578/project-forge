---
name: db-migrate
description: Drizzle schema change workflow for SpawnForge Neon DB. Use when modifying schema.ts, generating migrations, applying migrations to production, or debugging FK/cascade issues.
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep, Edit
argument-hint: "[action: generate|push|migrate|validate|status]"
paths: "web/src/lib/db/**"
---

# Database Migration Workflow

Safe database schema changes for SpawnForge (Drizzle ORM + Neon Postgres).

## Before ANY Schema Change

1. Read the current schema: `web/src/lib/db/schema.ts`
2. Read lessons learned — FK constraint bugs have caused real incidents (PF-976, PF-974)
3. Identify ALL tables that reference the table being modified

## Actions

### `validate` (default when no args)

Check schema for common issues:

```bash
cd web

# 1. Check for FK references without onDelete cascade
grep -n "references.*=>" src/lib/db/schema.ts | grep -v "onDelete"

# 2. Check deleteUserAccount cascade covers all tables with user_id FK
grep -n "user_id\|userId" src/lib/db/schema.ts | grep "references"
# Compare with:
grep -n "DELETE FROM\|delete(" src/lib/auth/user-service.ts

# 3. Check for tables with FKs not in the delete cascade
echo "--- Tables with user_id FK ---"
grep -B5 "userId.*references.*users" src/lib/db/schema.ts | grep "pgTable"
echo "--- Tables deleted in deleteUserAccount ---"
grep "DELETE FROM\|\.delete(" src/lib/auth/user-service.ts | grep -oE "'[a-z_]+'" | sort -u

# 4. Validate schema compiles
npx tsc --noEmit src/lib/db/schema.ts 2>&1 | head -20
```

### `generate`

Generate a migration from schema changes:

```bash
cd web

# 1. Validate schema first
npx tsc --noEmit

# 2. Generate migration SQL
npx drizzle-kit generate

# 3. Review the generated SQL
ls -t drizzle/*.sql | head -1 | xargs cat

# 4. CHECK: Does the migration add a new table with a user_id FK?
#    If yes, it MUST be added to deleteUserAccount cascade in user-service.ts
```

### `push` (dev only — direct schema push, no migration file)

```bash
cd web && npx drizzle-kit push
```

Use only for local development. Never in production.

### `migrate` (production — applies migration files)

```bash
cd web && npx drizzle-kit migrate
```

### `status`

```bash
cd web && npx drizzle-kit status
```

## FK Cascade Checklist

When adding a new table with `user_id` or any FK to `users.id`:

1. Add `DELETE FROM <table> WHERE user_id = ${userId}` to `deleteUserAccount()` in `web/src/lib/auth/user-service.ts`
2. Place the DELETE statement BEFORE the parent table's DELETE (dependency order)
3. If the new table has its own FK children, delete those first
4. Add the table to the schema test in `web/src/lib/db/__tests__/schema.test.ts`

## Common Pitfalls

- **Missing FK in delete cascade**: Adding a table with `userId.references(() => users.id)` without updating `deleteUserAccount()` — user deletion fails silently
- **Wrong delete order**: Deleting a parent before its FK children causes constraint violations
- **Non-nullable FK without onDelete**: Postgres defaults to RESTRICT, blocking parent deletion
- **Transaction atomicity**: Multi-table mutations must use `sql.transaction([...statements])` — individual statements are not atomic together

## Neon-Specific

- Use `neon-http` driver (stateless HTTP), not WebSocket driver
- Transactions: `sql.transaction([stmt1, stmt2, ...])` — array of tagged template literals
- No connection pooling needed — each request is independent
- Schema lives in `web/src/lib/db/schema.ts`, client in `web/src/lib/db/client.ts`
