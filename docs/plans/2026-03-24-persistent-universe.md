# Spec: Cross-Game Persistent Universe

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-583
> **Scope:** Characters, items, and progress carry between published SpawnForge games

## Problem

Players who engage with multiple SpawnForge games have no continuity between them. Each game is a silo. Creators cannot build interconnected worlds where a character earned in one game carries items or XP into another. This limits the emergent community value of the platform.

## Solution

Add a **Universe Profile** system: a per-user persistent data store that games opt into. Games declare which data they read/write via a manifest. The runtime `forge.universe` script API lets game scripts store and retrieve cross-game state. All data lives server-side (Neon) to prevent tampering.

### Data Model

**New DB tables (Drizzle, `web/src/lib/db/schema.ts`):**

- `universe_profiles` — One per user. Contains `userId`, `displayName`, `avatarUrl`, `createdAt`.
- `universe_items` — Rows of `{ profileId, gameId, itemKey, itemData (jsonb), grantedAt }`. Items are namespaced per game that granted them but readable cross-game.
- `universe_progress` — Rows of `{ profileId, key, value (jsonb), updatedAt }`. Flat key-value for XP, level, flags, achievements. Keys are globally unique strings like `game:<slug>:level`.
- `universe_manifests` — Per published game. Declares `{ gameId, reads: string[], writes: string[], maxItemsPerPlayer: number }`. Enforced server-side.

### API Routes (`web/src/app/api/universe/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/universe/profile` | GET | Fetch current user's universe profile |
| `/api/universe/profile` | PUT | Update display name / avatar |
| `/api/universe/items` | GET | List items for current user (optional `?gameId=` filter) |
| `/api/universe/items` | POST | Grant item (game must have write permission in manifest) |
| `/api/universe/progress` | GET | Read progress keys (filtered by manifest `reads`) |
| `/api/universe/progress` | PUT | Write progress keys (filtered by manifest `writes`) |
| `/api/universe/manifest` | PUT | Creator sets game's read/write permissions |

All routes require Clerk auth. Rate limited via `rateLimitPublicRoute()`.

### Script API (`forge.universe.*`)

Added to `web/src/lib/scripting/forgeTypes.ts` and implemented in the script worker bridge:

```typescript
namespace forge.universe {
  function getProfile(): Promise<{ displayName: string; avatarUrl: string | null }>;
  function getItems(gameId?: string): Promise<Array<{ itemKey: string; itemData: object; grantedAt: string }>>;
  function grantItem(itemKey: string, itemData: object): Promise<void>;
  function getProgress(keys: string[]): Promise<Record<string, unknown>>;
  function setProgress(key: string, value: unknown): Promise<void>;
}
```

These are async (use the existing async channel protocol). The script worker posts messages to the main thread, which calls the API routes.

### Editor Integration

- **Universe Manifest panel** in SceneSettings: creators define which keys their game reads/writes.
- Manifest stored in `.forge` scene file under `universeManifest` field.
- On publish, manifest is written to `universe_manifests` table.

### MCP Commands (4 new)

| Command | Category | Description |
|---------|----------|-------------|
| `set_universe_manifest` | universe | Set game's read/write key permissions |
| `get_universe_manifest` | universe | Query current manifest |
| `add_universe_item_key` | universe | Add an item key to the write manifest |
| `add_universe_progress_key` | universe | Add a progress key to the read/write manifest |

## Constraints

- **No engine (Rust) changes.** This is entirely JS-side: DB, API routes, script worker bridge.
- **Size limit:** 100 items per player per game. Progress values max 10KB each. Enforced server-side.
- **Auth required:** Universe features only work for signed-in players. Anonymous play gets no persistence.
- **Tier gating:** Universe manifest creation requires Creator or Pro tier.
- **No real-time sync.** Data is fetched at scene load and written on explicit calls. Eventual consistency.

## Acceptance Criteria

- Given a signed-in player who completed Game A, When they start Game B that reads Game A's progress keys, Then Game B's script can access those values via `forge.universe.getProgress()`.
- Given a game script calls `forge.universe.grantItem()`, When the manifest allows that item key, Then the item appears in the player's universe inventory across all games.
- Given a game script calls `forge.universe.setProgress("xp", 500)`, When the key is not in the manifest's `writes` list, Then the API returns a 403 and the write is rejected.
- Given an anonymous player, When game script calls any `forge.universe.*` method, Then it returns null/empty without error.

## Alternatives Considered

- **localStorage-based:** Rejected — no cross-game access, trivially tamperable, lost on device change.
- **Blockchain/NFT items:** Rejected — complexity, cost, and regulatory risk far exceed the benefit for a game creation tool.
- **Peer-to-peer sync:** Rejected — requires networking infrastructure we do not have (Phase 25 removed).
