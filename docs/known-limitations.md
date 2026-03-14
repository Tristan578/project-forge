# Known Limitations

This document provides an honest accounting of features that are partially implemented or have genuine technical constraints. For unbuilt roadmap features, see the Phase Roadmap in `.claude/CLAUDE.md`. Note: Editor Collaboration (Phase 24) and Multiplayer Networking (Phase 25) stubs were removed in PF-141/PF-142 — these will be rebuilt from scratch when prioritized.

> **Last updated:** 2026-03-14

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
| 2D Joints | 2D-4 | Full Rapier2D `ImpulseJoint` lifecycle — `manage_joint2d_lifecycle` creates joints on Play, cleans up on Stop. 4 types: Revolute (limits/motors), Prismatic (axis/limits/motors), Rope, Spring. Undo/redo via `Joint2dChange` |

### Partially implemented

| Feature | Phase | What works | What's missing | Ticket |
|---------|-------|------------|----------------|--------|
| 2D Skeletal Animation | 2D-5 | Bone hierarchy animation (keyframe interpolation with 5 easing modes, 2-bone analytical IK solver, Gizmos bone rendering), `SkeletonData2d` with bones/slots/skins/IK, inspector UI, 11 MCP commands. Vertex skinning algorithm (LBS with bind-pose inverse) fully implemented in `skin_vertices_lbs`. | **No mesh attachment creation** — `AttachmentData::Mesh` with vertex/weight data cannot be created via UI or MCP command. The skinning pipeline runs but finds no mesh data. | PF-330 |

**Workaround:** For skeletal animation, use sprite animation state machines instead.

## LOD & Performance (Phase 31)

**Status: Fully implemented**

Working:
- `LodData` ECS component with per-entity distance thresholds
- Runtime `update_lod_levels` system: calculates camera distance, updates `current_lod` (0-3), emits `LOD_CHANGED` events
- LOD Inspector panel with distance/ratio sliders and backend selector
- Performance budget UI (`set_performance_budget` works, `get_performance_stats` emits real FPS/frame-time/entity-count)
- `set_lod_distances` propagates global distance thresholds to all entities
- **Mesh decimation** via pure Rust QEM (Quadric Error Metric / Garland-Heckbert) algorithm in `mesh_simplify.rs` (840 lines, 30+ unit tests). Two backends: QEM (quality, attribute-preserving) and Fast (position-only). Commands: `generate_lods`, `optimize_scene`, `set_simplification_backend`
- Scene persistence: `LodData` serialized, `LodMeshes` auto-regenerated on load via `regenerate_missing_lod_meshes`

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
- **Occlusion uses binary detection** — automatic raycasting dispatches in the play-tick loop but only produces on/off state. Graduated occlusion amount (distance-based attenuation) is not yet wired up, despite `updateOcclusionAmount(amount: 0-1)` existing in the audio manager.
- **Ticket:** PF-329: "Graduated audio occlusion via physics raycasting"

## Shader Application (Phase 23)

**Status: 7 built-in effects work, arbitrary custom WGSL does not**

The shader node graph editor compiles to WGSL, and compiled shaders can be applied to entities when they map to one of the 7 built-in effects (dissolve, hologram, force_field, lava_flow, toon, fresnel_glow). The `apply_shader_to_entity` handler infers the effect type from the compiled code. You can also apply effects directly by passing `shaderType`.

Limitation:
- **Arbitrary custom WGSL shaders** (those that don't match a built-in effect) cannot be applied. This requires Bevy's dynamic material pipeline, which has fundamental constraints on WASM targets. This is not a simple implementation gap — it's a Bevy-level architectural limitation.
