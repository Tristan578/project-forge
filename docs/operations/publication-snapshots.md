# Private publication snapshots

Publishing stores a scene snapshot in Postgres. When `PUBLISH_TO_R2` is enabled,
the server also writes an immutable JSON object to the existing private assets
bucket. Public CDN hosting of published games is deliberately not built — see
`docs/decisions/2026-09-23-published-game-hosting.md` for the decision and
what would reopen it. Standalone exported-game deployment is tracked by #9883.

## Request behavior

- Share URLs remain `/play/{clerkId}/{slug}`. The play API checks publication
  status before reading any scene data and applies the response redaction guard.
  Remix and community fork also require published status, copy this snapshot,
  and disable imported scripts while preserving their source for inspection.
- Each object uses `games/{clerkId}/{slug}/{uuid}/bundle.json`. A new publication
  never overwrites an older object. The database stores the exact key.
- The manifest contains schema version 1, publication version, publication time,
  creator ID, and slug. Reads validate the key, manifest identity/version, and
  non-null scene object before serving it.
- The optional R2 write and each read have a three-second deadline, including
  response-body consumption. Failures fall back to the Postgres publication
  snapshot. Cleanup batches also have three-second deadlines.
- The publication row, snapshot, and tags commit in one SQL statement. A
  concurrent revision conflict returns HTTP 409; reload and retry.
- Legacy rows have no publication snapshot until their next publish and retain
  the existing project-data fallback. Subsequent editor saves do not change
  newly published snapshots.

## Configuration and access

The existing `ASSET_R2_ACCOUNT_ID`, `ASSET_R2_ACCESS_KEY_ID`,
`ASSET_R2_SECRET_ACCESS_KEY`, and `ASSET_BUCKET_NAME` configure authenticated
S3-compatible access. `PUBLISH_TO_R2=true` enables the mirror and
`PUBLISH_TO_R2=false` disables it. If unset or unrecognized, it defaults to the
presence of `ASSET_BUCKET_NAME`.

Keep the assets bucket private. No public bucket binding, CORS rule, custom
domain, signed object URL, or CDN route is added by this change. `CDN_URL` is
not required by the publication snapshot path. The engine CDN Worker serves its
separate engine bucket; it does not serve these objects. Reads use the
authenticated S3 API and do not establish an edge-cache performance benefit.

## Cleanup and recovery

Successful replacements delete the previous owned object and its status
sidecar after the database commit. A failed commit deletes its candidate only
after confirming that no publication references it. An uncertain database
response followed by an unavailable verification query retains the object and
reports its key to monitoring. This avoids deleting a snapshot that may have
committed successfully.

Account deletion collects the publication keys returned by its database deletion
and deletes them with marketplace objects after the transaction commits.
Cleanup is bounded and best effort. Failed keys and sweep truncation are
reported to monitoring for reconciliation; cleanup failure does not reverse an
already committed publication or account deletion. A timed-out upload may have
reached storage despite transport cancellation, so operators must reconcile
reported uncertain writes and their sidecars.

## Validation limits

Automated tests cover private transport options, immutable keys, malformed and
mismatched bundles, deadlines, PostgreSQL commit/rollback/concurrency, snapshot
fallback, response redaction, and cleanup ownership. They use mocked R2
transport and real local Postgres through PGlite. Live bucket behavior,
provisioning, deployed delivery, and CDN hosting are not established by these
tests.
