# Serve published games through the gated play API, not a public CDN

- **Date:** 2026-09-23
- **Status:** Accepted
- **Context:** #7580 (PF-2, "Configure CDN/object storage for published games"),
  #10057 / PR #10053 (immutable publication snapshots, merged 2026-09-15)
- **Supersedes:** the setup guide in the body of #7580, which describes a public
  `spawnforge-games` bucket on `cdn.spawnforge.ai` with a CORS policy and an
  `ASSET_STORAGE_TYPE` variable. None of that exists, and this record says why
  it is not going to.

## Decision

A published game is served to players by `GET /api/play/[userId]/[slug]` from
the **immutable publication snapshot** that `POST /api/publish` commits:

1. `published_games.published_scene_data` (Postgres) is the snapshot of record,
   written in the same statement as the row's version and tags
   (`web/src/lib/publishing/commitPublication.ts`).
2. When `PUBLISH_TO_R2` is enabled, the same snapshot is mirrored to the
   existing **private** assets bucket under
   `games/{clerkId}/{slug}/{uuid}/bundle.json`, and the exact key is stored in
   `published_games.cdn_bundle_key` (`web/src/lib/storage/publishedGameStorage.ts`).
3. The play route checks `status = 'published'` on every request, reads the
   mirror through the authenticated S3 API, falls back to the Postgres snapshot,
   and answers `Cache-Control: private, no-store`. A row published before
   #10053 and not republished since has no snapshot in either place; for those
   legacy rows play, remix and fork still read the live `projects.sceneData`
   until the creator republishes (`CLAUDE.md`, `PUBLISH_TO_R2`).

This repository adds **no public binding, no CORS rule, no Worker route and no
public-URL minting** for those objects, and none will be added under this
issue. Snapshot objects are written with `Cache-Control: private, no-store` and
`If-None-Match: *` and are read only through the authenticated S3 API.

`published_games.cdn_url` keeps its name. See "Why `cdn_url` is not renamed".

## What #7580 asked for, and which parts are done

The issue's user story is "published games hosted on reliable CDN-backed
storage so that players can load my games quickly". Its reopen note
(2026-07-20, re-verified 2026-08-30) allowed two closures, quoted as written:
"either implement real R2-backed hosting for published games (bucket + upload
on publish + CDN read path), or write an ADR stating that Postgres-served
`/play` **is** the design and rename/remove the misleading `cdnUrl` column."

This record takes the second closure and departs from its second half: the
column is documented, not renamed or removed. The departure and its reasons
are argued in "Why `cdn_url` is not renamed" below, so the closure can be
judged against the condition as written rather than a softened one.

| Acceptance criterion in #7580 | State on `main` |
|---|---|
| Publish uploads the game's data to object storage | Done by #10053: `writePublishedGameBundle` on every publish when `PUBLISH_TO_R2` is on; the Postgres snapshot is written unconditionally. |
| Objects are stored with correct content types | Done: `application/json`, validated on read against a schema-v1 manifest (owner, slug, version). |
| Published data is reachable at a public CDN URL with CORS and long-lived caching | **Not done, by this decision.** |
| Republishing does not leak unpublished edits (the defect behind the "urgent" priority) | Done by #10053 for every publication committed since it merged: play, remix and fork read the committed snapshot. A legacy row with no snapshot keeps serving the live project until its creator republishes once. |

## Why not a public CDN read path

### 1. A public edge cannot enforce publication status

The moderation model (#8354) is that a game leaves the public surface the
moment it is unpublished, flagged past the report threshold, or taken down by
an admin. A game the creator unpublished comes back when they republish it; a
*held* game (`flagged_at` set) comes back only when an admin approves it or the
creator wins an appeal, and only if it was auto-hidden rather than taken down,
because `POST /api/publish` refuses to republish while `flagged_at` is set. All
of that is a Postgres predicate evaluated per request, which is why the play
route is `no-store`.

A CDN object is the opposite: it is served from cache with no knowledge of the
row. Making takedowns immediate on a CDN would require, on every status
transition, deleting the object **and** purging every edge cache, and a
purge-on-transition step in four routes (creator unpublish, admin unpublish,
moderation delete, auto-hide) plus account deletion. Any missed or failed purge
is a taken-down game still playable from the URL every prior player already
holds. The play route today has one place to get this right, and it does.

### 2. The bucket that holds the snapshots must stay private

The snapshot mirror lives in the same bucket as marketplace uploads
(`ASSET_BUCKET_NAME`). What the code establishes: snapshot objects are written
`private, no-store` and read only via authenticated S3
(`putPrivateObjectToR2` / `getObjectFromR2` in `web/src/lib/storage/r2.ts`),
marketplace downloads go through a signed-URL route, and the engine CDN Worker
binds a *different* bucket, saying in its config that the assets bucket is
deliberately not reachable through that edge. Whether the assets bucket is
reachable through any public host is an operating-environment fact this
repository does not verify, and this decision does not depend on it: serving
snapshots publicly would mean either a public binding on the bucket that also
holds marketplace files, or a second bucket with its own credentials, lifecycle
sweep and orphan-key script — for a payload that is one JSON document per play.

### 3. The bytes that matter belong on the engine CDN, and now are

What makes a play slow to start is the engine: several megabytes of WASM plus
its JS glue per backend, which the `engine-cdn` Worker at
`engine.spawnforge.ai` serves from the `spawnforge-engine` bucket under a
per-build prefix with immutable cache headers. The editor has loaded from
there since #8247 (`useEngine.getWasmBasePaths`, CDN first, same-origin
fallback). **The `/play` loader never did**: `loadPlayEngine.ts` hardcoded the
same-origin `/engine-pkg-*` path, so every player pulled the engine through
the Vercel origin even though the play CSP already allowed the CDN
(`playCspOptionsFromEnv` → `engineCdn`). This decision's PR fixes that:
`getPlayEngineBasePaths` mirrors the editor's resolution (versioned CDN prefix
when `NEXT_PUBLIC_ENGINE_VERSION` is set, `/latest/` otherwise, then
same-origin), and `instantiateFromPaths` falls through to the next origin when
one fails. That is the CDN win the issue was after, and it is delivered on the
artifact that is actually large. The scene snapshot is one JSON document per
session; moving it to a CDN would not change what a player waits for, only
where the moderation check can no longer run.

