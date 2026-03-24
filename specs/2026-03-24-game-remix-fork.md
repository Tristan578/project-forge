# Spec: Game Remix/Fork System

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-555
> **Scope:** Enable players to fork published games, modify them in the editor, and republish as remixes with attribution to the original creator.

## Problem

SpawnForge has a community gallery where users publish games, but there is no way for players to learn from or build upon existing games. A basic fork route exists (`/api/community/games/[id]/fork`) that copies `sceneData` into a new project, but it lacks:

- **Attribution chain** — no visible credit to the original creator on forked games.
- **License control** — original creators cannot choose whether their game is forkable.
- **Asset deduplication** — each fork duplicates all assets, causing storage explosion.
- **Remix discovery** — no way to browse remixes of a game or see a game's remix tree.
- **Re-publish flow** — no special handling for publishing a forked game.

The existing `gameForks` table records `originalGameId -> forkedProjectId` but this data is not surfaced anywhere in the UI or used for attribution.

## Constraints & Non-Goals

- **No asset licensing marketplace in MVP.** All forkable games use a single "remix-allowed" license.
- **No real-time collaboration.** Forking creates an independent copy — not a shared editing session.
- **No partial forking in MVP.** Fork copies the entire game; scene-level cherry-picking is Phase 2.
- **No automatic merge/sync.** Original game updates do not propagate to forks.
- **Fork depth limit: 5 levels.** Prevents unbounded chains that complicate attribution.

## Solution

### Architecture Overview

```
Published Game (Creator A)
    │
    ├── Fork → Project (Creator B) → Publish as Remix
    │                                      │
    │                                      ├── Fork → Project (Creator C)
    │                                      │
    │                                      └── Fork → Project (Creator D)
    │
    └── Fork → Project (Creator E) → [Not published]

Attribution chain: C's game credits B, which credits A.
```

### Phase 1: Fork Control & Attribution (MVP)

#### Schema Changes

**Alter `published_games` table — add columns:**

```sql
ALTER TABLE published_games
  ADD COLUMN forkable boolean NOT NULL DEFAULT true,
  ADD COLUMN fork_of_game_id uuid REFERENCES published_games(id),
  ADD COLUMN fork_depth integer NOT NULL DEFAULT 0,
  ADD COLUMN license text NOT NULL DEFAULT 'remix-allowed';
```

- `forkable`: Creator controls whether their game can be forked.
- `fork_of_game_id`: Direct parent in the fork chain (NULL for originals).
- `fork_depth`: 0 for originals, incremented on each fork. Enforced max of 5.
- `license`: Future-proofing. MVP only supports `remix-allowed` and `no-remix`.

**Alter `projects` table — add columns:**

```sql
ALTER TABLE projects
  ADD COLUMN forked_from_game_id uuid REFERENCES published_games(id),
  ADD COLUMN forked_from_project_id uuid REFERENCES projects(id);
```

- `forked_from_game_id`: Links back to the published game this was forked from.
- `forked_from_project_id`: Links to the original project (for asset dedup in Phase 2).

**Drizzle migration file:** `web/src/lib/db/migrations/XXXX_add_fork_columns.sql`

Update `web/src/lib/db/schema.ts`:
- Add `forkable`, `forkOfGameId`, `forkDepth`, `license` to `publishedGames`.
- Add `forkedFromGameId`, `forkedFromProjectId` to `projects`.

#### API Changes

**`POST /api/community/games/[id]/fork` (existing, enhanced):**

Current behavior: Copies sceneData, records in gameForks. New behavior:

1. Check `published_games.forkable` — return 403 if false.
2. Check fork depth — if original game's `fork_depth >= 5`, return 403 with message.
3. Copy sceneData into new project with `forked_from_game_id` set.
4. Record in `gameForks` table (existing).
5. Return `{ projectId, originalGameTitle, originalAuthorName }`.

**`POST /api/publish` (existing, enhanced):**

When publishing a project that has `forked_from_game_id` set:

1. Set `fork_of_game_id` on the new `published_games` row.
2. Set `fork_depth = parent.fork_depth + 1`.
3. Validate fork depth <= 5.
4. Include attribution metadata in the published game's CDN bundle.

**`GET /api/community/games/[id]/remixes` (new):**

