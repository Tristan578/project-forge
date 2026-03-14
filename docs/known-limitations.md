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
| 2D Skeletal Animation | 2D-5 | Bone hierarchy animation (keyframe interpolation with 5 easing modes, 2-bone analytical IK solver, Gizmos bone rendering), `SkeletonData2d` with bones/slots/skins/IK, inspector UI, 11 MCP commands. Vertex skinning algorithm (LBS with bind-pose inverse) fully implemented in `skin_vertices_lbs`. Mesh attachments can be created via `add_skeleton2d_mesh_attachment` MCP command + chat handler. | **No UI for mesh attachment creation** — mesh attachments must be created via MCP command or chat; there is no visual editor panel for defining vertex/weight data. | PF-330 |

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

Remaining limitation:
- **Occlusion raycasting is physics-based only** — graduated distance-based attenuation is implemented (`handlePhysicsEvent` computes occlusion amount 0–1 and calls `audioManager.updateOcclusionAmount`), but occlusion requires physics colliders between source and listener. Scenes without collision geometry get no occlusion effect.

## Shader Application (Phase 23 + PF-331)

**Status: 7 built-in effects + 8 mega-shader slots for arbitrary custom WGSL**

The shader node graph editor compiles to WGSL. Compiled shaders can be applied to entities in two ways:

1. **Built-in effects** — when compiled WGSL matches one of the 7 named effects (dissolve, hologram, force_field, lava_flow, toon, fresnel_glow, none), `apply_shader_to_entity` maps to that effect directly via `shaderType`. You can also set the type explicitly.

2. **Mega-shader slots** — arbitrary custom WGSL is supported via the `CustomShaderRegistry` (8 independent named slots, 0–7). Slot functions receive `(color, uv, time, params: array<f32, 16>)` and return a `vec4<f32>`. The engine hot-swaps the `forge_effects.wgsl` asset at runtime when a slot is registered.

   - `register_custom_shader` — uploads a WGSL function body to a slot (0–7)
   - `apply_custom_shader` — attaches a slot (1–8, 1-indexed) to an entity
   - `remove_custom_shader_slot` — clears a slot from the registry
   - `apply_shader_to_entity` with a graph ID automatically falls back to the mega-shader path when the compiled WGSL does not match a built-in effect.

Remaining limitations:
- **Slot count is fixed at 8** — this is determined at WGSL compile time by the switch dispatch in the fragment shader. Increasing it requires a WASM rebuild.
- **No texture-sampler parameters** — custom slot functions receive only `array<f32, 16>` floats and the per-fragment `color`/`uv`/`time` inputs. Binding additional textures per-slot is not currently supported.
- **Hot-swap latency** — shader asset replacement takes effect on the next frame after the Bevy `restitch_custom_shaders` system runs.
