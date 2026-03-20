# Bevy 0.18 API Reference

## Event System (0.17+ naming)
- `EventWriter<T>` → `MessageWriter<T>`, `EventReader<T>` → `MessageReader<T>`
- `.add_event::<T>()` → `.add_message::<T>()`
- `#[derive(Event)]` → `#[derive(Message)]`
- Observer params: `Trigger<T>` → `On<T>`
- Picking: `Pointer<Pressed>` → `Pointer<Press>`, `trigger.target()` → `trigger.event_target()`

## Required Components (no more bundles)
- `Mesh3d(handle) + MeshMaterial3d(handle) + Transform` — NOT `PbrBundle`
- `Sprite { .. }` + `Anchor::CENTER` as separate components (Anchor variants: UPPER_CASE)
- `Handle<T>` is NOT a Component — wrap in newtypes (e.g., `GltfSourceHandle(pub Handle<Gltf>)`)
- Hierarchy: `ChildOf` replaces `Parent`; use `child_of.parent()`
- Despawn: `entity.despawn()` is recursive by default
- Fog: `DistanceFog` replaces `FogSettings`
- MSAA: Component on camera entity, not global resource

## ECS System Limits
- Query tuple limit: **15 components max**. Split into separate Query params.
- System parameter limit: **16 params**. Merge related queries if needed.
- add_systems tuple limit: **~20**. Split into multiple calls.
- Query conflicts (B0001): `&T` vs `&mut T` on same component → use `ParamSet`
- Resource conflicts (B0002): `Res<T>` + `ResMut<T>` → use only `ResMut<T>`
- SystemSet ordering: `configure_sets()` before `.in_set()` usage

## Import Paths (0.18)
| What | Path |
|------|------|
| Mesh, Indices, VertexAttributeValues | `bevy::mesh::*` |
| PrimitiveTopology | `bevy::mesh::PrimitiveTopology` |
| RenderAssetUsages | `bevy::asset::RenderAssetUsages` |
| Shader, ShaderRef | `bevy::shader::*` |
| Bloom | `bevy::post_process::bloom::*` (needs `bevy_post_process` feature) |
| CAS sharpening | `bevy::anti_alias::contrast_adaptive_sharpening::*` (needs `bevy_anti_alias`) |
| ChromaticAberration | `bevy::post_process::effect_stack::ChromaticAberration` |
| AmbientLight | `GlobalAmbientLight` (renamed in 0.18) |

## 0.18-Specific Breaking Changes
- `AssetSourceBuilder`: No `::default()`. Use `::new(reader_fn)` or `::platform_default()`
- `set_index_buffer`: 2 args, not 3 (offset dropped)
- `reinterpret_stacked_2d_as_array`: Returns `Result`
- `Assets::insert`: Returns `Result`
- Feature renames: `bevy_mesh_picking_backend` → `mesh_picking`, `animation` → `gltf_animation`
- Post-processing split: `bevy_core_pipeline` → `bevy_post_process` + `bevy_anti_alias`

## Component Forward-Compatibility
- Bloom: Always use `..Default::default()` (has `scale` field)
- AudioData: Must include `bus` field (added Phase A)
- Particles: `bevy_hanabi` under `webgpu` feature only. Data types always compiled.
- StandardMaterial: scalar `clearcoat` and `clearcoat_perceptual_roughness` exist
