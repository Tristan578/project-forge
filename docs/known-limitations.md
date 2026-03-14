# Known Limitations

This document provides an honest accounting of features that have genuine technical constraints or partial implementations. For unbuilt roadmap features, see the Phase Roadmap in `.claude/CLAUDE.md`. Note: Editor Collaboration (Phase 24) and Multiplayer Networking (Phase 25) stubs were removed in PF-141/PF-142 — these will be rebuilt from scratch when prioritized.

> **Last updated:** 2026-03-14

## 2D Subsystem

All five 2D phases have full Bevy ECS integration:

| Feature | Phase | Notes |
|---------|-------|-------|
| Sprites | 2D-1 | Real `Sprite` components with textures, tinting, flip, anchor, sorting layers |
| Camera 2D | 2D-1 | Real `Camera2d` + `OrthographicProjection` with zoom sync |
| Sprite Animation | 2D-2 | `TextureAtlas` frame advancement, per-frame timing, looping, ping-pong, state machines with bool/float/trigger conditions |
| Tilemaps | 2D-3 | Child `Sprite` entities per tile, multi-layer rendering, visibility, opacity, grid/manual atlas slicing |
| 2D Physics | 2D-4 | Full Rapier2D simulation — rigid bodies, 5 collider shapes, joints (4 types with constraint solving, motors, limits), sensors, CCD, gravity scale, debug rendering |
| 2D Skeletal Animation | 2D-5 | Bone hierarchy, keyframe interpolation (5 easing modes), 2-bone analytical IK, CPU-based vertex skinning (LBS), skins, auto-weight, inspector UI, 11 MCP commands |

## LOD & Performance (Phase 31)

**Status: Fully implemented**

- `LodData` ECS component with per-entity distance thresholds
- Runtime `update_lod_levels` system: calculates camera distance, updates `current_lod` (0-3), emits `LOD_CHANGED` events
- QEM mesh simplification (Garland-Heckbert algorithm) for automatic LOD mesh generation
- `generate_lods` and `optimize_scene` commands produce simplified meshes at each LOD level
- LOD Inspector panel with distance/ratio sliders
- Performance budget with real metrics (FPS, triangles, draw calls, memory)

## Advanced Audio (Phase 20)

**Status: Fully implemented**

- Spatial audio playback, audio bus routing and effects, reverb zones
- Audio layering and crossfades, adaptive music with stem mixing and intensity control
- Audio occlusion via physics raycasting — graduated low-pass filtering based on obstruction count
- Music stem layering, snapshots (save/load with gain ramp), loop point detection

## Shader Application

**Status: 7 built-in effects + mega-shader custom slots**

The shader node graph editor compiles to WGSL, and compiled shaders can be applied to entities. Two application paths exist:

1. **Built-in effects** (7): dissolve, hologram, force_field, lava_flow, toon, fresnel_glow, custom_wgsl. The `apply_shader_to_entity` handler infers the effect type from compiled code.
2. **Custom WGSL slots** (8): The mega-shader system provides 8 custom slots where arbitrary WGSL fragment code can be injected at runtime. Slot assignment uses hash-based allocation with linear probing for collision avoidance.

Limitation:
- **Fully dynamic materials** (creating new Bevy material types at runtime) are not possible on WASM targets due to Bevy's static pipeline architecture. The mega-shader approach works around this by pre-compiling slot dispatch into the shader, but each slot shares the same uniform interface (`forge_uniforms`).
- Custom WGSL code must conform to the mega-shader's input/output contract (receives `in.uv`, `in.world_normal`, `in.world_position`; must output `vec4<f32>` color).