### 4. Published scripts run in players' browsers

`ScriptData.source` is part of the scene (see SEC-2 in `CLAUDE.md`). A
long-lived public copy of a scene is a long-lived public copy of its scripts,
which is what the takedown path exists to end. Keeping the only read path
status-gated keeps that guarantee in one place.

## Why `cdn_url` is not renamed

`published_games.cdn_url` has always held `/play/{clerkId}/{slug}`: the play
page path, not a CDN origin. Every consumer already treats it that way —
`GET /api/publish/list` returns it as `url`, the three community routes return
it as `cdnUrl`, and `GameDetailModal` uses it as the link's `href`. It is also
the public `cdnUrl` field of `/api/community/games` in `docs/api/openapi.json`.

Renaming it is now mechanically safe (production schema changes go through
`npm run db:migrate`, ADR 2026-09-11), but it would be a migration, an API
response field rename, and edits across the publish, community and store code
and their tests, for zero change in behaviour. The name is corrected where the confusion started instead: the
column comment in `web/src/lib/db/schema.ts` states what it holds and points
here, and the object that *is* in storage has its own column, `cdn_bundle_key`.

## Consequences

- Every play is one function invocation that reads the snapshot. The play
  route resolves the user and the full `published_games` row (which includes
  `published_scene_data`, because it selects `*`) from Postgres and checks the
  status **before** it touches R2; with the mirror on, it then prefers the R2
  copy and falls back to the Postgres column when the read fails or exceeds its
  three-second deadline. So the fallback runs one way only: R2 failure falls
  back to Postgres, and a Postgres outage makes play unavailable regardless of
  `PUBLISH_TO_R2`. The mirror is an immutable private copy, not an availability
  or performance path (`docs/operations/publication-snapshots.md`: "Reads use
  the authenticated S3 API and do not establish an edge-cache performance
  benefit"). If play volume ever makes function egress the cost that matters,
  the first change is to select the jsonb column only on the fallback branch,
  and the second is to reconsider the edge design below — with the takedown
  requirement in front of it.
- The `spawnforge-games` bucket and the `ASSET_STORAGE_TYPE` variable from the
  issue body are not to be provisioned: nothing reads them. The variables the
  snapshot path reads are the four `ASSET_R2_*`/`ASSET_BUCKET_NAME` values
  (`ASSET_STORAGE_ENV` in `web/src/lib/config/assetStorage.ts`) and
  `PUBLISH_TO_R2` (`CLAUDE.md`, "Optional feature flags"). `CDN_URL` and
  `ASSET_CDN_HOSTS` also exist, but for the marketplace — `CDN_URL` is the host
  `uploadToR2` mints asset URLs on and `resolveOwnedAssetKey` matches them
  against, and `ASSET_CDN_HOSTS` is the redirect allowlist of the marketplace
  download route — and this decision neither requires nor removes them.
- Standalone exported-game hosting (a self-contained runtime a creator can put
  on their own host) is a different feature, owned by story #9883 ("Make export
  dependency-complete and independently playable", FR-1 of epic #9800), not by
  this decision.

## What would reopen this

A measured need for edge delivery of the scene document — sustained play volume
where the per-play function cost is material — together with a design that
keeps takedowns immediate: a dedicated public bucket bound to its own Worker,
objects served only under unguessable per-revision keys, delete-and-purge on
every status transition (covered by tests that exercise all four transitions),
and the play route still the source of truth for whether a URL may be handed
out. Until then, the gated API is the design.
