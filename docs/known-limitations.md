# Known Limitations

This document provides an honest accounting of features that are partially implemented or have genuine technical constraints. For unbuilt roadmap features, see the taskboard and the GitHub milestones. Note: Editor Collaboration (Phase 24) and Multiplayer Networking (Phase 25) stubs were removed in PF-141/PF-142 — these will be rebuilt from scratch when prioritized.

> **Last updated:** 2026-09-05

## Launch-readiness gaps (verified 2026-09-05)

The per-entry-point status of every capability — editor UI, in-app AI, game scripts, external MCP — lives in [capability-matrix.md](./capability-matrix.md) (rendered at docs.spawnforge.ai/capability-matrix and checked by `web/src/lib/config/__tests__/capabilityMatrix.test.ts`). The rows below are the gaps that matrix records which the rest of this file does not; each stays `unavailable` or `partial` there until its issue closes.

| Gap | Effect today | Tracking |
|-----|--------------|----------|
| No `PLATFORM_*` generation keys in production | Platform-key generation — 3D models, textures, sound effects, voice, sprites — fails for platform users. Users who add their own Meshy or ElevenLabs key under Settings → API Keys are unaffected. Settings also offers a Hyper3D key, but no route consumes it (`/api/generate/model` resolves Meshy only), and a Suno key, which cannot be obtained (#9522). There is no BYOK path for OpenAI or Replicate, so sprites have no working path at all. | [#9117](https://github.com/Tristan578/project-forge/issues/9117) |
| Image and background-removal capabilities have no code path | `image` (OpenAI) has no consuming route — `generate_skybox` is Meshy under `texture`, `apply_style_transfer` calls no provider — and `bg_removal` (remove.bg) is never called: `SpriteClient.removeBackground` has no caller and the `removeBackground` flag the `remove_background` handler sends is ignored by the sprite route. A key would not help either. | [#9734](https://github.com/Tristan578/project-forge/issues/9734) |
| Music generation cannot be provisioned | `PLATFORM_SUNO_KEY` cannot be obtained and BYOK Suno keys cannot be either, so music is unavailable through every entry point. [PR #9725](https://github.com/Tristan578/project-forge/pull/9725) is open and unmerged; once it lands it will refuse `generate_music` before any token is deducted, withhold the tool from the model and hide the dialog entry points. Until then the tool and the dialog entry remain and the request fails on the missing key. | [#9522](https://github.com/Tristan578/project-forge/issues/9522) |
| External MCP is local-only, and allowlisted | `NEXT_PUBLIC_MCP_BRIDGE` is absent from the production build, so `mcpBridgeEnabled()` is false and no external MCP client can attach to the production editor. A local build, or a production build made with the flag, can attach after the in-tab consent prompt — to 293 of the 351 commands: `web/src/lib/mcp/bridgeAllowlist.ts` withholds the `scripting`, `generation`, `export`, `publishing`, `security` and `economy` categories and the `ai:generate` / `project:manage` scopes by design. That local path has not been verified end to end. | [#9722](https://github.com/Tristan578/project-forge/issues/9722) |
| Phantom script commands | 16 names in `SCRIPT_ALLOWED_COMMANDS` have no engine arm: the velocity setters, `set_music_intensity` / `set_music_stems`, all four sprite-animation calls, the four `camera_*` names, `stop_skeletal_animation2d`, `set_ik_target2d` and `vibrate`. A script calling one gets no error and no effect. The `forge.*` functions that dispatch them: `forge.physics.setVelocity`, `forge.physics2d.setVelocity` / `setAngularVelocity`, `forge.audio.setMusicIntensity` / `loadStems`, every dispatching call on `forge.sprite`, `forge.camera.follow` / `stopFollow` / `setPosition` / `lookAt`, `forge.skeleton2d.stopAnimation` / `setIkTarget`, `forge.input.vibrate`. | [#9284](https://github.com/Tristan578/project-forge/issues/9284) |
| Declared but unimplemented script namespaces | `forgeTypes.ts` declares `forge.i18n` and `forge.leaderboard`; `scriptWorker.ts` builds neither, so a call throws at play time. | [#9733](https://github.com/Tristan578/project-forge/issues/9733) |
| Adaptive-music intensity has one working control | The AdaptiveMusicInspector slider writes `adaptiveMusicIntensity` to the store and nothing forwards it to `audioManager`; the script call dispatches a phantom (#9284). The chat tool `set_music_intensity` is the only path that reaches the audio engine. | [#9735](https://github.com/Tristan578/project-forge/issues/9735) |
| No editor UI for 2D mesh attachments | `add_skeleton2d_mesh_attachment` works by command and chat; there is no inspector panel for vertex/weight data (see 2D Subsystem below). | [#9732](https://github.com/Tristan578/project-forge/issues/9732) |
| Public MCP reference is down | docs.spawnforge.ai/mcp returns 500 because the commands manifest is not traced into the serverless function. Fix in [PR #9730](https://github.com/Tristan578/project-forge/pull/9730), open and unmerged. | [#9718](https://github.com/Tristan578/project-forge/issues/9718) |

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
| 2D Skeletal Animation | 2D-5 | Bone hierarchy animation (keyframe interpolation with 5 easing modes, 2-bone analytical IK solver, Gizmos bone rendering), `SkeletonData2d` with bones/slots/skins/IK, inspector UI, 11 MCP commands. Vertex skinning algorithm (LBS with bind-pose inverse) fully implemented in `skin_vertices_lbs`. Mesh attachments can be created via `add_skeleton2d_mesh_attachment` MCP command + chat handler. | **No UI for mesh attachment creation** — mesh attachments must be created via MCP command or chat; there is no visual editor panel for defining vertex/weight data. | [#9732](https://github.com/Tristan578/project-forge/issues/9732) (engine side shipped under PF-330 / #6364, closed) |

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
- Adaptive music with stem mixing and intensity control — via the chat tool `set_music_intensity` only; the inspector slider does not reach the audio engine ([#9735](https://github.com/Tristan578/project-forge/issues/9735)) and the script call is a phantom ([#9284](https://github.com/Tristan578/project-forge/issues/9284))
- Audio occlusion (per-entity low-pass filtering)
- Music stem layering

Remaining limitations:
- **Adaptive-music intensity from the UI** — see #9735 above.
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
