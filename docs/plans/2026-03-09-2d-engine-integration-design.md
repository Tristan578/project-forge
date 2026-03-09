# 2D Engine Integration Design Document

**Date:** 2026-03-09
**Status:** Draft - Pending Review
**Scope:** Connecting 5 existing "UI ONLY" 2D phases to the Bevy engine backend
**Related Issue:** PF-5 (2D Engine Integration)

---

## 1. Executive Summary

SpawnForge has 5 completed "UI ONLY" 2D phases (2D-1 through 2D-5) that include Zustand stores, React inspectors, MCP commands, Rust pending-command queues, and Rust command dispatchers. However, the key discovery from this research is that **the engine integration is significantly more complete than the phase roadmap suggests**.

### Current State Assessment

| Phase | Roadmap Says | Actual Engine Status |
|-------|-------------|---------------------|
| 2D-1: Foundation | UI ONLY | **FULLY INTEGRATED** - Sprites render, Camera2d works, sorting layers functional, project type switching operational |
| 2D-2: Sprite Animation | UI ONLY | **FULLY INTEGRATED** - Sprite sheets slice into TextureAtlas, frame timing advances, animation state machine evaluates transitions |
| 2D-3: Tilemap System | UI ONLY | **FULLY INTEGRATED** - Tilemaps render as child sprite entities, multi-layer with opacity, hash-based change detection |
| 2D-4: 2D Physics | UI ONLY | **PARTIALLY INTEGRATED** - bevy_rapier2d simulation runs in Play mode, colliders/joints/forces/raycasts work, but edit-mode gizmo visualization is minimal |
| 2D-5: Skeletal 2D Animation | UI ONLY | **FULLY INTEGRATED** - Bones render as gizmo lines, keyframe interpolation works, IK solving runs, CPU vertex skinning deforms meshes |

This means the **"UI ONLY" label is inaccurate for 2D-1, 2D-2, 2D-3, and 2D-5**. The engine code exists in `bridge/sprite.rs`, `bridge/skeleton2d.rs`, `bridge/physics.rs`, and `core/physics_2d_sim.rs`. Systems are registered in `bridge/mod.rs`.

### What Actually Needs Work

The remaining gaps are:

1. **Scene export/load integration** -- 2D component data may not fully round-trip through `.forge` save/load
2. **Selection emission gaps** -- Some 2D components may not emit state on selection change
3. **Query handler gaps** -- Some MCP query commands may return empty/stub data
4. **Edit-mode 2D physics visualization** -- Collider shapes not rendered as gizmos in edit mode
5. **Phase roadmap accuracy** -- Labels need updating from "UI ONLY" to reflect actual status
6. **Integration testing** -- No E2E tests verify 2D rendering actually works

---

## 2. Architecture Overview

### Current Data Flow (Already Working)

```
React UI (spriteSlice.ts)
    |  dispatchCommand('set_sprite_data', {...})
    v
WASM handle_command()
    |  commands/sprites.rs dispatch()
    v
pending/sprites.rs queue
    |  PendingCommands.sprite_data_updates
    v
bridge/sprite.rs apply_sprite_data_updates()
    |  Mutates SpriteData ECS component
    v
bridge/sprite.rs sync_sprite_rendering()  [Changed<SpriteData> filter]
    |  Builds Bevy Sprite + Anchor + Transform.z
    v
Bevy 2D Rendering Pipeline
    |
    v
bridge/sprite.rs emit_sprite_on_selection()
    |  emit_sprite_changed() -> JS callback
    v
spriteEvents.ts handleSpriteEvent()
    |  SPRITE_UPDATED -> setSpriteData()
    v
React re-render
```

### Key Engine Files (Already Exist)

