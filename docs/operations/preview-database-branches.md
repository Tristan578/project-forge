# Preview database branches

Every pull request that touches `web/`, `mcp-server/` or CI gets its own Neon
branch for its Vercel preview (#9972). The branch is a copy-on-write clone of
`production`, the PR's migrations are applied to it before the deploy, and the
deployment reads it through a deployment-scoped `DATABASE_URL`. A migration
that cannot apply fails the PR here instead of in production.

This page is about the one resource that makes that fragile: the project's
**branch allowance**.

## The arithmetic

| Branch | Who owns it | How long it lives |
|---|---|---|
| `production` | Neon default branch | forever |
| `staging` | the Vercel project's preview environment | forever |
| `db-snapshot-<run>-<sha>` | `cd.yml`, before every schema-changing deploy | 14 days |
| `db-dryrun-<run>-<sha>` | `cd.yml`, for the migration rehearsal | minutes; deleted in-job |
| `preview-pr-NNNNNN` | `ci.yml` → Preview Deployment, one per open PR | until the PR closes, or it is reclaimed |

The allowance is **10 branches** on the current plan. Two are permanent and one
or two are snapshots, so roughly six previews can coexist. On 2026-09-14 there
were 13 open PRs and the eleventh create was refused with
`BRANCHES_LIMIT_EXCEEDED`; every preview deploy after it failed identically
until a branch was deleted by hand (#10015). None of the ten belonged to a
closed PR: the close-event cleanup had never failed. The ceiling was simply
below the number of open PRs.

## What runs, and when

**On every preview deploy** (`scripts/preview-db-branch.sh create`, called by
`ci.yml`):

1. The PR's own previous branch is deleted: a push replaces, never accumulates.
2. The branch is created. If Neon answers `BRANCHES_LIMIT_EXCEEDED` (the
   helper's exit code 5):
   1. preview branches whose PR is **closed** are deleted (state from GitHub;
      an unknown state keeps the branch), then the create is retried;
   2. if still full, the **least recently created** preview branch of an open
      PR is deleted, provided it is older than the preview job's own timeout
      (30 minutes, `PREVIEW_DB_MIN_AGE_SECONDS`), so it cannot belong to a
      running job. The evicted PR is named on the job summary and gets a
      comment; its next push rebuilds its branch. Then the create is retried.
   3. if still full, the job fails with exit 5 and says so. That is a capacity
      outcome — close some PRs or raise the plan — not a pipeline defect.

**When a PR closes** (`preview-db-cleanup.yml`, `pull_request: closed`): that
PR's branch is deleted, then anything under `preview-pr-` older than seven
days.

**Every six hours** (`preview-db-cleanup.yml`, `schedule`; also
`workflow_dispatch`): `scripts/preview-db-branch.sh sweep` deletes preview
branches whose PR is closed, `db-dryrun-` leftovers older than a day, and
`db-snapshot-` branches past their 14-day retention. It never touches any
other branch.

## Names are fixed-width on purpose

`preview-pr-000042`, six digits. `neon-branch.sh prune` matches by
`startswith`, so an unpadded `preview-pr-1` would prefix `preview-pr-12` and
pruning PR 1 would delete PRs 12 through 19. Same-length names cannot prefix
one another, so `startswith` degenerates to equality. Anything that reads a PR
number back out of a name requires the full six-digit shape; a branch that
merely starts with the prefix is never treated as a PR's.

## Auditing by hand

```bash
export NEON_API_KEY=... NEON_PROJECT_ID=...
bash scripts/neon-branch.sh list ''            # every branch: id, name, created_at, oldest first
bash scripts/neon-branch.sh list 'preview-pr-' # just the previews
bash scripts/neon-branch.sh delete br-...      # one branch, by id
```

Deleting a branch outside the three managed shapes (a Vercel-integration
`preview/<git-branch>` from before #9972, say) is a deliberate manual action:
check `active_time_seconds` and `current_state` in the Neon console first.

## If previews are failing right now

1. Read the job log. Exit 5 with "nothing is safe to reclaim" means every other
   preview branch is younger than 30 minutes; wait, or close a PR. Exit 5 with
   "outside this pipeline" means something other than CI is holding branches:
   run the audit above.
2. Any other failure is not capacity. Start from the `::error::` lines, which
   name the Neon status and code.
3. Raising the ceiling is a Neon plan change (the Launch plan's included
   allowance is the same ten; extra branches bill per branch-month). That is an
   owner decision, not something this pipeline does.
