# Known Limitations

This document provides an honest accounting of features that are partially implemented or UI-only facades. Features listed here have editor UI and MCP command definitions, but limited or no engine integration.

> **Last updated:** 2026-02-28

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
| 2D Skeletal Animation | 2D-5 | `SkeletonData2d` with bones/slots/skins/IK, inspector UI, MCP commands | No bone rendering, no vertex skinning, no keyframe interpolation, no IK solving |

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

**Status: UI + metrics stubs, honest error responses**

LOD (Level of Detail) includes:
- `LodData` ECS component definition
- LOD Inspector panel
- Performance budget UI (`set_performance_budget` works, `get_performance_stats` returns local store data)

MCP handlers for LOD generation (`set_entity_lod`, `generate_lods`, `optimize_scene`, `set_lod_distances`) return `success: false` with descriptive errors explaining the feature requires engine-side mesh decimation.

## Advanced Audio (Phase 20)

**Status: Core audio works, adaptive features return honest errors**

Working:
- Spatial audio playback
- Audio bus routing and effects
- Reverb zones
- Audio layering and crossfades

Not implemented (returns `success: false` with descriptive error):
- Adaptive music (horizontal re-sequencing)
- Audio occlusion
- Music stem layering

## Shader Application (Phase 23)

**Status: Editor and compiler work, application to entities does not**

The shader node graph editor and WGSL compiler are functional — you can create node graphs and compile them to WGSL code. However, applying compiled shaders to entity materials is not implemented. The `apply_shader_to_entity` handler returns `success: false` with an explanation.
