---
"web": patch
---

ci: retry `changeset version` in the Release workflow so a transient GitHub GraphQL flake no longer fires a spurious "Run Failed" notification.

The changelog generator (`@changesets/changelog-github`) fetches PR/author info from the GitHub GraphQL API per changeset; under load that request intermittently fails with `Invalid response body ... Premature close`, aborting the Version Packages job even though the release itself is unaffected. The `changeset:version` npm script now runs `scripts/changeset-version.sh`, which retries `changeset version` (changesets applies no files on that error, so a re-run is idempotent) before relocking — keeping the changelog's PR links while making the step resilient to the flake. Complements the per-job concurrency fix in #8849.
