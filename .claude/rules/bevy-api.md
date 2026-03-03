# Bevy 0.18 API & ECS Patterns

## Migration from 0.16 to 0.18

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
- `bevy_core_pipeline`, `bevy_render`, `bevy_pbr`, `bevy_sprite`, `bevy_asset`, `bevy_gizmos`, `bevy_log`, `bevy_picking`, `bevy_gltf`, `bevy_scene`, `bevy_winit`

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

### bevy_rapier3d v0.33
- `RapierConfiguration` is a **Component** (not Resource) — use `Query<&mut RapierConfiguration>`
- `DebugRenderContext` is a **Resource** (not Component) — use `Option<ResMut<DebugRenderContext>>`
- Never enable `parallel` feature (rayon panics on WASM)
- Skip `picking-backend` (conflicts with bevy_picking)

### bevy_panorbit_camera v0.34
- Uses `yaw`/`pitch`/`target_yaw`/`target_pitch` — NO `alpha`/`beta` fields
- Smoothness range is 0.0-1.0 (NOT unbounded)

### transform-gizmo-bevy v0.9 (local fork)
- Local fork at `.transform-gizmo-fork/` patched for Bevy 0.18
- Path dependency: `path = "../.transform-gizmo-fork/crates/transform-gizmo-bevy"`
- Needs default features (`gizmo_picking_backend` + `mouse_interaction`). Don't set `default-features = false`

### bevy_hanabi 0.18 (GPU Particles)
- `EffectAsset::new(capacity, spawner, module)` + `.init()/.update()/.render()` builder
- `ExprWriter::new()` -> `writer.lit(val).uniform(other).expr()`. Call `finish()` AFTER all expressions
- `SpawnerSettings::rate(f32.into())` / `::once()` / `::burst()`
- `SimulationSpace::Global`/`Local`, `AlphaMode::Add`/`Blend`/`Premultiply`
- Key modifiers: `SetAttributeModifier`, `SetPositionSphereModifier`, `SetPositionCircleModifier`, `AccelModifier::new(expr)`, `LinearDragModifier::new(expr)`, `ColorOverLifetimeModifier`, `SizeOverLifetimeModifier`, `OrientModifier::new(OrientMode::FaceCameraPosition)`

## Rust Gotchas

- Float type inference: `.abs()` on match-returned floats needs explicit `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields needed for logging BEFORE the ownership move
- `Option<&&T>` from query find: Use `.and_then(|(_, sd)| sd.cloned())` to get `Option<T>` instead of `.as_ref()` which gives `Option<&&T>`
