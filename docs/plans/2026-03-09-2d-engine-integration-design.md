# 2D Engine Integration Design

**Date:** 2026-03-09
**Status:** Draft
**Scope:** Phases 2D-1 through 2D-5 engine-side implementation

## Problem Statement

SpawnForge has five "UI ONLY" 2D phases (2D-1 through 2D-5) that provide Zustand stores, React inspectors, and MCP commands but execute no engine logic. The Bevy engine needs Rust-side systems to handle these commands so that sprites render, tilemaps paint, 2D physics simulates, sprite animations play, and skeletal meshes deform on screen.

**Current state:** Commands flow from JS through `handle_command()` into `core/commands/sprites.rs`, which queues requests into `PendingCommands`. Bridge systems in `bridge/sprite.rs` and `bridge/skeleton2d.rs` already drain many of these queues and apply ECS changes. However, several subsystems are incomplete or missing runtime behavior.

## Existing Implementation Inventory

### What already works (engine-side)

| Feature | Bridge Module | Status |
|---------|--------------|--------|
| Project type switching (2D/3D) | `bridge/sprite.rs` | **Working** - disables 3D camera, spawns orthographic Camera2d |
| Camera2d zoom/bounds | `bridge/sprite.rs` | **Working** - syncs Camera2dData to OrthographicProjection |
| Sprite spawn/update/remove | `bridge/sprite.rs` | **Working** - full lifecycle, undo/redo, texture resolve, sorting |
| Sprite rendering sync | `bridge/sprite.rs` | **Working** - SpriteData -> Bevy Sprite + Anchor, Z from sorting |
| Sprite sheet atlas slicing | `bridge/sprite.rs` | **Working** - grid and manual modes, TextureAtlasLayout |
| Sprite frame animation | `bridge/sprite.rs` | **Working** - frame timing, ping-pong, speed, per-frame durations |
| Animation state machine | `bridge/sprite.rs` | **Working** - state transitions, bool/float/trigger params |
| Tilemap data CRUD | `bridge/sprite.rs` | **Working** - apply/remove with undo/redo |
| Tilemap rendering | `bridge/sprite.rs` | **Working** - child TileEntity sprites, atlas, layer Z, opacity |
| Skeleton2d CRUD | `bridge/skeleton2d.rs` | **Working** - create, add/remove/update bones, skins, IK |
| Skeletal animation playback | `bridge/skeleton2d.rs` | **Working** - keyframe interpolation, easing, looping |
| IK constraint solving | `bridge/skeleton2d.rs` | **Working** - 2-bone analytical IK |
| Vertex skinning | `bridge/skeleton2d.rs` | **Working** - CPU mesh deformation from bone weights |
| Bone gizmo rendering | `bridge/skeleton2d.rs` | **Working** - editor-only gizmo lines + joint circles |
| Auto-weight painting | `bridge/skeleton2d.rs` | **Working** - inverse-distance vertex weighting |
| 2D physics data CRUD | `bridge/physics.rs` | **Working** - Physics2dData/Physics2dEnabled ECS components |
| 2D physics simulation | `core/physics_2d_sim.rs` | **Working** - Rapier 2D lifecycle, colliders, joints, forces |

### What is genuinely missing or incomplete

After thorough analysis, the engine integration is **substantially more complete than the phase table suggests**. The "UI ONLY" label in the roadmap is outdated. Here is what remains incomplete:

#### 1. Sorting Layer Resource (minor gap)

**Problem:** `z_from_sorting()` in `core/sprite.rs` hardcodes 4 layer names (Background, Default, Foreground, UI). Custom sorting layers from the store (`addSortingLayer`/`removeSortingLayer`) never reach the engine.

**Impact:** Custom sorting layers fall back to the "Default" Z range (100.0), breaking expected draw order.

**Solution:**
- Add a `SortingLayerConfig` resource holding `Vec<SortingLayerDef>` (name + base Z).
- Add a `set_sorting_layers` command + pending queue + bridge system.
- Modify `z_from_sorting()` to look up the resource instead of hardcoded match.
- Wire `spriteSlice.setSortingLayers()` to dispatch the command.

**Estimated complexity:** Small (1 resource, 1 command, 1 system, minor refactor).

#### 2. Tileset CRUD commands (minor gap)