| File | LOC | Function |
|------|-----|----------|
| `core/sprite.rs` | 246 | SpriteData, SpriteSheetData, SpriteAnimatorData, AnimationStateMachineData components |
| `core/camera_2d.rs` | 44 | Camera2dData, Camera2dEnabled, Managed2dCamera, CameraBounds |
| `core/project_type.rs` | 19 | ProjectType resource (TwoD/ThreeD) |
| `core/tilemap.rs` | 56 | TilemapData, TilemapLayer, TilemapOrigin, TilemapEnabled |
| `core/tileset.rs` | ~30 | TilesetData component |
| `core/physics_2d.rs` | ~150 | Physics2dData, Physics2dEnabled, ColliderShape2d, JointType2d |
| `core/physics_2d_sim.rs` | ~300 | Rapier2d lifecycle management, Play/Edit mode transitions |
| `core/skeleton2d.rs` | ~100 | SkeletonData2d, Bone2dDef, IkConstraint2d, AttachmentData |
| `core/skeletal_animation2d.rs` | ~60 | SkeletalAnimation2d, SkeletalAnimPlayer2d, BoneKeyframe |
| `bridge/sprite.rs` | 1038 | All sprite, camera2d, spritesheet, tilemap bridge systems |
| `bridge/skeleton2d.rs` | 734 | All skeleton2d bridge systems + runtime animation + IK + skinning |
| `bridge/physics.rs` | ~600 | Includes 2D physics apply/toggle/force/raycast systems |
| `pending/sprites.rs` | 214 | All sprite/camera/tilemap pending queue structs |
| `commands/sprites.rs` | 836 | All sprite/skeleton2d/tilemap command dispatchers |

### System Registration (bridge/mod.rs)

The following 2D systems are already registered in `SelectionPlugin::build()`:

**Sprite systems (always run):**
- `apply_spawn_sprite_requests`
- `apply_sprite_data_updates`
- `apply_sprite_removals`
- `sync_sprite_rendering`
- `apply_sprite_sheet_updates` / `removals`
- `apply_sprite_animator_updates` / `removals`
- `apply_animation_state_machine_updates` / `removals`
- `sync_sprite_sheet_atlas`
- `evaluate_animation_state_machine`
- `animate_sprite_frames`
- `apply_tilemap_data_updates` / `removals`
- `sync_tilemap_rendering`
- `apply_project_type_changes`
- `apply_camera_2d_updates`
- `sync_camera_2d_rendering`

**Editor-only (gated by `#[cfg(not(feature = "runtime"))]`):**
- `emit_sprite_on_selection`
- `emit_tilemap_on_selection`

**Skeleton2d systems:**
- `apply_skeleton2d_creates`
- `apply_bone2d_adds` / `removes` / `updates`
- `apply_skeletal_animation2d_creates`
- `apply_keyframe2d_adds`
- `apply_skeletal_animation2d_plays`
- `apply_skeleton2d_skin_sets`
- `apply_ik_chain2d_creates`
- `apply_auto_weight_skeleton2d`
- `handle_skeleton2d_query`
- `advance_skeleton_animation` (runtime)
- `solve_ik_constraints_2d` (runtime)
- `apply_vertex_skinning_2d` (runtime)
- `render_skeleton_bones` (editor gizmos)
- `emit_skeleton2d_on_selection`

**2D Physics systems (in bridge/physics.rs):**
- `apply_physics2d_updates`
- `apply_physics2d_toggles`
- `apply_create_joint2d` / `update` / `remove`
- `apply_force2d` / `apply_impulse2d`
- `apply_raycast2d`
- `apply_gravity2d_updates`
- `apply_debug_physics2d_toggle`
- `handle_physics2d_query`

---

## 3. Gap Analysis for Phase 1 (2D Foundation)

Phase 2D-1 is **already engine-integrated**. Here is the evidence:

### Sprites: COMPLETE

