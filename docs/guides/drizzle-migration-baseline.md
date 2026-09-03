# Drizzle migration baseline

SpawnForge databases created historically with `drizzle-kit push` can contain the application
schema without corresponding rows in `drizzle.__drizzle_migrations`. Never run
`npm run db:migrate` against such a database: Drizzle treats an empty journal as a fresh database
and attempts to replay migration `0000`.

Use the baseline tool from `web/`. It reads `DATABASE_URL` only from the process environment and
never prints it.

## Audit first

```bash
npm run db:baseline
```

Dry-run is the default. The command verifies every table and column exported by `schema.ts`, every
named index, and the data invariants established by the historical purchase/refund deduplication
migrations. Missing objects, duplicate historical rows, unknown journal timestamps, and hash
conflicts all fail closed without writing anything.

Review the JSON report. `schemaVerified: true` and a `missing` list mean the live schema satisfies
the migration chain but its bookkeeping is incomplete.

## Apply the baseline

```bash
npm run db:baseline -- --apply --confirm=BASELINE_VERIFIED_SCHEMA
```

The confirmation phrase is intentionally cumbersome. Apply mode writes the SHA-256 hash of each
exact SQL migration file with its `when` timestamp from `drizzle/meta/_journal.json`, using one
database transaction. Existing exact rows are preserved. Conflicting, duplicate, or unknown rows
are rejected.

Run the audit again, then run:

```bash
npm run db:migrate
```

With a complete baseline, migration should report no pending work. Run staging first, verify the
application and webhook paths, then repeat the independently reviewed procedure for production.

## Recovery

Do not delete or hand-edit journal rows to silence a failure. Export the journal and schema audit
output, identify the first mismatch, and repair the actual schema or migration file through a
reviewed change. A baseline records that historical postconditions are already satisfied; it does
not execute or undo application migrations.

Keep database URLs in the environment provider or a temporary local environment file outside the
repository. Never place them in CLI arguments, logs, issues, commits, or pull requests.

`npm run db:migrate` includes an automatic preflight. It permits a truly fresh database and a
database with recorded migration history, but refuses a non-empty database whose journal is
missing or empty. This prevents the original unsafe-replay failure mode even when an operator
forgets to run the audit manually.