Returns paginated list of published games where `fork_of_game_id = :id`.

```json
{
  "remixes": [
    {
      "id": "...",
      "title": "Space Shooter (Neon Edition)",
      "authorName": "CreatorB",
      "playCount": 42,
      "createdAt": "2026-03-24T..."
    }
  ],
  "total": 7,
  "page": 1
}
```

**`GET /api/community/games/[id]/attribution` (new):**

Returns the full attribution chain for a game.

```json
{
  "chain": [
    { "gameId": "...", "title": "Space Shooter", "authorName": "CreatorA", "depth": 0 },
    { "gameId": "...", "title": "Space Shooter (Neon)", "authorName": "CreatorB", "depth": 1 },
    { "gameId": "...", "title": "Space Shooter (Neon Remix)", "authorName": "CreatorC", "depth": 2 }
  ]
}
```

**`PATCH /api/community/games/[id]/settings` (existing or new):**

Allows creator to toggle `forkable` and `license` on their published game.

```json
{ "forkable": false }
```

#### Web Changes

**`GameDetailModal.tsx` (enhanced):**
- Show "Remix This Game" button (if `forkable === true`).
- Show attribution line: "Remixed from [Original Game] by [Creator]" with link.
- Show "X remixes" count with link to remixes tab.
- Show fork-disabled badge if `forkable === false`.

**`GameSettingsPanel.tsx` (new or enhanced):**
- Toggle: "Allow others to remix this game" (defaults to true).
- License selector (Phase 2 — MVP shows text-only).

**`RemixesTab.tsx` (new component):**
- Grid of remix cards shown in game detail view.
- Sorted by play count or newest.

**`communityStore.ts` (enhanced):**
- Add `forkGame` action enhancement: check forkable before calling API.
- Add `fetchRemixes(gameId)` action.
- Add `fetchAttribution(gameId)` action.

**`PublishDialog.tsx` (enhanced):**
- If project is a fork, show attribution preview: "This game will be published as a remix of [Original]".
- Show the attribution chain that will appear on the published game.

**Chat handler:** `chat/handlers/communityHandlers.ts`
- Tool: `fork_game { gameId }` — Forks a game via the API.
- Tool: `set_game_forkable { gameId, forkable }` — Toggles fork permission.

**MCP commands (4 new):**
- `fork_game`, `set_game_forkable`, `query_remixes`, `query_attribution`

#### Exported Game Attribution

When a forked game is exported, the game template includes an attribution footer:

```html
<div class="sf-attribution">
  Remixed from <a href="...">Original Game</a> by CreatorA
  — Made with <a href="https://spawnforge.ai">SpawnForge</a>
</div>
```

This is injected by `web/src/lib/export/gameTemplate.ts` when the project has `forkedFromGameId`.

### Phase 2: Asset Deduplication (Storage Optimization)

#### Content-Addressable Asset Storage

Instead of duplicating assets on fork, store assets by content hash in R2.

**New table:**

```sql
CREATE TABLE asset_blobs (
  hash text PRIMARY KEY,          -- SHA-256 of content
  bucket text NOT NULL,            -- R2 bucket name
  key text NOT NULL,               -- R2 object key
  size_bytes bigint NOT NULL,
  mime_type text NOT NULL,
  ref_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  asset_hash text NOT NULL REFERENCES asset_blobs(hash),
  path text NOT NULL,              -- Logical path within the project
  UNIQUE(project_id, path)
);
```

**Fork behavior with dedup:**
1. Fork copies metadata (`project_assets` rows) but not actual bytes.
2. `asset_blobs.ref_count` incremented atomically.
3. On project delete, decrement `ref_count`. GC removes blobs with `ref_count = 0`.
4. Storage savings: N forks of a game with 50MB of assets costs 50MB total, not N*50MB.

**Lazy-fork optimization:**
- Fork creates project_assets entries pointing to same blob hashes.
- Assets are only copied to a new hash if the forker modifies them (copy-on-write).
- This is transparent to the editor — asset URLs resolve through a lookup that checks `project_assets -> asset_blobs -> R2`.

### Phase 3: Discovery & Social (Remix Culture)

