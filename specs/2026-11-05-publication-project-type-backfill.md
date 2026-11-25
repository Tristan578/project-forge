# Spec: Backfill the project type into pre-#10358 publication snapshots

> **Status:** APPROVED (Tristan, 2026-11-05: "Get it done, we need to support both 2D and 3D creation out of the box", choosing proposal 1 of #10368 alongside the #10454 stopgap)
> **Date:** 2026-11-05
> **Ticket:** #10368 (PR #10454)
> **Scope:** A dry-run-first operator script that writes `metadata.projectType` into stored publication snapshots, plus the one `/api/play` change that makes the write reach R2-served games.

## Problem

A game published before #10358 has no `metadata.projectType`, so `/play` starts in 3D and a 2D game renders blank. #10454's runtime heuristic is one-sided and cannot see 2D games built by the game-creation pipeline, which consist of `plane`/`cube` meshes with 3D physics (`entityShape.ts` `resolveEntityShape`, `physicsEnableExecutor.ts`). Those carry no 2D marker in the scene. The only record that knows is the source project: the engine writes the key on every save since #10358, and the orchestrator sets the project type to the GDD's before a run (`orchestratorSlice.ts`), so a pipeline project saved since then states `2d`.

There is no `project_type` column; the project's type lives in `projects.scene_data.metadata.projectType`. `published_games.project_id` is `NOT NULL` with a foreign key, so every publication has a project record; "no project record" never occurs, and the fallback applies when the project states no usable type.

## Design

`web/scripts/backfill-publication-project-type.ts`:

1. Count all publications, those already stating a type, and those with no snapshot (served from the live project, not candidates).
2. Page through candidates (`published_scene_data` not null, key absent or JSON `null`) by primary key.
3. Decide each: the project's stated `2d`/`3d`, unless the snapshot contradicts it (stated `2d` with 3D-only content; stated `3d` that the classifier reads as `2d`; reported, not written); else the #10454 classifier (`2d` or nothing); else nothing.
4. Dry run by default. With `--apply`, write via `jsonb_set` under a WHERE clause that re-checks key absence and `version`.

`/api/play`: an immutable R2 bundle that states no type takes the stated type of the same publication's Postgres snapshot. A bundle that states a value is served as stored.

## Acceptance criteria

- [x] Default run writes nothing and prints counts by decision and by reason.
- [x] `--apply` writes only the one key, never replaces an existing value, does not move `version` or `updated_at`, and a second run writes nothing.
- [x] A row republished between read and write is skipped and counted.
- [x] Contradictions between project and snapshot are skipped and counted.
- [x] Unknown flags are refused.
- [x] R2-served key-less bundles get the backfilled key; bundles with their own value keep it.
- [x] Tested against real Postgres (PGlite harness), every guard mutation-checked.
- [x] Runbook in `docs/operations/publication-project-type-backfill.md`; running it against production is the owner's action.