- **Spawn:** `apply_spawn_sprite_requests` creates entities with `EntityType::Sprite`, `SpriteData`, `SpriteEnabled`, `Transform`
- **Update:** `apply_sprite_data_updates` applies partial field updates with undo history
- **Render:** `sync_sprite_rendering` builds Bevy `Sprite` + `Anchor` components from `SpriteData`, resolves textures from `TextureHandleMap`, sets Z from sorting layer
- **Remove:** `apply_sprite_removals` strips sprite components with undo
- **Selection emit:** `emit_sprite_on_selection` sends `SPRITE_UPDATED` events to JS
- **Entity factory:** `spawn_from_snapshot` handles `EntityType::Sprite` case (line 1117 of entity_factory.rs)
- **History:** `UndoableAction::SpriteChange` exists with undo/redo support

### Camera2d: COMPLETE

- **ProjectType switching:** `apply_project_type_changes` disables 3D camera, spawns orthographic 2D camera with `Camera2d` + `Managed2dCamera` + `Camera2dEnabled`
- **Update:** `apply_camera_2d_updates` applies zoom/pixel_perfect/bounds
- **Render sync:** `sync_camera_2d_rendering` maps `Camera2dData.zoom` to `OrthographicProjection.scale`
- **Event:** `emit_camera_2d_changed` sends state to JS

### Sorting Layers: COMPLETE

- **Z-ordering:** `z_from_sorting()` converts layer name + order to Z depth (Background=0, Default=100, Foreground=200, UI=300)
- **Applied:** `sync_sprite_rendering` calls `z_from_sorting` and sets `Transform.translation.z`
- **JS side:** `sortingLayers` array in `spriteSlice.ts` manages layers locally (add/remove/toggle visibility)

### Identified Gaps in 2D-1

1. **Sorting layer visibility not enforced in engine** -- JS tracks `SortingLayerData.visible` but the engine does not hide sprites on invisible layers. The `sync_sprite_rendering` system does not check layer visibility.

2. **Camera2d bounds not enforced** -- `Camera2dData.bounds` is stored but no system clamps the camera position to those bounds during play mode.

3. **Pixel-perfect rendering** -- `Camera2dData.pixel_perfect` is stored but not connected to any Bevy pixel-snapping logic.

4. **Grid2d settings** -- `grid2d` (snap-to-grid) exists in JS store but has no engine counterpart. This is appropriate since grid is an editor overlay, not a rendering concern.

5. **Scene export** -- Need to verify `SpriteData`, `Camera2dData`, `SpriteSheetData`, `TilemapData` are included in `snapshot_scene` and `SceneFile` serialization.

---

## 4. Phase-by-Phase Remaining Work

### Phase 2D-1: Foundation -- Minimal Remaining Work

