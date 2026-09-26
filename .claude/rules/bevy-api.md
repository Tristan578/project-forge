---
description: Bevy 0.19 API, 0.16->0.19 migration, ECS limits, library-specific patterns
paths:
  - "engine/**"
  - "**/*.rs"
  - "**/Cargo.toml"
---

# Bevy 0.19 API & ECS Patterns

The engine is on **Bevy 0.19.1** (wgpu 29) since #8887. Read the 0.19 section first; the
0.17/0.18 notes below it still apply.

## Migration from 0.16 to 0.19

### Bevy 0.17 changes (render crate split + event rename)
- **Events renamed**: `EventWriter<T>` → `MessageWriter<T>`, `EventReader<T>` → `MessageReader<T>`
- **Event registration**: `.add_event::<T>()` → `.add_message::<T>()`
- **Event derive**: `#[derive(Event)]` → `#[derive(Message)]` (for buffered events)
- **Observer signatures**: `Trigger<T>` → `On<T>` in observer function params
- **Picking events**: `Pointer<Pressed>` → `Pointer<Press>`, `trigger.target()` → `trigger.event_target()`
- **Macro rename**: `weak_handle!` → `uuid_handle!`
- **Sprite Anchor split**: `anchor` removed from `Sprite` struct; `Anchor` is now a separate required component. Use `(Sprite { .. }, Anchor::CENTER)` tuple. Anchor variants are UPPER_CASE constants: `Anchor::CENTER`, `Anchor::TOP_LEFT`, etc.
- **Render crate split**: `bevy_render` split into `bevy_mesh`, `bevy_camera`, `bevy_shader`, `bevy_image`, `bevy_light`

### Bevy 0.18 changes
- **AmbientLight**: `AmbientLight` → `GlobalAmbientLight`
- **Feature renames**: `bevy_mesh_picking_backend` → `mesh_picking`, `animation` → `gltf_animation`, `zstd` → `zstd_rust`
- **Post-processing split**: `bevy_core_pipeline` split into `bevy_post_process`, `bevy_anti_alias`
- **AssetSourceBuilder**: No more `::default()`. Use `AssetSourceBuilder::new(reader_fn)` or `::platform_default()`
- **set_index_buffer**: Dropped offset parameter. `pass.set_index_buffer(slice, format)` (2 args, not 3)
- **reinterpret_stacked_2d_as_array**: Now returns `Result`, must handle or discard with `let _ =`
- **Assets::insert**: Now returns `Result`, must handle or discard with `let _ =`

