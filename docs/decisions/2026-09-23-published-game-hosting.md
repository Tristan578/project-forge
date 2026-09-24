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
   and answers `Cache-Control: private, no-store`.

There is **no public bucket, no bucket custom domain, no CORS rule, and no
Worker route** for published games, and none will be added under this issue.
The assets bucket stays private, as `infra/engine-cdn/wrangler.toml` already
requires for the marketplace objects it also holds.

`published_games.cdn_url` keeps its name. See "Why `cdn_url` is not renamed".

## What #7580 asked for, and which parts are done

The issue's user story is "published games hosted on reliable CDN-backed
storage so that players can load my games quickly". Its reopen note
(2026-07-20, re-verified 2026-08-30) allowed two closures: implement
bucket + upload-on-publish + CDN read path, **or** record that API-served
`/play` is the design and address the misleading `cdn_url`.

| Acceptance criterion in #7580 | State on `main` |
|---|---|
| Publish uploads the game's data to object storage | Done by #10053: `writePublishedGameBundle` on every publish when `PUBLISH_TO_R2` is on; the Postgres snapshot is written unconditionally. |
| Objects are stored with correct content types | Done: `application/json`, validated on read against a schema-v1 manifest (owner, slug, version). |
| Published data is reachable at a public CDN URL with CORS and long-lived caching | **Not done, by this decision.** |
| Republishing does not leak unpublished edits (the defect behind the "urgent" priority) | Done by #10053: play, remix and fork read the committed snapshot, never the live project. |

## Why not a public CDN read path

### 1. A public edge cannot enforce publication status

The moderation model (#8354) is that a game leaves the public surface the
moment it is unpublished, flagged past the report threshold, or taken down by
an admin, and comes back only when an admin approves it or the creator wins an
appeal. `POST /api/publish` refuses to republish while `flagged_at` is set. All
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

The snapshot mirror lives in the assets bucket next to marketplace files, which
are sold and delivered by signed URL only (`getSignedDownloadUrl` in
`web/src/lib/storage/r2.ts`). The engine CDN Worker binds a *different* bucket
for exactly this reason and says so in its config. Public delivery would need a
second bucket, second credentials, second lifecycle sweep and a second
orphan-key script — for a payload that is one JSON document per play.

### 3. The bytes that matter are already on a CDN

What makes a play slow to start is the engine: four WASM variants of several
megabytes each, served by the `engine-cdn` Worker at `engine.spawnforge.ai`
from the `spawnforge-engine` bucket, cache-busted per build. The scene snapshot
is a single JSON document fetched once per session. Moving it to a CDN would
not change what a player waits for; it would only move where the moderation
check can no longer run.

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

- Every play is one function invocation that reads the snapshot. With the
  mirror on, that is an S3 `GetObject` **and** the full `published_games` row
  (which includes `published_scene_data`), because the route selects `*` before
  deciding which copy to serve. The mirror is redundancy for a Postgres outage,
  not a performance path; `docs/operations/publication-snapshots.md` says the
  same. If play volume ever makes function egress the cost that matters, the
  first change is to select the jsonb column only on the fallback branch, and
  the second is to reconsider the edge design below — with the takedown
  requirement in front of it.
- The `spawnforge-games` bucket, `cdn.spawnforge.ai`, `ASSET_CDN_HOSTS` and
  `ASSET_STORAGE_TYPE` from the issue body are not to be provisioned. The
  variables that exist are the four `ASSET_R2_*`/`ASSET_BUCKET_NAME` values and
  `PUBLISH_TO_R2` (see `CLAUDE.md`, "Optional feature flags").
- Standalone exported-game hosting (a self-contained runtime a creator can put
  on their own host) is a different feature and is tracked by the publishing
  epic #9884, not by this decision.

## What would reopen this

A measured need for edge delivery of the scene document — sustained play volume
where the per-play function cost is material — together with a design that
keeps takedowns immediate: a dedicated public bucket bound to its own Worker,
objects served only under unguessable per-revision keys, delete-and-purge on
every status transition (covered by tests that exercise all four transitions),
and the play route still the source of truth for whether a URL may be handed
out. Until then, the gated API is the design.
