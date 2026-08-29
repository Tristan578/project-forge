# Runbook: deploy failed after the migration step

**Scope:** the `deploy-production` job in `.github/workflows/cd.yml` applied a schema
migration to the production Neon database, and something after that point failed —
the deploy, the health check, the smoke tests, or the application itself once live.

**Read this first:** `vercel promote` (the automatic rollback in `cd.yml`) reverts
**code only**. It does **not** revert the database schema. After an automatic
rollback you are running the *previous* code against the *new* schema. That
combination is often fine (additive migrations) and occasionally fatal
(a renamed or dropped column the old code still selects).

---

## 0. What the pipeline already did for you

Every production deploy that touches `web/src/lib/db/schema*` or `web/drizzle/`
creates a **pre-migration Neon snapshot branch** before anything mutates the
database. Its id is in three places:

- the job log, as a `::notice::` line: `Pre-migration snapshot branch br-... (db-snapshot-<run id>-<sha>)`
- the **job summary**, under "Pre-migration database snapshot"
- the rollback step's output, if the automatic rollback fired

The branch name is always `db-snapshot-<github run id>-<short sha>`. Snapshots are
pruned after **14 days**.

A Neon branch is a copy-on-write clone taken at the instant it was created, so it
holds the schema *and* the data as they were immediately before the migration.

---

## 1. Decide whether the schema actually needs reverting

Restoring the schema **discards every database write made since the snapshot** —
new signups, generated projects, credit transactions, Stripe webhook results.
On a busy production database that is usually worse than the bug you are fixing.

Prefer, in this order:

1. **Roll forward.** Ship a follow-up migration or a code fix. This is almost
   always correct for an additive migration (new table, new nullable column).
2. **Repair by hand.** If a single statement half-applied (the `pg` push loop is
   untransacted — see below), fix that one object directly.
3. **Restore from the snapshot.** Only when the migration destroyed data or made
   the schema unusable, and only with an explicit decision to accept the write
   loss.

---

## 2. Find the snapshot branch id

From the failed run's job summary, or from the API:

```bash
# Names only. Requires NEON_API_KEY / NEON_PROJECT_ID (also GitHub repo secrets).
curl -sS \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Accept: application/json' \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
| jq -r '.branches[] | select(.name | startswith("db-snapshot-")) | "\(.id)\t\(.name)\t\(.created_at)"' \
| sort -k3
```

Match `<github run id>` in the branch name against the failed workflow run.

---

## 3. Restore production from the snapshot (destructive)

This is the exact command. It restores the **default (production) branch** from the
snapshot branch, and keeps the pre-restore state as a new backup branch so the
restore itself is reversible.

```bash
# 1. Identify the production branch (the project's default branch).
PROD_BRANCH_ID=$(curl -sS \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Accept: application/json' \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
  | jq -r '.branches[] | select(.default == true) | .id')

# 2. Restore it FROM the pre-migration snapshot.
#    source_branch_id  = the db-snapshot-* branch from step 2
#    preserve_under_name = where the CURRENT (broken) production state is parked,
#                          so this restore can itself be undone.
curl -sS -X POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$PROD_BRANCH_ID/restore" \
  --data "$(jq -nc --arg s "$SNAPSHOT_BRANCH_ID" \
    '{source_branch_id: $s, preserve_under_name: "pre-restore-backup"}')"
```

Notes:

- `source_branch_id` is **required** — it names what you are restoring *from*.
- `preserve_under_name` is documented as optional in general, but **mandatory when
  the branch being restored has child branches**. Production always does here: the
  `db-snapshot-*` branch is its child. Supply it. It also means the restore is
  itself reversible — omitting it would throw the current state away irrecoverably.
- The restore is near-instant (metadata operation), but **open connections are
  dropped**. Expect a brief production error spike.
- Poll the returned operation to completion before declaring the restore done:

```bash
curl -sS -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/operations" \
  | jq -r '.operations[0] | "\(.action)\t\(.status)"'
```

---

## 4. After a schema restore, the code must match

The restored schema is the **old** schema. Make sure production is running the
code that matches it:

```bash
# The failed run logged the last-known-good URL as `prev_url`.
vercel promote "<prev_url>" --scope tnolan --token="$VERCEL_TOKEN"
```

If the automatic rollback already ran, this is already done — verify with
`vercel ls --scope tnolan` and by checking `https://www.spawnforge.ai/api/health`.

---

## 5. Why a "successful" migration step can still have half-failed

`drizzle-kit` 0.31.10's `pgPush` wraps its whole body in
`try { ... } catch (e) { console.error(e) }` with no `process.exit(1)`, and applies
statements in a bare loop with **no transaction** on the Postgres path. So:

- a migration that threw on statement 4 of 7 still exits **0**
- the first three statements are still applied

That is why `cd.yml` re-runs `drizzle-kit push` after the apply and classifies the
output with `scripts/db-migration-guard.sh verify`. A `NOT_CONVERGED` verdict means
the schema is **partially migrated** — do not retry blindly. Read the apply log
(`prod-push.log`, printed in the "Apply schema migration to production" step),
identify which statements landed, and fix forward or restore.

---

## 6. If the gate blocked the deploy (nothing was applied)

Verdict `DESTRUCTIVE_BLOCKED` in the job summary means the destructive-diff
detector refused the migration and **production was never touched**. There is
nothing to roll back. Either:

- change the schema so the diff is non-destructive (add a new column, backfill,
  drop the old one in a later deploy), or
- approve it deliberately. Pick the route that matches how the run starts —
  each approval is read only on its own trigger, so they are alternatives, not
  two levers you can mix:
  - **Run workflow** (`workflow_dispatch`) with
    `allow_destructive_migration = true`. Use this to re-approve a run that
    already blocked. The commit-message marker is *not* read on this trigger.
  - **push** a commit to `main` whose message contains
    `[allow-destructive-migration]`. The input is not read on this trigger.

  Either way an unapproved run fails closed — the gate blocks and production is
  never touched.

Approving means accepting that the snapshot branch is the only way back.

---

## Related

- `scripts/db-migration-guard.sh` — the classifier, and the full write-up of the
  three drizzle-kit hazards
- `scripts/neon-branch.sh` — snapshot create / delete / prune
- `docs/decisions/2026-08-29-drizzle-push-vs-migrate.md` — why we still use `push`
- `docs/operations/backup-recovery.md` — general Neon PITR guidance
- `docs/operations/incident-runbook.md` — broader incident process