| Gap | Effort | Priority |
|-----|--------|----------|
| Sorting layer visibility enforcement | Small (add `EntityVisible` check in sync) | Medium |
| Camera2d bounds clamping (play mode) | Small (new system, ~30 lines) | Low |
| Pixel-perfect snapping | Medium (Bevy doesn't have built-in pixel snap for 2D) | Low |
| Scene export verification | Small (test round-trip) | High |
| Update phase roadmap label | Trivial | High |

### Phase 2D-2: Sprite Animation -- Minimal Remaining Work

All core systems exist and are registered:
- Sprite sheet slicing into TextureAtlas: `sync_sprite_sheet_atlas`
- Frame timing advancement: `animate_sprite_frames`
- Animation state machine evaluation: `evaluate_animation_state_machine`

| Gap | Effort | Priority |
|-----|--------|----------|
| Emit sprite sheet/animator state on selection | Small (add to emit system) | Medium |
| State machine parameter updates from script API | Verify forge.sprite API works | Medium |
| Scene export of SpriteSheetData/AnimatorData | Verify round-trip | High |

### Phase 2D-3: Tilemap System -- Minimal Remaining Work

Tilemap rendering is fully operational:
- `apply_tilemap_data_updates` inserts TilemapData + TilemapEnabled
- `sync_tilemap_rendering` builds child `TileEntity` sprites with TextureAtlas
- Hash-based change detection avoids unnecessary rebuilds
- Multi-layer rendering with per-layer Z offsets and opacity

| Gap | Effort | Priority |
|-----|--------|----------|
| Tileset loading from asset pipeline | Verify texture handle resolution | Medium |
| Collision layer -> Rapier2d colliders | Medium (new system, ~100 lines) | Medium |
| Scene export of TilemapData | Verify round-trip | High |

### Phase 2D-4: 2D Physics -- Most Complete After Foundation

bevy_rapier2d integration exists:
- `Physics2dPlugin` manages lifecycle (Edit: store config, Play: attach Rapier components)
- Collider shapes, rigid body types, joints all convert to Rapier2d equivalents
- Forces, impulses, raycasts work
- Collision events fire and propagate to JS

| Gap | Effort | Priority |
|-----|--------|----------|
| Edit-mode collider shape gizmos | Medium (render collider outlines, ~150 lines) | Medium |
| One-way platform support | Medium (Rapier2d collision filtering) | Low |
| Surface velocity (conveyor belts) | Small (Rapier2d property) | Low |
| Joint2d gizmo visualization | Small (~50 lines) | Low |

### Phase 2D-5: Skeletal 2D Animation -- Most Complex but Implemented

Full implementation exists:
- Bone hierarchy stored in `SkeletonData2d`
- Keyframe interpolation with 5 easing types
- 2-bone analytical IK solver
- CPU vertex skinning via weighted bone transforms
- Bone gizmo rendering in editor
- Auto-weight computation (inverse-square distance)

| Gap | Effort | Priority |
|-----|--------|----------|
| Skin attachment rendering (sprites on bones) | Medium (~100 lines) | Medium |
| Blend tree evaluation (multiple animations) | Medium (~150 lines) | Low |
| Scene export of SkeletonData2d | Verify round-trip | High |

---

## 5. Bevy 2D/3D Camera Coexistence

### Current Approach (Already Implemented)

The project uses a **camera switching** strategy:

1. **3D Mode (default):** The 3D PanOrbit camera is active (`Camera.is_active = true`), no 2D camera exists.

2. **2D Mode (project type = "2d"):** The 3D camera is deactivated (`cam.is_active = false`), and a `Managed2dCamera` entity is spawned with:
   - `Camera2d` (Bevy marker)
   - `Camera { order: 1, .. }` (renders after 3D if both somehow active)
   - `Projection::Orthographic(OrthographicProjection { scale: 1/zoom, ..default_2d() })`
   - `Transform::from_xyz(0, 0, 999.9)` (high Z to see all sprites)

3. **Switching back to 3D:** The managed 2D camera is despawned, 3D camera reactivated.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Undeletable 3D camera interference | Low | Already handled -- 3D camera has `Undeletable` marker, deactivated not despawned |
| Post-processing on 2D camera | Medium | 2D camera does not have Bloom/ChromAb components; adding would need separate post-processing path |
| Picking in 2D mode | Medium | Bevy's built-in picking uses ray intersection. Sprites are pickable by default via `bevy_picking`. May need testing for Z-ordered sprite picking accuracy |
| Mixed 2D/3D scenes | High | Currently not supported -- project is either 2D or 3D. Future work could allow both cameras active with render layers |

---

## 6. Component Mapping: JS Store to Rust ECS

### Already Mapped (Verified)

| JS Type (types.ts) | Rust Component | Bridge Sync |
|--------------------|---------------|-------------|
| `SpriteData` | `core::sprite::SpriteData` | `sync_sprite_rendering` -> `Sprite` + `Anchor` |
| `Camera2dData` | `core::camera_2d::Camera2dData` | `sync_camera_2d_rendering` -> `OrthographicProjection` |
| `SpriteSheetData` | `core::sprite::SpriteSheetData` | `sync_sprite_sheet_atlas` -> `TextureAtlas` |
| `SpriteAnimatorData` | `core::sprite::SpriteAnimatorData` | `animate_sprite_frames` -> `Sprite.texture_atlas.index` |
| `AnimationStateMachineData` | `core::sprite::AnimationStateMachineData` | `evaluate_animation_state_machine` -> state transitions |
| `TilemapData` | `core::tilemap::TilemapData` | `sync_tilemap_rendering` -> child `TileEntity` sprites |
| `TilesetData` | `core::tileset::TilesetData` | Used for atlas grid size in tilemap rendering |
| `Physics2dData` | `core::physics_2d::Physics2dData` | `Physics2dPlugin` -> Rapier2d components in Play mode |
| `ProjectType` | `core::project_type::ProjectType` | `apply_project_type_changes` -> camera switching |
| `SortingLayerData` | (JS-only, Z via `z_from_sorting`) | Layer name maps to Z base offset |

### Not Yet Mapped

| JS Type | Status | Notes |
|---------|--------|-------|
| `Grid2dSettings` | Editor-only, no engine needed | Snap-to-grid is a UI overlay |
| `SkeletonData2d` (JS) | Partially mapped | JS receives full skeleton via events, but does not send tilemap-style structural edits back |

---

## 7. Scene Export/Load (Critical Gap)

The `.forge` scene file format uses `EntitySnapshot` to serialize all entity state. The snapshot needs to include all 2D component data for save/load to work.

### EntitySnapshot Fields to Verify

Check that `snapshot_scene()` in `engine_mode.rs` queries for:
- `Option<&SpriteData>` -> `snapshot.sprite_data`
- `Option<&SpriteSheetData>` -> `snapshot.sprite_sheet_data`
- `Option<&SpriteAnimatorData>` -> `snapshot.sprite_animator_data`
- `Option<&AnimationStateMachineData>` -> `snapshot.animation_state_machine_data`
- `Option<&TilemapData>` -> `snapshot.tilemap_data`
- `Option<&Camera2dData>` -> (camera is Undeletable, excluded from export)
- `Option<&SkeletonData2d>` -> `snapshot.skeleton_data_2d`
- `Option<&Physics2dData>` -> `snapshot.physics_2d_data`

And that `spawn_from_snapshot()` in `entity_factory.rs` restores them.

**This is the highest-priority verification task** since save/load is fundamental.

---

## 8. Recommended Action Plan

### Immediate (Phase Roadmap Correction)

1. Update `.claude/CLAUDE.md` phase roadmap to change "UI ONLY" labels to accurate status descriptions
2. Add integration test coverage for 2D sprite rendering (E2E test that switches to 2D mode, spawns a sprite, verifies entity appears in scene graph)

### Short-Term (Scene Export Verification)

3. Verify all 2D component fields are included in `EntitySnapshot` and `spawn_from_snapshot`
4. Write a round-trip test: create 2D scene -> export -> load -> verify component data matches
5. Fix any missing snapshot fields

### Medium-Term (Polish Gaps)

6. Implement sorting layer visibility enforcement in `sync_sprite_rendering`
7. Add Camera2d bounds clamping system for play mode
8. Add edit-mode collider shape gizmo rendering for 2D physics
9. Implement tilemap collision layer -> Rapier2d collider generation

### Future (Enhancement)

10. Mixed 2D/3D render layer support
11. Pixel-perfect rendering pipeline
12. 2D post-processing effects
13. Sprite batching / instanced rendering for performance

---

## 9. Effort Estimates

| Work Item | Estimated Effort | Depends On |
|-----------|-----------------|------------|
| Phase roadmap label update | 15 min | Nothing |
| Scene export field audit | 2 hours | Nothing |
| Scene export fixes (if needed) | 2-4 hours | Audit |
| Sorting layer visibility | 1 hour | Nothing |
| Camera2d bounds system | 1 hour | Nothing |
| 2D collider gizmos | 4 hours | Nothing |
| Tilemap collision generation | 4 hours | Nothing |
| E2E 2D integration tests | 4 hours | WASM build |
| **Total remaining work** | **~18-22 hours** | |

This is dramatically less than the implied scope of "5 phases with no engine integration." The existing codebase is well-structured and the 2D pipeline is largely operational.

---

## 10. Technical Notes

### Bevy 0.18 Sprite API

- `Sprite` struct has `image`, `color`, `flip_x`, `flip_y`, `custom_size`, `texture_atlas` fields
- `Anchor` is a **separate required component** (Bevy 0.17+ change): `(Sprite { .. }, Anchor::CENTER)`
- Anchor variants are UPPER_CASE constants: `Anchor::CENTER`, `Anchor::TOP_LEFT`, etc.
- `TextureAtlasLayout::from_grid(tile_size, columns, rows, padding, offset)` for sprite sheets
- `Camera2d` is a marker component; projection is via `Projection::Orthographic(OrthographicProjection { .. })`

### bevy_rapier2d v0.33

- `RapierConfiguration` is a **Component** (not Resource)
- Never enable `parallel` feature (rayon panics on WASM)
- `dim2` feature provides 2D colliders, rigid bodies, joints
- `debug-render-2d` feature provides optional debug visualization

### Sorting Layer Z-Depth Strategy

```rust
// core/sprite.rs
pub fn z_from_sorting(data: &SpriteData) -> f32 {
    let layer_base = match data.sorting_layer.as_str() {
        "Background" => 0.0,
        "Default" => 100.0,
        "Foreground" => 200.0,
        "UI" => 300.0,
        _ => 100.0,
    };
    layer_base + (data.sorting_order as f32 * 0.01)
}
```

This provides 100 Z-units per layer, with 0.01 granularity within layers (supports 10,000 ordering values per layer before overlap).

---

## Appendix A: File Inventory

### Engine Files (Rust)

```
engine/src/core/
  sprite.rs              -- SpriteData, SpriteSheetData, SpriteAnimatorData, AnimationStateMachineData
  camera_2d.rs           -- Camera2dData, Camera2dEnabled, Managed2dCamera
  project_type.rs        -- ProjectType resource
  tilemap.rs             -- TilemapData, TilemapLayer, TilemapOrigin
  tileset.rs             -- TilesetData
  physics_2d.rs          -- Physics2dData, Physics2dEnabled, ColliderShape2d, JointType2d
  physics_2d_sim.rs      -- Physics2dPlugin, Rapier2d lifecycle
  skeleton2d.rs          -- SkeletonData2d, Bone2dDef, IkConstraint2d
  skeletal_animation2d.rs -- SkeletalAnimation2d, SkeletalAnimPlayer2d

engine/src/core/pending/
  sprites.rs             -- All sprite/camera/tilemap pending queue structs + bridge fns

engine/src/core/commands/
  sprites.rs             -- All command dispatch handlers

engine/src/bridge/
  sprite.rs              -- Sprite/camera/spritesheet/tilemap bridge systems (1038 lines)
  skeleton2d.rs          -- Skeleton2d bridge systems (734 lines)
  physics.rs             -- Includes 2D physics bridge systems
```

### Web Files (TypeScript)

```
web/src/stores/slices/
  spriteSlice.ts         -- SpriteSlice (sprites, camera2d, sorting, sheets, tilemaps, animators)
  types.ts               -- All 2D type definitions

web/src/hooks/events/
  spriteEvents.ts        -- SPRITE_UPDATED, CAMERA2D_UPDATED, TILEMAP_UPDATED, etc.

web/src/components/editor/
  SpriteInspector.tsx
  Camera2dInspector.tsx
  SortingLayerPanel.tsx
  SpriteAnimationInspector.tsx
  TilemapInspector.tsx
  TilemapToolbar.tsx
  TilemapLayerPanel.tsx
  Physics2dInspector.tsx
  SkeletonInspector.tsx
```
