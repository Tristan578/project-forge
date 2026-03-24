# Spec: Player-Generated Content Toolkit

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-557
> **Scope:** Let players of published games create and share custom content (levels, skins, mods)

## Problem

Published SpawnForge games are static. Once exported, players can only play what the creator made. This limits engagement and community growth. Competing platforms (Roblox, Mario Maker, LittleBigPlanet) prove that player-generated content (PGC) drives retention 3-10x over static games.

SpawnForge creators should be able to **opt into** a PGC system that lets their players create custom levels, skins, or mods -- without the player needing the full SpawnForge editor.

## Existing Infrastructure

- **Game export pipeline** (`web/src/lib/export/`) produces standalone HTML+WASM+assets.
- **`.forge` scene format** (`engine/src/core/scene_file.rs`) is JSON-serializable.
- **Runtime WASM binary** (`runtime` feature) strips editor systems but retains the ECS.
- **Script sandbox** (`web/src/lib/scripting/`) runs user TypeScript in Web Workers.
- **Marketplace** (`marketplace_assets` table) handles asset listing, purchase, reviews.
- **Publish system** (`publishedGames` table) tracks published games with CDN URLs.
- **Community tables** (ratings, comments, likes, follows, forks) exist.

The gap is a **lightweight in-game editor** that published game players can access.

## Solution

### Architecture: Creator-Configured PGC Toolkit

The game creator configures which PGC features to enable at publish time. Players get a scoped editor within the published game -- not the full SpawnForge editor.

```
Published Game (runtime WASM)
  |
  +-- PGC Toolkit (JS overlay, creator-configured)
  |     +-- Level Editor (entity placement, terrain painting)
  |     +-- Skin Editor (texture/color swaps on allowed entities)
  |     +-- Script Editor (sandboxed, allowlisted forge.* APIs only)
  |
  +-- Content Storage (R2 per-game bucket or Neon JSONB)
  |
  +-- Content Browser (in-game gallery of community creations)
```

### Phase 1: Level Editor Toolkit

A lightweight level editor overlay that runs inside published games.

#### Engine Changes (Rust)

1. **`engine/src/core/pgc.rs`** -- PGC configuration component.
   - `PgcConfig` struct: `allowed_entity_types: Vec<EntityType>`, `grid_snap: Option<f32>`, `bounds: (Vec3, Vec3)`, `max_entities: u32`.
   - Serialized into `.forge` scene metadata.
   - Runtime feature: PGC systems only register when `PgcConfig` resource exists.

2. **`engine/src/core/commands/pgc.rs`** -- PGC-specific commands.
   - `pgc_place_entity` -- spawn from allowed types only, enforce bounds + max entities.
   - `pgc_remove_entity` -- delete player-placed entities (not creator originals).
   - `pgc_save_level` -- serialize player-placed entities to JSON.
   - `pgc_load_level` -- restore from JSON.
   - All commands validate against `PgcConfig` -- cannot spawn disallowed types.

3. **`engine/src/bridge/pgc.rs`** -- Bridge systems for PGC.
   - `apply_pgc_commands` system (registered under `runtime` feature).
   - Emits events: `pgc_level_saved`, `pgc_level_loaded`, `pgc_entity_placed`.

#### Web Changes

4. **`web/src/lib/export/pgcToolkit.ts`** -- Embeddable PGC UI generator.
   - At export time, if PGC is enabled, bundle a minimal React overlay into the game HTML.
   - Toolbar: entity palette (filtered by `allowed_entity_types`), delete tool, save/load.
   - Uses the same `handle_command()` bridge as the editor, scoped to PGC commands.

5. **`web/src/components/editor/PgcConfigPanel.tsx`** -- Creator-facing config in editor.
   - Toggle PGC on/off per scene.
   - Select allowed entity types (checkboxes).
   - Set bounds (visual gizmo or numeric input).
   - Set max entity count.
   - Preview: "Players will see X entity types in the level editor."

6. **`web/src/app/api/pgc/[gameId]/levels/route.ts`** -- Server-side level storage.
   - POST: save player level (JSON, max 1MB, rate limited).
   - GET: list community levels for a game (paginated).
   - Content stored in Neon JSONB (levels are small, ~10-100KB each).
   - Moderation: content filter on level names/descriptions.

#### DB Changes

7. **`web/src/lib/db/schema.ts`** -- New `player_levels` table.
   ```
   player_levels: id, game_id (FK published_games), creator_user_id (FK users),
     title, description, level_data (jsonb), play_count, likes, status (published/flagged/removed),
     created_at, updated_at
   ```

### Phase 2: Skin Editor

8. **Texture swap system** -- Players can recolor/retexture entities the creator marks as "skinnable."
   - Creator marks entities with `Skinnable` component + allowed color ranges.
   - Player UI: color picker, preset palettes, simple pattern stamps.
   - Skins saved as lightweight JSON (entity ID + color overrides).

### Phase 3: Community Browser + Sharing

9. **In-game content browser** -- Gallery of community levels/skins within the published game.
   - Sort by: newest, most played, highest rated.
   - One-click play for levels, one-click apply for skins.
   - Report button for inappropriate content.

10. **Cross-game content** (future) -- If two games use the same entity types, levels could be portable. Deferred -- requires standardized entity schemas.

## Constraints

- **No full editor in published games** -- PGC toolkit is deliberately limited. Players cannot access materials, physics config, scripting, or post-processing.
- **Storage limits** -- Free-tier games: 100 community levels, 50MB total. Pro: 10,000 levels, 5GB.
- **Moderation required** -- All player content goes through `moderateContent()` before publishing. Level data is JSON-only (no executable code in Phase 1).
- **No PGC scripts in Phase 1** -- Script editor deferred to Phase 3+ due to sandbox security concerns.
- **PGC commands are NOT MCP commands** -- They exist only in the runtime binary, not the editor AI.
- **WASM binary size** -- PGC systems add ~50KB to runtime binary. Acceptable within 15MB budget.

## Performance Budgets

| Operation | Budget |
|-----------|--------|
| PGC entity placement | < 16ms (within frame budget) |
| Level save (100 entities) | < 200ms |
| Level load (100 entities) | < 500ms |
| Community browser load | < 1s (paginated, 20 per page) |
| PGC toolkit JS overlay | < 100KB gzipped |

## Acceptance Criteria

- Given a creator enables PGC on a scene with "Cube" and "Sphere" allowed, When a player opens the level editor in the published game, Then they see only Cube and Sphere in the entity palette.
- Given a player places 5 entities and clicks Save, When they reload the game, Then they can load their saved level from a list.
- Given a player saves a level with a title containing profanity, When the save request reaches the server, Then the content filter rejects it with a user-friendly message.
- Given PGC is disabled for a scene, When the game is exported, Then no PGC toolkit code is bundled (zero overhead).
- Given a player tries to place entity type "PointLight" which is not in the allowed list, When they invoke the command, Then the engine rejects it and returns an error.

## Alternatives Considered

1. **Full SpawnForge editor embedded in games** -- Rejected. Too large (~15MB editor WASM), exposes creator IP, overwhelming UX for players.
2. **External level editor (separate web app)** -- Rejected. Breaks immersion. Players want to create within the game they're playing.
3. **File-based sharing (export/import JSON)** -- Considered as Phase 0 fallback. Simple but poor UX. Server-side storage is better.

## Phased Delivery

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | PGC config, entity placement, save/load, server storage | ~5 days |
| 2 | Skin editor, community browser | ~4 days |
| 3 | Script sandbox for PGC, cross-game portability | ~5 days |
