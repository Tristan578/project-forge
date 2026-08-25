---
"@spawnforge/docs": patch
---

The docs site now participates in changesets versioning. It was on the `ignore`
list while its changesets kept targeting it, so `changeset version` had nothing
to apply and the release PR was generated with an empty diff — the changesets
accumulated on `main` instead of being consumed. Un-ignoring the package
required giving it the `version` field changesets needs, which every other
versioned workspace package already had.
