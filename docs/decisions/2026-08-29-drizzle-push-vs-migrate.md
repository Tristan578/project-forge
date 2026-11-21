# Retain `drizzle-kit push` for production schema changes

- **Date:** 2026-08-29
- **Status:** Accepted
- **Context:** #9456 (production `drizzle-kit push` with no backup, no dry run, and
  a code-only rollback)
- **Supersedes:** nothing. This records a decision that was previously implicit.

## Decision

Production schema changes continue to be applied with `drizzle-kit push` from
`.github/workflows/cd.yml`, **not** with versioned SQL (`drizzle-kit generate` +
`drizzle-kit migrate`). The safety that `migrate` would have provided is supplied
instead by the surrounding pipeline steps introduced in #9456:

1. a retained pre-migration Neon snapshot branch,
2. a dry run against a throwaway branch cloned from production,
3. a destructive-diff gate that blocks the job,
4. a post-apply convergence check,
5. a rollback path that says plainly what it does and does not revert.

Issue #9456's first acceptance criterion offers exactly this alternative: versioned
SQL **or** "a documented decision [that] records why push is retained". This is that
document.

## Why not `generate` + `migrate`

### 1. The migration journal is not in a state `migrate` can use

`web/drizzle/meta/_journal.json` lists **11 entries** (`0000_large_mephisto` through
`0010_graph_retrieval_nodes_edges`), but `web/drizzle/meta/` contains exactly **one**
snapshot file, `0000_snapshot.json`.

`drizzle-kit generate` diffs the new schema against the *latest* snapshot. With
snapshots 0001–0010 missing, the next `generate` would diff against the state as of
`0000` and emit a migration that re-creates ten migrations' worth of objects. Running
that against production would be catastrophic, and running `migrate` at all would
first try to replay a journal whose migrations were never recorded in the
`__drizzle_migrations` table (they were applied by `push`).

Repairing this is a real, separable piece of work — it means reconstructing ten
snapshots from history or re-baselining the journal against live production — and it
is not something to attempt inside a P0 production-safety fix.

### 2. Some migrations cannot be modelled by drizzle at all

`cd.yml` already carries a second, hand-authored SQL step ("Apply custom SQL
migrations") for exactly this reason. Drizzle cannot express:

- `CREATE INDEX CONCURRENTLY` (and it may not run inside a transaction, so it also
  cannot be batched),
- partial unique indexes with a `WHERE` predicate,
- `CREATE EXTENSION` for pgvector, which `push` needs but never emits, despite
  emitting `vector(1536)` columns that depend on it.

Moving to `migrate` would not remove that step; it would leave two independent
migration mechanisms running against production instead of one.

### 3. `migrate` fails against a database that was built by `push`

`drizzle-kit migrate` records applied migrations in `__drizzle_migrations`. The
production database's schema was created and evolved with `push`, so that table
either does not exist or does not reflect reality. `migrate` would attempt to apply
`0000` onward against a database that already has every object, failing on the first
`CREATE TABLE`.

### 4. This was already learned the hard way

`memory/project_lessons_learned.md` #51 ("Use drizzle-kit push (not migrate) in CD
when dev uses db:push") records a production deploy that failed at
`drizzle-kit migrate` — the spinner hung and the step exited 1, because the
migrations table had no record of schema that `push` had applied. Its prescribed
fix is exactly the `drizzle-kit push --force` this pipeline uses. Switching to
`migrate` now would re-open that incident.

## What we accept by keeping `push`

`push` is a schema-diff tool with three properties that make it unsafe *unsupervised*
(all verified against `node_modules/drizzle-kit/bin.cjs`, drizzle-kit 0.31.10, and
documented at the top of `scripts/db-migration-guard.sh`):

1. `pgPush` wraps its body in `try { ... } catch (e) { console.error(e) }` with no
   `process.exit(1)` — **every failure still exits 0**.
2. The Postgres apply path is a bare `for` loop with **no transaction** (the SQLite
   path does `begin`/`commit`; the Postgres path does not) — a failure part-way
   leaves a half-migrated schema.
3. On a data-loss diff without `--force` it renders an interactive prompt; hanji's
   `render()` rejects when there is no TTY, that rejection lands in (1), and the
   migration is **silently skipped** while the deploy proceeds.

These are not hypothetical: before #9456 the pipeline ran bare `npx drizzle-kit push`
and would have shipped green in all three cases.

The mitigations, all in `cd.yml`:

| Hazard | Mitigation |
|---|---|
| exits 0 on failure | the apply's exit code is ignored; `db-migration-guard.sh verify` re-runs `push` and requires "No changes detected" |
| untransacted apply | same convergence check; a partial apply reports `NOT_CONVERGED` and fails the job |
| silent skip on data loss | `--force` on the production apply (no prompt to swallow), preceded by an explicit destructive-diff gate |
| no backup | pre-migration Neon snapshot branch, created before any production mutation, id echoed to log and job summary |
| never rehearsed | dry run against a throwaway branch cloned from production data |
| code-only rollback | the rollback step states that the schema was NOT reverted and points at the restore runbook |

## Residual risk

- The snapshot is a restore *point*, not an automatic restore. Reverting the schema
  discards every write since the snapshot, so it stays a human decision
  (`docs/operations/deploy-migration-rollback.md`).
- The dry run rehearses against a clone taken moments earlier, not against the exact
  bytes the production apply will see. A write landing in that window could still
  make the production apply behave differently (e.g. a `SET NOT NULL` on a column
  that acquires a NULL in between).
- The destructive-diff detector is a text classifier over `drizzle-kit`'s own output.
  A future drizzle-kit release that changes those strings would degrade it. The
  markers it matches are pinned by `scripts/__tests__/db-migration-guard.test.sh`,
  and the version is pinned in `package-lock.json`, but a dependency bump is the
  moment to re-check.

## Revisit when

Any of these makes `generate` + `migrate` the better option, and this decision should
be reopened:

- `web/drizzle/meta/` is repaired or re-baselined so `generate` produces correct
  diffs,
- production is re-baselined into `__drizzle_migrations`,
- the hand-authored SQL step is folded into the journal.

Tracked as follow-up work in #9456's discussion; not in scope for that PR.

## References

- `scripts/db-migration-guard.sh` — classifier and the full hazard write-up
- `scripts/neon-branch.sh` — snapshot create / delete / prune
- `docs/operations/deploy-migration-rollback.md` — restore runbook
- `.github/workflows/cd.yml` — `deploy-production`