- **Remix tree visualization:** Interactive graph showing fork lineage.
- **"Most remixed" leaderboard:** Games sorted by remix count.
- **Creator notifications:** "Your game was remixed by [Creator]!"
- **Selective forking:** Fork specific scenes, not the entire game.
- **License picker:** CC-BY, CC-BY-SA, CC-BY-NC, All Rights Reserved.
- **Revenue sharing:** If forked games generate revenue (ads, tips), configurable split with original creator.

## Security Considerations

1. **Fork spam:** Rate limit already exists (10/min per user). Add per-game limit: max 3 forks of the same game per user.
2. **Storage abuse:** Phase 1 copies full sceneData (bounded by project size limits per tier). Phase 2 dedup eliminates the concern.
3. **Attribution tampering:** `fork_of_game_id` is set server-side on publish. Users cannot modify it. The attribution chain is authoritative.
4. **Copyright claims:** Add a "Report" button on remixed games. Moderation flow (existing `/api/admin/moderation`) handles disputes. Original creators can request takedown of remixes.
5. **Fork bomb:** Fork depth limit of 5 prevents unbounded chains. Total forks per game are unlimited but each fork consumes a project slot counted against the user's tier limit.
6. **Forkable toggle timing:** If a creator disables forking after forks exist, existing forks remain valid. Only new forks are blocked. Existing published remixes are not unpublished.

## Performance Budget

| Metric | Budget |
|--------|--------|
| Fork operation (Phase 1) | < 5s (sceneData copy) |
| Fork operation (Phase 2) | < 2s (metadata only, no asset copy) |
| Attribution chain query | < 100ms (max depth 5, indexed) |
| Remixes list query | < 200ms (paginated, indexed on fork_of_game_id) |
| Storage per fork (Phase 1) | Same as original project size |
| Storage per fork (Phase 2) | ~1KB metadata + modified assets only |

## Acceptance Criteria

### Phase 1 (Fork Control & Attribution)
- Given a published game with `forkable: true`, When a player clicks "Remix This Game", Then a new project is created with the game's sceneData and `forked_from_game_id` is set.
- Given a published game with `forkable: false`, When a player tries to fork, Then the API returns 403 and the "Remix" button is hidden in the UI.
- Given a forked project, When the user publishes it, Then the published game shows "Remixed from [Original] by [Creator]" with a link.
- Given a game that is a remix, When viewing its detail page, Then the full attribution chain is visible (up to 5 levels).
- Given a game with 3 published remixes, When viewing its detail page, Then a "Remixes (3)" tab shows all remix cards.
- Given a game at fork depth 5, When a user tries to fork it, Then the API returns 403 with "Maximum remix depth reached".
- Given a creator, When they view their game settings, Then they can toggle "Allow remixes" on/off.

### Phase 2 (Asset Dedup)
- Given a 50MB game forked 10 times, When checking R2 storage, Then total storage is approximately 50MB (not 500MB).
- Given a forked project, When the user modifies a texture, Then only the modified texture is stored as a new blob.

## Alternatives Considered

1. **Git-based project versioning:** Rejected. Git adds complexity (merge conflicts, branch management) that is inappropriate for a "Canva for games" product aimed at beginners. Simple snapshot-copy is more predictable.

2. **Shared project with permissions:** Rejected. Real-time collaboration (Phase 24) is a separate feature. Forking creates independent copies, which is simpler and avoids concurrency issues.

3. **No attribution enforcement:** Rejected. Attribution is critical for creator trust. Without it, creators will disable forking, killing remix culture.

4. **Client-side fork (download + re-upload):** Rejected. Requires user to export, then re-import. Server-side fork is instant and preserves the attribution chain.

## Phased Implementation Plan

| Phase | Scope | Infra Needed | Estimated Effort |
|-------|-------|-------------|-----------------|
| 1: Fork Control | DB migration, enhanced fork API, attribution UI, publish flow, forkable toggle | None (uses existing Neon + R2) | 2-3 weeks |
| 2: Asset Dedup | Content-addressable storage, ref counting, copy-on-write, GC | R2 content hash keys | 3-4 weeks |
| 3: Discovery | Remix tree viz, leaderboard, notifications, selective fork | None | 2-3 weeks |
| 4: Licensing | License picker, revenue sharing, takedown flow | Stripe Connect (for splits) | 3-4 weeks |
