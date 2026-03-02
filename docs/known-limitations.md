# Known Limitations

This document provides an honest accounting of features that are partially implemented or have genuine technical constraints. For unbuilt roadmap features, see the Phase Roadmap in `.claude/CLAUDE.md`. Note: Editor Collaboration (Phase 24) and Multiplayer Networking (Phase 25) stubs were removed in PF-141/PF-142 — these will be rebuilt from scratch when prioritized.

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

### Partially implemented

| Feature | Phase | What works | What's missing | Ticket |
|---------|-------|------------|----------------|--------|
| 2D Joints | 2D-4 | `PhysicsJoint2d` ECS component, inspector UI, MCP commands | Rapier2D `ImpulseJoint` never created — metadata stored but no constraint solving, motors, or limits | Taskboard: "Wire up Rapier2D joint creation for 2D Joints" |
| 2D Skeletal Animation | 2D-5 | Bone hierarchy animation (keyframe interpolation with 5 easing modes, 2-bone analytical IK solver, Gizmos bone rendering), `SkeletonData2d` with bones/slots/skins/IK, inspector UI, 11 MCP commands | **No vertex skinning** — `VertexWeights` are parsed but never applied to deform mesh vertices. Bones drive transforms but don't deform meshes. Requires a GPU or CPU vertex deformation pipeline. | — |

**Workaround:** For joint-connected 2D objects, use 3D physics joints with an orthographic camera. For skeletal animation, use sprite animation state machines instead.

## LOD & Performance (Phase 31)

**Status: Distance-based LOD switching works, mesh decimation not available**

Working:
- `LodData` ECS component with per-entity distance thresholds
- Runtime `update_lod_levels` system: calculates camera distance, updates `current_lod` (0-3), emits `LOD_CHANGED` events
- LOD Inspector panel with distance/ratio sliders and honest status feedback
- Performance budget UI (`set_performance_budget` works, `get_performance_stats` emits real FPS/frame-time/entity-count)
- `set_lod_distances` propagates global distance thresholds to all entities

Limitation:
- **Automatic LOD mesh generation** (`generate_lods`, `optimize_scene`) requires a mesh decimation library (e.g. meshopt) not yet integrated. LOD level is tracked and emitted but mesh detail is not swapped.
- **Ticket:** Taskboard: "Integrate mesh decimation library for automatic LOD generation"

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

Limitation:
- **Occlusion is filter-based only** — no automatic raycasting to detect obstructions. The `updateOcclusionState()` API must be called manually from game scripts. The `forge.physics.raycast` API exists and could be integrated.
- **Ticket:** Taskboard: "Integrate physics raycasting with audio occlusion"

## Shader Application (Phase 23)

**Status: 7 built-in effects work, arbitrary custom WGSL does not**

The shader node graph editor compiles to WGSL, and compiled shaders can be applied to entities when they map to one of the 7 built-in effects (dissolve, hologram, force_field, lava_flow, toon, fresnel_glow). The `apply_shader_to_entity` handler infers the effect type from the compiled code. You can also apply effects directly by passing `shaderType`.

Limitation:
- **Arbitrary custom WGSL shaders** (those that don't match a built-in effect) cannot be applied. This requires Bevy's dynamic material pipeline, which has fundamental constraints on WASM targets. This is not a simple implementation gap — it's a Bevy-level architectural limitation.