**Problem:** `TilesetData` is an ECS component and `tileset_query` is used in `sync_tilemap_rendering`, but there is no command to create/update/remove tilesets from JS. The store has `setTileset`/`removeTileset` which dispatch `set_tileset`/`remove_tileset`, but no command handler exists in `commands/sprites.rs`.

**Impact:** Tilemap rendering works if TilesetData components are manually attached, but the JS -> Rust pipeline for tilesets is broken.

**Solution:**
- Add `set_tileset` / `remove_tileset` command handlers in `commands/sprites.rs`.
- Add `TilesetDataUpdate` / `TilesetRemoval` request structs in `pending/sprites.rs`.
- Add bridge system `apply_tileset_updates` / `apply_tileset_removals` in `bridge/sprite.rs`.

**Estimated complexity:** Small (2 commands, 2 request types, 2 systems).

#### 3. Camera2d bounds enforcement (minor gap)

**Problem:** `Camera2dData.bounds` is stored and synced to the frontend, but no system clamps the camera's `Transform.translation` to the bounds during play mode.

**Impact:** Camera bounds are cosmetic only; the camera can move anywhere.

**Solution:**
- Add a `clamp_camera_2d_bounds` system in `bridge/sprite.rs` that runs in `PlaySystemSet` (both editor play-test and exported runtime builds -- NOT editor-only).
- Read `Camera2dData.bounds` and clamp `Transform.translation.xy()` each frame.

**Estimated complexity:** Tiny (1 system, ~15 lines).

#### 4. Pixel-perfect rendering (minor gap)

**Problem:** `Camera2dData.pixel_perfect` is stored but not acted upon. Bevy supports pixel-perfect snapping via rounding camera translation to integer world units.

**Impact:** Pixel art games can have sub-pixel jitter.

**Solution:**
- In `sync_camera_2d_rendering`, when `pixel_perfect` is true, round `Transform.translation.xy()` to the nearest pixel (based on zoom level).
- Alternatively, snap sprite transforms in a dedicated system.

**Estimated complexity:** Tiny (5-10 lines in existing system).

#### 5. Sprite sheet query (minor gap)

**Problem:** No `get_sprite_sheet` or `get_sprite_animator` query commands exist. MCP can query sprites and skeletons but not animation state.

**Impact:** AI/MCP cannot inspect animation state.

**Solution:**
- Add `QueryRequest::SpriteSheetState`, `SpriteAnimatorState`, `AnimStateMachineState` variants.
- Add query handlers and emit functions.

**Estimated complexity:** Small (3 query variants, 3 emit functions).

#### 6. Tilemap tile editing (functional gap)

**Problem:** `set_tilemap_data` replaces the entire TilemapData. There is no command to paint/erase individual tiles efficiently. The store has `tilemapActiveTool` and `tilemapActiveLayerIndex`, but these are UI-only state.

**Impact:** Every tile paint operation requires sending the full map data, which is expensive for large maps.

**Solution:**
- Add `paint_tile` / `erase_tile` / `fill_tiles` commands that modify individual tiles.
- Add corresponding request structs: `PaintTileRequest { entity_id, layer_index, x, y, tile_id }`.
- These mutate `TilemapData.layers[n].tiles[index]` in-place and trigger re-render via hash change.

**Estimated complexity:** Medium (3 commands, 3 request types, 3 handlers, 1 bridge system).

#### 7. Animated tiles (not implemented)

**Problem:** `TileMetadata` has an `animation` field with `frame_ids` and `frame_duration`, but no system advances animated tile frames at runtime.

**Impact:** Animated tiles (water, lava, conveyor belts) are static.

**Solution:**
- Add an `animate_tilemap_tiles` system that runs each frame.
- Tracks elapsed time per tilemap, cycles tile IDs for animated tiles.
- Requires tracking animation state per animated tile slot.

**Estimated complexity:** Medium (1 system, 1 tracking component, ~60 lines).

#### 8. 2D grid rendering (not implemented)

**Problem:** `Grid2dSettings` exists in the store but is never sent to the engine. No grid overlay renders in the viewport.

**Impact:** Snap-to-grid and visual grid are non-functional.

**Solution:**
- Add a `set_grid_2d` command.
- Add a `render_2d_grid` gizmo system that draws grid lines using `Gizmos::line_2d`.
- Grid snap can be applied in transform systems when `snapToGrid` is true.

**Estimated complexity:** Small (1 command, 1 system, ~40 lines).

## Architecture Design

### Phase Priority

