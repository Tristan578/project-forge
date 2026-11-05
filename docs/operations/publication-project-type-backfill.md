# Backfill: project type in pre-#10358 publication snapshots

`web/scripts/backfill-publication-project-type.ts` writes `metadata.projectType`
into stored publication snapshots that were published before scenes recorded
their dimension (#10358). Without the key, `/play` starts the engine in 3D, so a
2D game shows a blank canvas. Issue: #10368.

It is a one-off repair that an operator runs by hand. No build, deploy or agent
runs it. It defaults to a dry run and writes only with `--apply`.

## What it reads and writes

- **Candidates.** `published_games` rows whose `published_scene_data` is not
  null and states no type. An explicit JSON `null` counts as no type, as it
  does for the engine.
- **Decision.** The source project's own `scene_data.metadata.projectType`,
  when it is `2d` or `3d` (any project saved since #10358 has one). The script
  skips the row when the snapshot contradicts it: a stated `2d` with 3D-only
  content (terrain, CSG, procedural mesh, glTF, an imported asset), or a stated
  `3d` whose snapshot the #10454 classifier reads as 2D. A project's stated
  type can be wrong (#10374), which is why this check exists. When the project
  states nothing, the script falls back to the #10454 classifier, which only
  ever answers `2d`. Otherwise it writes nothing.
- **Write.** `jsonb_set` of that one key in `published_scene_data`. The UPDATE
  re-checks that the key is still absent and that `version` is the one read, so
  it never replaces a value and never touches a row republished meanwhile.
  `version` and `updated_at` do not change. `projects` is never written.
- **Not candidates.** Rows with no snapshot. `/play` serves their live project,
  so the project's own key, or the `/play` heuristic, already applies.
- **R2 mirrors.** R2 objects are immutable and the script does not rewrite
  them. For a row whose `cdn_bundle_key` is set, `/api/play` adds the
  Postgres snapshot's stated type to a key-less bundle (#10368). **Deploy that
  route change before running `--apply`**, or rows served from R2 keep playing
  in 3D. The report counts them as "Decided rows that also name an R2 snapshot".

The report prints counts and, with `--list`, publication ids only. It prints no
user ids, slugs, titles or scene content. A database error prints the error
class and SQLSTATE, not the message, because a connection error's message can
carry the host.

## Running it

Run from `web/`, with `DATABASE_URL` in the environment. Get the connection
string the way you normally do, keep it out of the repository and out of any
chat, and unset it afterwards.

1. **Rehearse on a branch of production.** Create a Neon branch from the
   production database and point `DATABASE_URL` at it.
   ```bash
   npx tsx scripts/backfill-publication-project-type.ts --list   # dry run
   npx tsx scripts/backfill-publication-project-type.ts --apply --list
   npx tsx scripts/backfill-publication-project-type.ts          # expect 2d: 0, 3d: 0
   ```
   The third run should report every row written by the second as "already
   state a type", and only `unstated` decisions left. Delete the branch when
   done.
2. **Dry run against production.** Read the counts before writing anything:
   - `project-states-type` and `classifier-2d` are what `--apply` will write.
   - `project-2d-but-snapshot-has-3d-content` and
     `project-3d-but-snapshot-reads-2d` are rows where the project and the
     snapshot disagree. They are left alone. Look at them by id if the count is
     not small.
   - `undecided` rows keep today's behaviour (3D on `/play`, unless the runtime
     heuristic recognises them). Republishing fixes them.
   - `malformed-snapshot` should be 0. If it is not, stop and look.
3. **Apply, keeping the list.** The list is the rollback record.
   ```bash
   npx tsx scripts/backfill-publication-project-type.ts --apply --list > backfill-project-type-$(date +%F).log
   ```
   `Skipped, row changed since it was read` counts rows republished during the
   run. A re-run picks them up if they still need it.
4. **Confirm.** Re-run the dry run: the written rows now count as "already
   state a type". Open `/play` for one written `2d` publication (look its slug
   up by id) and check that it renders in 2D.

## Rolling back

Every write sets one key. To remove it from the rows a run wrote, take their ids
from the `--apply --list` log (lines ending in `written`):

```sql
UPDATE published_games
SET published_scene_data = published_scene_data #- '{metadata,projectType}'
WHERE id IN (/* ids from the log */);
```

## Not verified

The tests run the real SQL against PGlite (`scripts/__tests__/backfill-publication-project-type.db.test.ts`).
They do not establish anything about the production data: how many rows are
candidates, how many source projects state a type, or how many rows R2 serves.
The dry run is how to find out.
