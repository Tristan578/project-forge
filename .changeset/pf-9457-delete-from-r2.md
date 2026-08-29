---
"web": patch
---

Actually delete R2 objects on account deletion and asset replacement. Nothing in
production ever deleted an R2 object: `deleteFromR2` was exported and never
called, so every marketplace preview and asset file uploaded to R2 was orphaned
forever — a storage-cost leak and a right-to-erasure gap, since a deleted user's
uploads stayed live and publicly fetchable through the CDN. That dead single-key
helper is now removed, replaced by a batched `deleteManyFromR2`.

`deleteUserAccount` sweeps the departing user's `assets/{userId}/{assetId}/`
objects after the deletion transaction commits, and the seller upload route
removes the object a re-upload supersedes. Both sweeps also remove each object's
`.status.json` sidecar — the asset post-processing Worker writes one into the
same bucket for every object it validates, and it is recorded in no database
row, so nothing else would ever clean it up.

Both paths are best-effort: a storage failure is logged and reported to Sentry
with the affected keys but never fails the user-facing operation. Sweeps are
de-duplicated, capped at 5000 keys, and issued as batched `DeleteObjects` calls
(1000 keys per request) rather than one request per object. The account-deletion
asset read is capped at 1250 rows to stay inside that ceiling; it reads one row
past the cap so it can distinguish "exactly at the cap" from "past the cap", and
reports the latter to Sentry with the prefix to reconcile rather than dropping
the tail silently. `web/scripts/list-orphaned-r2-keys.ts` lists what is left
under a prefix for reconciliation (`wrangler` has no object-listing command).

Also fixes an access-control bug found in the same code path: the marketplace
download route derived its R2 key from the raw `assetFileUrl`, which a seller can
set to any string via the asset PATCH route, so a seller could point their own
asset at another seller's key and be issued a signed URL for someone else's paid
file. The key is now derived through an ownership-checked resolver.