Given that most core functionality already works, the remaining work is gap-filling rather than greenfield. Recommended implementation order:

**Phase A: Critical path (enables core 2D workflow)**
1. Sorting layer resource (draw order)
2. Tileset CRUD commands (tilemap pipeline)
3. Tile editing commands (paint/erase/fill)
4. Camera bounds enforcement

**Phase B: Polish (improves quality)**
5. Pixel-perfect rendering
6. 2D grid rendering
7. Animated tiles
8. Sprite sheet queries

### Component Architecture

All new components follow existing patterns:

```
core/<component>.rs      -- Component structs (derive Component, Serialize, Deserialize)
core/pending/sprites.rs  -- Request structs + queue methods + bridge fns
core/commands/sprites.rs -- dispatch() match arms + handler functions
bridge/sprite.rs         -- apply_* systems registered in SelectionPlugin::build()
bridge/events.rs         -- emit_* functions for JS callbacks
```

### New Resource: SortingLayerConfig

```rust
// core/sorting_layer.rs (new file)
#[derive(Resource, Clone, Debug)]
pub struct SortingLayerConfig {
    pub layers: Vec<SortingLayerDef>,
}

#[derive(Clone, Debug)]
pub struct SortingLayerDef {
    pub name: String,
    pub order: i32,   // Matches JS SortingLayerData.order
}

impl SortingLayerConfig {
    pub fn z_base(&self, layer_name: &str) -> f32 {
        self.layers.iter()
            .find(|l| l.name == layer_name)
            .map(|l| l.order as f32 * 100.0)
            .unwrap_or(100.0) // Default layer
    }
}

impl Default for SortingLayerConfig {
    fn default() -> Self {
        Self {
            layers: vec![
                SortingLayerDef { name: "Background".into(), order: 0 },
                SortingLayerDef { name: "Default".into(), order: 1 },
                SortingLayerDef { name: "Foreground".into(), order: 2 },
                SortingLayerDef { name: "UI".into(), order: 3 },
            ],
        }
    }
}
```

### New Commands

| Command | Payload | Handler |
|---------|---------|---------|
| `set_sorting_layers` | `{ layers: [{ name, order }] }` | Update SortingLayerConfig resource |
| `set_tileset` | `{ assetId, tileSize, gridSize, spacing, margin, tiles }` | Insert/update TilesetData component |
| `remove_tileset` | `{ assetId }` | Remove TilesetData component |
| `paint_tile` | `{ entityId, layerIndex, x, y, tileId }` | Mutate single tile in TilemapData |
| `erase_tile` | `{ entityId, layerIndex, x, y }` | Set tile to null in TilemapData |
| `fill_tiles` | `{ entityId, layerIndex, x, y, tileId }` | Flood-fill tiles in TilemapData |
| `set_grid_2d` | `{ enabled, size, snapToGrid }` | Update Grid2dConfig resource |

### New Pending Request Types

```rust
// In pending/sprites.rs

pub struct SetSortingLayersRequest {
    pub layers: Vec<SortingLayerDef>,
}

pub struct TilesetDataUpdate {
    pub asset_id: String,
    pub tileset_data: TilesetData,
}

pub struct TilesetRemoval {
    pub asset_id: String,
}

pub struct PaintTileRequest {
    pub entity_id: String,
    pub layer_index: usize,
    pub x: u32,
    pub y: u32,
    pub tile_id: Option<u32>, // None = erase
}

pub struct FillTilesRequest {
    pub entity_id: String,
    pub layer_index: usize,
    pub x: u32,
    pub y: u32,
    pub tile_id: u32,
}

pub struct SetGrid2dRequest {
    pub enabled: Option<bool>,
    pub size: Option<f32>,
    pub snap_to_grid: Option<bool>,
}
```

### System Registration

New systems added to `SelectionPlugin::build()` in `bridge/mod.rs`:

```rust
// Always-active systems
.add_systems(Update, sprite::apply_tileset_data_updates)
.add_systems(Update, sprite::apply_tileset_removals)
.add_systems(Update, sprite::apply_tile_paint_requests)
.add_systems(Update, sprite::apply_tile_fill_requests)
.add_systems(Update, sprite::apply_sorting_layer_updates)
.add_systems(Update, sprite::animate_tilemap_tiles)

// Play-mode system (editor play-test AND exported runtime builds)
.add_systems(Update, sprite::clamp_camera_2d_bounds.in_set(PlaySystemSet))

// Editor-only systems (stripped from runtime builds)
#[cfg(not(feature = "runtime"))]
{
    .add_systems(Update, sprite::render_2d_grid)
}
```

