---
"web": patch
---

Actually delete R2 objects on account deletion and asset replacement.
`deleteFromR2` had zero production callers, so every marketplace preview and
asset file uploaded to R2 was orphaned forever — a storage-cost leak and a
right-to-erasure gap, since a deleted user's uploads stayed live and publicly
fetchable through the CDN. `deleteUserAccount` now sweeps the departing user's
`assets/{userId}/{assetId}/` objects after the deletion transaction commits, and
the seller upload route removes the object a re-upload supersedes. Both paths are
best-effort: a storage failure is logged and reported to Sentry with the affected
keys but never fails the user-facing operation. Sweeps are de-duplicated, capped
at 5000 keys, and issued as batched `DeleteObjects` calls (1000 keys per request)
rather than one request per object.

Also fixes an access-control bug found in the same code path: the marketplace
download route derived its R2 key from the raw `assetFileUrl`, which a seller can
set to any string via the asset PATCH route, so a seller could point their own
asset at another seller's key and be issued a signed URL for someone else's paid
file. The key is now derived through an ownership-checked resolver.