### Bevy 0.19 changes (#8887 — every item below was a compile error or a runtime trap here)
- **MSRV is rustc 1.95.** An older toolchain stops at dependency resolution ("bevy@0.19.1 requires rustc 1.95.0"), before any of our code compiles. CI uses `stable`.
- **Floor is 0.19.1, not 0.19.0**: per `docs/reviews/2026-09-01-changelog-review.md`, 0.19.0 has a sorted-batching regression that corrupts transparent meshes wherever indirect drawing is unavailable — our WebGL2 path (bevy PR #24708; not re-verified in #8887).
- **`bevy_scene` → `bevy_world_serialization`** (the old crate; `bevy::scene` is now the new BSN system and still COMPILES for some names, e.g. `ScenePlugin`, while meaning something else). `SceneRoot` → `WorldAssetRoot`, `ScenePlugin` → `WorldSerializationPlugin`, `SceneSpawner` → `WorldInstanceSpawner`, `Scene` → `WorldAsset`, `DynamicScene` → `DynamicWorld`. Cargo feature `bevy_scene` → `bevy_world_serialization`. glTF scenes still spawn through `WorldAssetRoot`.
- **`Skybox`** moved to `bevy_light` — use `bevy::light::Skybox` (`bevy::core_pipeline::Skybox` is only a re-export). Its `image` is `Option<Handle<Image>>`: construct with `image: Some(handle)`.
- **`shadows_enabled` → `shadow_maps_enabled`** on Bevy's `PointLight` / `DirectionalLight` / `SpotLight` (they gained `contact_shadows_enabled`, default `false`). Our own `LightData.shadows_enabled` / `QualitySettings.shadows_enabled` are wire fields and did NOT change — only the Bevy struct fields did.
- **`Assets::get_mut` returns `AssetMut<A>`**, not `&mut A`. Bind it `mut` (`if let Some(mut mesh) = meshes.get_mut(..)`) and pass `&mut mesh` where a `&mut A` is expected. The guard emits `AssetEvent::Modified` on deref-mut and holds the `Assets` borrow until dropped — scope it before calling `assets.add(..)` in the same function.
- **Prelude name clash:** `bevy::prelude` now exports Bevy's own `TransformGizmoPlugin`, colliding with the fork's glob import (E0659). `core/gizmo.rs` imports `transform_gizmo_bevy::prelude::TransformGizmoPlugin` explicitly; keep it.
- **`GizmoPlugin` adds `SkinnedMeshBoundsGizmoPlugin`**, which needs `Assets<SkinnedMeshInverseBindposes>` (registered by `bevy_mesh::MeshPlugin` under `DefaultPlugins`). A hand-built test `App` must `init_asset` it (`core/schedule_smoke.rs` does).
- **`MeshPipeline` is created in `RenderStartup`** (runs on the first render-world update, AFTER every plugin's `finish`). Reading it from `Plugin::finish`/`FromWorld` panics at startup — the compiler cannot see this. Build dependent pipelines in a `RenderStartup` system ordered `.after(MeshPipelineSystems)`.
- **Custom render pipelines**: `push_constant_ranges` → `immediate_size: u32`; `DepthStencilState::{depth_write_enabled, depth_compare}` are `Option`s; `MeshPipelineKey::HDR`/`from_hdr` and `ExtractedView::hdr` are gone — use `MeshPipelineKey::from_target_format(view.target_format)` and `key.target_format()`; `SortedRenderPhase::add` → `add_transient` (per-frame) or `add_retained`; `Transparent3d` needs `sorting_info` and its `distance` is recomputed from it every frame. `TransparentSortingInfo3d::AlwaysOnTop` sorts to `NEG_INFINITY`, i.e. it is drawn FIRST in the ascending transparent sort — it is not the 0.18 `distance: 0.` (see the fork's `render.rs`).
- **A pipeline drawn with `SetMeshViewBindGroup` must take its `MeshPipelineKey` from `ViewKeyCache`** (`view_key_cache.get(&view.retained_view_entity)`), never rebuild it from MSAA + target format + prepass markers. 0.19's view bind-group layout also varies with tonemapping-in-shader (LUT bindings 18/19, on every non-HDR camera), fog, SSR, contact shadows, OIT, atmosphere and SSAO. A rebuilt key compiles and passes native tests, and fails only in a browser, as a wgpu "BindGroupLayout ... is not compatible" validation error.
- **A wgpu validation error now QUITS the app.** 0.19's default `RenderErrorHandler` (`bevy_render::error_handler`) logs "Quitting the application due to Validation RenderError" and writes `AppExit`. The canvas stays up, no engine event reports it, and every later command (Play included) is queued and never processed. The transform gizmo hit exactly this (#8887): selecting any entity killed the editor, and the first visible symptom was Play never reaching `ENGINE_MODE_CHANGED`. **We now replace that default** with `core/render_errors.rs` (`RenderErrorReportingPlugin`, registered right after `DefaultPlugins`): a first validation/internal error is `Ignore`d, a second within 10 s and any out-of-memory or device loss is `StopRendering` (the main world, commands and saving keep running), and nothing ever writes `AppExit`. Each decision is emitted as `RENDER_ERROR` and shown by `components/editor/RenderErrorNotice.tsx`. Two traps in the API: the handler is a plain `fn` pointer, so state lives in a main-world resource (`RenderErrorTracker`), not a closure; and under `StopRendering` Bevy calls it again EVERY frame with the same error, so anything it emits must be deduplicated or the editor is flooded. A console showing "Quitting the application due to ... RenderError" now means the handler was not installed.
- **Resources are components.** Broad queries (`Query<Entity>`, `Query<()>`, `EntityRef`/`EntityMut`, all-`Option` tuples) now also match resource entities; filter with `Without<IsResource>` or a `With<T>`. At migration time every broad query in `engine/src` was either `With<…>`-filtered or used only via `.get(entity)`. A type can no longer derive both `Component` and `Resource`.
- **Web `Task<T>` drop cancels** the task — call `.detach()` for fire-and-forget. The engine spawns no tasks today (grep `Task<|TaskPool|spawn_local` in `engine/src`: 0 hits at #8887).
- **`AnimationTargetId` algorithm changed.** No `.forge` data carries one: `AnimationClipData` addresses channels by our `PropertyTarget`, and glTF clips are rebuilt from the asset on load. `core/scene_file.rs` `animation_round_trip_tests` pins the save/load path.
- Migration guide source: `bevyengine/bevy-website` → `content/learn/migration-guides/0.18-to-0.19.md` (bevy.org itself may be unreachable from agent sandboxes; the raw GitHub file is).

### Import Path Changes (0.16 → 0.18)

| Old Path | New Path |
|----------|----------|
| `bevy::render::mesh::{Mesh, Indices, VertexAttributeValues}` | `bevy::mesh::{Mesh, Indices, VertexAttributeValues}` |
| `bevy::render::render_resource::PrimitiveTopology` | `bevy::mesh::PrimitiveTopology` |
| `bevy::render::render_asset::RenderAssetUsages` | `bevy::asset::RenderAssetUsages` |
| `bevy::render::render_resource::{Shader, ShaderRef}` | `bevy::shader::{Shader, ShaderRef}` |
| `bevy::render::render_resource::AsBindGroup` | `bevy::render::render_resource::AsBindGroup` (unchanged) |
| `bevy::render::camera::{ClearColorConfig, Projection, ScalingMode}` | `bevy::prelude::*` (in prelude) |
| `bevy::core_pipeline::bloom::*` | `bevy::post_process::bloom::*` (needs `bevy_post_process` feature) |
| `bevy::core_pipeline::contrast_adaptive_sharpening::*` | `bevy::anti_alias::contrast_adaptive_sharpening::*` (needs `bevy_anti_alias` feature) |
| `bevy::core_pipeline::post_process::ChromaticAberration` | `bevy::post_process::effect_stack::ChromaticAberration` |
| `bevy::render::view::{ColorGrading, ColorGradingGlobal, ColorGradingSection}` | `bevy::render::view::*` (unchanged) |
| `bevy::pbr::ScreenSpaceAmbientOcclusion` | `bevy::pbr::ScreenSpaceAmbientOcclusion` (unchanged) |

### Required Bevy Features (for default-features = false)

Must enable these features for import paths to work through `bevy::`:
- `bevy_post_process` — for `bevy::post_process::bloom::*`, ChromaticAberration
- `bevy_anti_alias` — for `bevy::anti_alias::contrast_adaptive_sharpening::*`
- `bevy_core_pipeline`, `bevy_render`, `bevy_pbr`, `bevy_sprite`, `bevy_asset`, `bevy_gizmos`, `bevy_log`, `bevy_picking`, `bevy_gltf`, `bevy_world_serialization` (was `bevy_scene` before 0.19), `bevy_winit`

## Retained from 0.14→0.16 Migration

- **Required components** replace bundles: `Mesh3d(handle)` + `MeshMaterial3d(handle)` + `Transform` instead of `PbrBundle`
- **Picking is built-in**: `bevy_picking` feature enables it; meshes are pickable by default (no `PickableBundle`)
- **Hierarchy**: `ChildOf` replaces `Parent`; use `child_of.parent()` instead of `parent.get()`
- **Despawn**: `entity.despawn()` is recursive by default (no `despawn_recursive()`)
- **Queries**: `query.single()` / `query.single_mut()` replace `get_single()` / `get_single_mut()`
- **Fog**: `DistanceFog` replaces `FogSettings`
- **MSAA**: Component on camera entity, not a global resource
- **Children iteration**: Yields `Entity` directly (no dereference needed)
- `Handle<T>` no longer implements `Component` — create wrapper newtypes (e.g. `GltfSourceHandle(pub Handle<Gltf>)`)

## ECS System Limits

- **Query tuple limit (15):** Split new components into separate `Query<(&EntityId, Option<&NewComponent>)>` params
- **add_systems tuple limit (~20):** Split into multiple `add_systems` calls (bridge/mod.rs already has 2 groups)
- **System parameter limit (16):** Merge related queries to reduce param count
- **Query conflicts (B0001):** Two queries with overlapping `&T` / `&mut T` cause runtime panic. Fix: `ParamSet<(Query<...>, Query<...>)>`, access `.p0()` / `.p1()` in separate scopes
- **Resource conflicts (B0002):** Cannot have both `Res<T>` and `ResMut<T>`. Use only `ResMut<T>`
- **SystemSet ordering:** `configure_sets()` must come before `.in_set()` usage. `InputPlugin` handles `PlaySystemSet` config

## Component Forward-Compatibility

- **Bloom:** Always use `..Default::default()` when constructing (has `scale` field)
- **AudioData `bus` field:** Added in Phase A. All construction sites must include `bus`
- **Feature-gated particles:** `bevy_hanabi` only under `webgpu` feature. Use `#[cfg(feature = "webgpu")]` for GPU rendering. Data types always compiled
- **StandardMaterial clearcoat:** Scalar `clearcoat` and `clearcoat_perceptual_roughness` exist

## Library-Specific

### bevy_rapier3d / bevy_rapier2d v0.35 (bevy 0.19, #8887; 0.34 audited in #8577)
- `RapierConfiguration` is a **Component** (not Resource) — use `Query<&mut RapierConfiguration>` (unchanged through 0.35)
- `DebugRenderContext` is a **Resource** (not Component) — use `Option<ResMut<DebugRenderContext>>` (unchanged through 0.35)
- 0.35 needed no source change here beyond the Bevy bump. Its async-scene-collider system reads `If<Res<WorldInstanceSpawner>>` (the 0.19 `SceneSpawner`). 0.36.0 also targets bevy ^0.19 and is a separate, Dependabot-proposed bump.
- Never enable `parallel` feature (rayon panics on WASM)
- Skip `picking-backend` (conflicts with bevy_picking)
- **0.34 breaking changes do NOT affect us** (audit #8577): `Velocity` fields renamed `linvel`→`linear` / `angvel`→`angular` (**we read and write them now** — see below); Collider/joint/query APIs now take `glam` vectors instead of nalgebra (we use no rapier nalgebra conversions); `TransformInterpolation::{start,end}` now `Option<Pose>`. WASM build green on both backends with 0.34. **`Velocity` is `.linear` / `.angular`, NOT `.linvel` / `.angvel`.** This note used to say "if you start reading them" — #9763 started, `set_linear_velocity_2d` and `set_angular_velocity_2d` write them, and the old names cost a compile cycle because the prediction was here and unread. `Mut<Velocity>` reports the old names as "no field on type Mut<...>", which reads like a deref problem rather than a rename.

**A `RigidBody` with no `Velocity` component still simulates — you just cannot read or set its velocity** (rapier's own doc comment on the struct). That is why both 2D velocity commands were `Not yet implemented` stubs and why `forge.physics2d.getVelocity` had nothing to mirror: nothing attached the component. `manage_physics2d_lifecycle` now inserts `Velocity::zero()` alongside the `RigidBody` on entering Play, which makes the long-standing `.remove::<Velocity>()` on the Play->Edit branch symmetric.

### bevy_panorbit_camera v0.35
- Uses `yaw`/`pitch`/`target_yaw`/`target_pitch` — NO `alpha`/`beta` fields
- Smoothness range is 0.0-1.0 (NOT unbounded)

### transform-gizmo-bevy v0.9 (local fork)
- Local fork at `.transform-gizmo-fork/` patched for Bevy 0.19 (#8887): `render.rs` builds its pipeline in `RenderStartup`, takes its whole view key from Bevy's `ViewKeyCache` (`gizmo_view_key`, pinned by `core/gizmo.rs` `gizmo_view_key_tests`), and anchors its `Transparent3d` sort at the camera to keep the 0.18 draw order; `lib.rs` scopes the `AssetMut` guard. Its egui-family pins (0.34) did not move.
- Path dependency: `path = "../.transform-gizmo-fork/crates/transform-gizmo-bevy"`
- Needs default features (`gizmo_picking_backend` + `mouse_interaction`). Don't set `default-features = false`

### bevy_hanabi 0.19 (GPU Particles)
- `EffectAsset::new(capacity, spawner, module)` + `.init()/.update()/.render()` builder
- `ExprWriter::new()` -> `writer.lit(val).uniform(other).expr()`. Call `finish()` AFTER all expressions
- `SpawnerSettings::rate(f32.into())` / `::once()` / `::burst()`
- `SimulationSpace::Global`/`Local`, `AlphaMode::Add`/`Blend`/`Premultiply`
- Key modifiers: `SetAttributeModifier`, `SetPositionSphereModifier`, `SetPositionCircleModifier`, `AccelModifier::new(expr)`, `LinearDragModifier::new(expr)`, `ColorOverLifetimeModifier`, `SizeOverLifetimeModifier`, `OrientModifier::new(OrientMode::FaceCameraPosition)`

## Rust Gotchas

- Float type inference: `.abs()` on match-returned floats needs explicit `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields needed for logging BEFORE the ownership move
- `Option<&&T>` from query find: Use `.and_then(|(_, sd)| sd.cloned())` to get `Option<T>` instead of `.as_ref()` which gives `Option<&&T>`
