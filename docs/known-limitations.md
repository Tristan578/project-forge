# Known Limitations

This document provides an honest accounting of features that are partially implemented or UI-only facades. Features listed here have editor UI and MCP command definitions, but limited or no engine integration.

> **Last updated:** 2026-03-01

## 2D Subsystem

The 2D engine has two tiers of readiness:

### Working (full Bevy ECS integration)

| Feature | Phase | Notes |
|---------|-------|-------|
| Sprites | 2D-1 | Real `Sprite` components with textures, tinting, flip, anchor, sorting layers |
| Camera 2D | 2D-1 | Real `Camera2d` + `OrthographicProjection` with zoom sync |
| Sprite Animation | 2D-2 | `TextureAtlas` frame advancement, per-frame timing, looping, ping-pong, state machines with bool/float/trigger conditions |
| Tilemaps | 2D-3 | Child `Sprite` entities per tile, multi-layer rendering, visibility, opacity, grid/manual atlas slicing |
| 2D Physics (bodies & colliders) | 2D-4 | Full Rapier2D simulation — rigid bodies, 5 collider shapes, mass/friction/restitution, sensors, CCD, gravity scale, debug rendering |

### Not implemented (metadata stored, no runtime behavior)

| Feature | Phase | What exists | What's missing |
|---------|-------|-------------|----------------|
| 2D Joints | 2D-4 | `Joint2dData` ECS component, inspector UI, MCP commands | No Rapier joint components created — no constraint solving, motors, or limits |
| 2D Skeletal Animation | 2D-5 | `SkeletonData2d` with bones/slots/skins/IK, fully wired inspector UI, runtime systems (keyframe interpolation with 5 easing modes, 2-bone analytical IK solver, Gizmos bone rendering in editor), 11 MCP commands | No vertex skinning (bones drive transforms but don't deform meshes) |

**Workaround:** For joint-connected 2D objects, use 3D physics joints with an orthographic camera. For skeletal animation, use sprite animation state machines instead.

## Editor Collaboration (Phase 24)

**Status: Local state simulation — no networking**

The collaboration system includes:
- Sync manager with local state tracking
- User avatar display
- Activity feed
- Entity locking UI

All state is local-only. No WebSocket server, no real-time synchronization between users. The sync manager simulates multi-user state for UI purposes only.

## Multiplayer Networking (Phase 25)

**Status: Local state simulation — no networking**

Similar to collaboration, the multiplayer system includes:
- Network client stub
- Spawn point configuration
- `forge.net` script API

No actual networking is implemented. All multiplayer state is local simulation. Calling `forge.net` methods in scripts has no cross-client effect.

## LOD & Performance (Phase 31)

**Status: Distance-based LOD switching works, mesh decimation not available**

LOD (Level of Detail) includes:
- `LodData` ECS component with per-entity distance thresholds
- Runtime `update_lod_levels` system: calculates camera distance, updates `current_lod` (0-3), emits `LOD_CHANGED` events
- LOD Inspector panel with distance/ratio sliders and honest status feedback
- Performance budget UI (`set_performance_budget` works, `get_performance_stats` emits real FPS/frame-time/entity-count)
- `set_lod_distances` propagates global distance thresholds to all entities

Remaining limitation:
- Automatic LOD mesh generation (`generate_lods`, `optimize_scene`) requires a mesh decimation library (e.g. meshopt) not yet integrated. LOD level is tracked and emitted but mesh detail is not swapped.

## Advanced Audio (Phase 20)

**Status: Mostly implemented**

Working:
- Spatial audio playback
- Audio bus routing and effects
- Reverb zones
- Audio layering and crossfades
- Adaptive music with stem mixing and intensity control
- Audio occlusion (per-entity low-pass filtering)
- Music stem layering

Remaining limitation:
- Occlusion is filter-based only — no automatic raycasting integration to detect obstructions. The `updateOcclusionState()` API must be called manually from game scripts.

## Shader Application (Phase 23)

**Status: Built-in effects work, arbitrary custom WGSL does not**

The shader node graph editor compiles to WGSL, and compiled shaders can be applied to entities when they map to one of the 7 built-in effects (dissolve, hologram, force_field, lava_flow, toon, fresnel_glow). The `apply_shader_to_entity` handler infers the effect type from the compiled code. You can also apply effects directly by passing `shaderType`.

Arbitrary custom WGSL shaders (those that don't match a built-in effect) cannot be applied — they require a dynamic material pipeline that is not yet implemented.
