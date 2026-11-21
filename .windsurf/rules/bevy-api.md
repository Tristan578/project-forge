# Bevy 0.18 API & ECS Patterns

## Migration from 0.16 to 0.18

### Bevy 0.17 changes
- **Events renamed**: `EventWriter<T>` → `MessageWriter<T>`, `EventReader<T>` → `MessageReader<T>`
- **Event registration**: `.add_event::<T>()` → `.add_message::<T>()`
- **Event derive**: `#[derive(Event)]` → `#[derive(Message)]`
- **Observer signatures**: `Trigger<T>` → `On<T>`
- **Picking events**: `Pointer<Pressed>` → `Pointer<Press>`, `trigger.target()` → `trigger.event_target()`
- **Macro rename**: `weak_handle!` → `uuid_handle!`
- **Sprite Anchor split**: `Anchor` is now a separate required component. Use `(Sprite { .. }, Anchor::CENTER)` tuple.
- **Render crate split**: `bevy_render` split into `bevy_mesh`, `bevy_camera`, `bevy_shader`, `bevy_image`, `bevy_light`

### Bevy 0.18 changes
- **AmbientLight**: `AmbientLight` → `GlobalAmbientLight`
- **Feature renames**: `bevy_mesh_picking_backend` → `mesh_picking`, `animation` → `gltf_animation`, `zstd` → `zstd_rust`
- **Post-processing split**: `bevy_core_pipeline` split into `bevy_post_process`, `bevy_anti_alias`
- **set_index_buffer**: Dropped offset parameter (2 args, not 3)
- **reinterpret_stacked_2d_as_array**: Now returns `Result`
- **Assets::insert**: Now returns `Result`

### Import Path Changes (0.16 → 0.18)

| Old Path | New Path |
|----------|----------|
| `bevy::render::mesh::*` | `bevy::mesh::*` |
| `bevy::render::render_resource::PrimitiveTopology` | `bevy::mesh::PrimitiveTopology` |
| `bevy::render::render_asset::RenderAssetUsages` | `bevy::asset::RenderAssetUsages` |
| `bevy::render::render_resource::{Shader, ShaderRef}` | `bevy::shader::{Shader, ShaderRef}` |
| `bevy::core_pipeline::bloom::*` | `bevy::post_process::bloom::*` |
| `bevy::core_pipeline::contrast_adaptive_sharpening::*` | `bevy::anti_alias::contrast_adaptive_sharpening::*` |

## ECS System Limits

- **Query tuple limit (15):** Split into separate `Query<>` params
- **add_systems tuple limit (~20):** Split into multiple `add_systems` calls
- **System parameter limit (16):** Merge related queries
- **Query conflicts (B0001):** Use `ParamSet<(Query<...>, Query<...>)>`
- **Resource conflicts (B0002):** Cannot have both `Res<T>` and `ResMut<T>`

## Library-Specific

### bevy_rapier3d v0.33
- `RapierConfiguration` is a **Component** (not Resource)
- `DebugRenderContext` is a **Resource** (not Component)
- Never enable `parallel` feature (rayon panics on WASM)

### bevy_panorbit_camera v0.34
- Uses `yaw`/`pitch`/`target_yaw`/`target_pitch` — NO `alpha`/`beta` fields
- Smoothness range is 0.0-1.0

### transform-gizmo-bevy v0.9 (local fork)
- Path dependency: `path = "../.transform-gizmo-fork/crates/transform-gizmo-bevy"`
- Needs default features. Don't set `default-features = false`

### bevy_hanabi 0.18 (GPU Particles)
- `EffectAsset::new(capacity, spawner, module)` builder pattern
- Registration gated behind `#[cfg(feature = "webgpu")]`

## Rust Gotchas

- Float type inference: `.abs()` on match-returned floats needs explicit `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields before ownership move
- `Option<&&T>` from query find: Use `.and_then(|(_, sd)| sd.cloned())`