### Camera 2D/3D Coexistence Strategy

**Current implementation (already working):** When project type switches to 2D:
1. The 3D PanOrbitCamera entity's `Camera.is_active` is set to `false` (not despawned -- it has `Undeletable`).
2. A new entity with `Managed2dCamera` + `Camera2d` + orthographic `Projection` is spawned at Z=999.9.
3. When switching back to 3D, the managed 2D camera is despawned and the 3D camera reactivated.

**This design is sound.** No changes needed. Key invariants:
- Only one camera is active at a time (`Camera.is_active`).
- The 3D camera uses `Camera.order = 0`, the 2D camera uses `Camera.order = 1`.
- The 3D camera entity is never despawned (has `Undeletable` marker).
- Both camera types can coexist in the ECS for hybrid projects (e.g., 2D gameplay with 3D skybox), but only one renders at a time.

**Future consideration:** For truly hybrid 2D+3D scenes, both cameras could render simultaneously using different render layers. This is out of scope for this design.

### Event Emission to JS

New emit functions needed in `bridge/events.rs`:

```rust
pub fn emit_sorting_layers_changed(layers: &[SortingLayerDef]) { ... }
pub fn emit_tileset_changed(asset_id: &str, data: Option<&TilesetData>) { ... }
pub fn emit_grid_2d_changed(config: &Grid2dConfig) { ... }
```

Corresponding event handlers needed in `web/src/hooks/events/spriteEvents.ts`.

### Entity Snapshot Impact

`EntitySnapshot` already has:
- `sprite_data: Option<SpriteData>`
- `tilemap_data: Option<TilemapData>`
- `skeleton_data_2d: Option<SkeletonData2d>`

No new snapshot fields needed. `spawn_from_snapshot` already handles `EntityType::Sprite`.

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Sprite Z-fighting with overlapping sorting orders | Medium | Document that sorting_order uses 0.01 increments; warn at >10000 sprites per layer |
| Tilemap re-render performance on large maps (100x100+) | Medium | Current hash-based dirty check prevents redundant rebuilds; tile editing commands avoid full rebuild |
| Animated tile timer drift | Low | Use Bevy's `Time` resource delta; no frame-rate-dependent accumulation |
| Camera bounds system conflicts with editor pan | Low | Bounds enforcement only runs in `PlaySystemSet`; editor mode has free camera |

## Testing Strategy

### Unit tests (Rust)
- `SortingLayerConfig::z_base()` with custom layers
- `z_from_sorting()` with resource lookup
- Tile paint/erase boundary checks
- Flood fill algorithm correctness

### Integration tests (Vitest)
- Store slice round-trip: `setSortingLayers` -> command dispatch -> event -> store update
- Tileset CRUD lifecycle
- Tile editing commands

### E2E tests (Playwright)
- Switch project type 2D/3D and verify camera changes
- Paint tiles on a tilemap and verify rendering
- Create sprite with sorting layer and verify Z ordering

## Appendix: File Inventory

### Files to create
- `engine/src/core/sorting_layer.rs` -- SortingLayerConfig resource

### Files to modify
- `engine/src/core/mod.rs` -- add `pub mod sorting_layer`
- `engine/src/core/sprite.rs` -- refactor `z_from_sorting()` to accept config
- `engine/src/core/pending/sprites.rs` -- add new request types
- `engine/src/core/commands/sprites.rs` -- add new command handlers
- `engine/src/bridge/sprite.rs` -- add new apply systems
- `engine/src/bridge/events.rs` -- add new emit functions
- `engine/src/bridge/mod.rs` -- register new systems
- `web/src/stores/slices/spriteSlice.ts` -- wire sorting layer dispatch
- `web/src/hooks/events/spriteEvents.ts` -- handle new events

### Files unchanged (already working)
- `engine/src/core/camera_2d.rs`
- `engine/src/core/project_type.rs`
- `engine/src/core/skeleton2d.rs`
- `engine/src/core/skeletal_animation2d.rs`
- `engine/src/core/tilemap.rs`
- `engine/src/core/tileset.rs`
- `engine/src/core/physics_2d.rs`
- `engine/src/core/physics_2d_sim.rs`
- `engine/src/bridge/skeleton2d.rs`
