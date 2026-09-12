# Apply production schema changes with `migrate`, not `drizzle-kit push`

- **Date:** 2026-09-11
- **Status:** Accepted
- **Context:** #9969 (production schema drifted across four migrations, undetected), #9979
- **Supersedes:** `2026-08-29-drizzle-push-vs-migrate.md`

## Decision

`.github/workflows/cd.yml` applies production schema changes with `npm run db:migrate`.
The `drizzle-kit push --force` apply, the second push that verified convergence, and the
step that replayed every `drizzle/0*.sql` while swallowing `already exists` are all gone.

`npm run db:migrate` is the `--guard-migrate` preflight followed by
`web/scripts/apply-migrations.ts`.

## Why the previous decision is superseded rather than wrong

The 2026-08-29 ADR was correct when written. It kept `push` because `migrate` was not
usable, and it listed three conditions for reopening the decision. Two are now met and the
third is guarded.

### Condition: "production is re-baselined into `__drizzle_migrations`" — MET

Done on 2026-09-11 during the #9969 repair. `npm run db:baseline --apply` reported
`baselineVerified: true, rows: 13` after `assertSchemaMatches` verified all 32 tables,
every column and every index.

### Condition: "the hand-authored SQL step is folded into the journal" — MET, and it always was

The old ADR treated the "Apply custom SQL migrations" step as a second, independent
mechanism. It was not: that step globbed `drizzle/0*.sql`, which are the journal's own
migration files. `CREATE INDEX CONCURRENTLY`, partial unique indexes and
`CREATE EXTENSION` all already live in `0002`, `0005` and `0010`.

Verified rather than assumed: the full chain `0000`→`0012` was applied to a Neon branch
wiped to an empty schema on 2026-09-11 and produced 32 tables, 13 journal rows, the
`vector` extension, and **both** `CREATE INDEX CONCURRENTLY` indexes. The neon-http driver
issues each statement as its own request rather than wrapping a file in a transaction,
which is why `CONCURRENTLY` — illegal inside a transaction — applies cleanly.

That was the first end-to-end test this migration chain has ever had.

### Condition: "`drizzle/meta/` is repaired so `generate` produces correct diffs" — MET as of 2026-09-11 (#9983)

Originally unmet: `drizzle/meta/` held one snapshot for 13 journal entries, and
`drizzle-kit generate` diffs against the latest snapshot.

Measured while repairing it, the failure was worse than "emits a destructive diff".
`generate` reached `promptNamedWithSchemasConflict` resolving phantom renames, `render10`
threw for want of a TTY, and **drizzle-kit exited 0 having written nothing** — a silent
no-op, the same shape as the `push` this ADR moved off.

Repaired by squashing: `0012_snapshot.json` now describes the current schema, chained by
`prevId` to the original `0000`. Intermediate snapshots are history and drizzle-kit never
reads them. Proven rather than assumed — adding one nullable column to `schema.ts` and
running `generate` emits exactly `ALTER TABLE "waitlist_signups" ADD COLUMN "probe_tmp"
text;` and nothing else.

`scripts/assert-generate-safe.ts` is retained, with its test rewritten. Its first version
required one snapshot per journal entry, which the repair proved to be the wrong property —
the squashed history is healthy with 2 snapshots against 13 entries, and parity would have
refused it. It now asserts what drizzle-kit actually depends on: **the latest journal entry
has a snapshot beside it.** That can regress the moment someone commits a migration without
one, so the guard stays.

## The correction the old ADR could not have made

Its section 4 cited a past production deploy that failed at `drizzle-kit migrate` — "the
spinner hung and the step exited 1" — and concluded that `migrate` was the problem.

Reproduced on 2026-09-11 against a wiped Neon branch:

```
$ npx drizzle-kit migrate
Using '@neondatabase/serverless' driver for database querying
Warning  '@neondatabase/serverless' can only connect ... through a websocket
EXIT=1
```

Exit 1, no error message, nothing applied — 0 tables, 0 journal rows. Against the
**identical** URL and migration folder, `drizzle-orm`'s own migrator applied all 13
migrations successfully.

So the fault is in the `drizzle-kit` CLI, not in migrations and not in the journal. The
old ADR attributed the symptom to the wrong cause, which is why `apply-migrations.ts` uses
`drizzle-orm/neon-http/migrator` directly and never shells out to `drizzle-kit migrate`.

This is also the worst possible failure shape and worth naming: `drizzle-kit migrate`
reports success when there is nothing to do and fails silently when there is. It would pass
every rehearsal against an up-to-date database and fail the first time it mattered.

## What changes about the hazards

The old ADR's central argument was that `push`'s three hazards were survivable because
surrounding steps compensated. `migrate` does not have them:

| `push` hazard | Under `migrate` |
|---|---|
| `pgPush` catches everything and still exits 0 | `apply-migrations.ts` prints the error and its cause and exits non-zero |
| untransacted apply loop, partial schema on failure | each migration is a recorded unit; a failure stops the run and the journal shows exactly how far it got |
| silent skip on a data-loss prompt in CI | there is no prompt; the SQL is written and reviewed in the PR |

`scripts/db-migration-guard.sh` is retained. It still classifies the **dry-run** push
against a throwaway clone, which remains a valid answer to "is this change destructive?"
even though production no longer applies changes that way.

## Also changed, and worth reviewing on its own merits

Both new steps are **unconditional**. The old ones were gated on
`contains(needs.check-changes.outputs.web-changed-files, 'db/schema')`, so a deploy whose
changed-file set did not match that string applied nothing and reported nothing. That is a
silent-skip hazard of exactly the kind #9969 was made of. `migrate` is a no-op when the
journal is current, so running it on every production deploy costs one query and removes
the entire class.

The separate "Enable pgvector extension" step is deleted. It existed because `push` emits
`vector(1536)` columns but never `CREATE EXTENSION`; `0010` carries that statement as its
first line, ordered before `graph_nodes`.

## Residual risk

- **Snapshot history is still broken.** Guarded, not fixed. Until it is repaired, authoring
  a migration means writing the SQL by hand or overriding the guard and reviewing the diff.
- **The dry run rehearses `push`, while production applies `migrate`.** The classifier still
  answers the destructiveness question correctly, but it is no longer a rehearsal of the
  production command. Converting it is follow-up work.
- **First production `migrate` is unproven in situ.** It has been proven from zero on a
  branch and as a no-op against production, but not yet as an incremental apply on
  production. The drift check immediately after it is the detector for that.

## Revisit when

- ~~the snapshot history is repaired~~ — done 2026-09-11 (#9983); the guard was kept and
  re-pointed at the latest-entry property rather than deleted,
- the dry run is converted to rehearse `migrate`,
- `drizzle-kit migrate` gains a working neon path — then `apply-migrations.ts` could go,
  though the explicit error reporting is worth keeping regardless.

## References

- `web/scripts/apply-migrations.ts` — the applier, and why it avoids the CLI
- `web/scripts/check-schema-drift.ts` — the detector (#9980)
- `web/scripts/assert-push-allowed.ts` / `assert-generate-safe.ts` — the guards
- `scripts/db-migration-guard.sh` — retained dry-run classifier
- `docs/operations/deploy-migration-rollback.md` — restore runbook
