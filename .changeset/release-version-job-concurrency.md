---
"web": patch
---

ci: scope the Release workflow's concurrency per-job so a rapid batch-merge no longer fires transient "Run Failed" notifications.

The `Version Packages` job now uses `cancel-in-progress: true` (it is idempotent — it only recreates `changeset-release/main` from current main — so only the latest run is needed), while `Tag and Release` keeps `cancel-in-progress: false` so a version's git tag / GitHub Release is never cancelled mid-publish. Previously a single workflow-level `cancel-in-progress: false` ran every push in a batch to completion, multiplying the chance of the benign "No commits between main and changeset-release/main" error (when a version PR merges with no newer changesets) and `@changesets/get-github-info` GraphQL flakes.
