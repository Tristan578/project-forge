# Bevy 0.16 API & ECS Patterns

## Migration from 0.14

- **Required components** replace bundles: `Mesh3d(handle)` + `MeshMaterial3d(handle)` + `Transform` instead of `PbrBundle`
- **Picking is built-in**: `bevy_picking` feature enables it; meshes are pickable by default (no `PickableBundle`)
- **Hierarchy**: `ChildOf` replaces `Parent`; use `child_of.parent()` instead of `parent.get()`
- **Events**: `EventWriter::write()` replaces `send()`
- **Despawn**: `entity.despawn()` is recursive by default (no `despawn_recursive()`)
- **Queries**: `query.single()` / `query.single_mut()` replace `get_single()` / `get_single_mut()`
- **Fog**: `DistanceFog` replaces `FogSettings`
- **MSAA**: Component on camera entity, not a global resource
- **Children iteration**: Yields `Entity` directly (no dereference needed)
- **Picking events**: Use `Pointer<Pressed>` NOT `Pointer<Click>`. `Down`->`Pressed`, `Up`->`Released`

## Feature Names

- Use `bevy_picking` (not `mesh_picking`)
- Use `bevy_mesh_picking_backend` for `MeshPickingPlugin` (explicit `app.add_plugins(MeshPickingPlugin)`)
- Use `bevy_log` when Bevy has `default-features = false`
- Use `"animation"` (NOT `"bevy_animation"`) in Cargo.toml — only `"animation"` propagates to `bevy_gltf` via `bevy_internal`, enabling `Gltf::named_animations`
- `Handle<T>` no longer implements `Component` — create wrapper newtypes (e.g. `GltfSourceHandle(pub Handle<Gltf>)`)
- `AnimationTransitions` — import via `bevy::animation::transition::AnimationTransitions` (private from `bevy::animation`)

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
- **StandardMaterial clearcoat:** Scalar `clearcoat` and `clearcoat_perceptual_roughness` exist. Texture fields (`clearcoat_texture`, etc.) do NOT exist in Bevy 0.16

## Library-Specific

### bevy_rapier3d v0.30
- `RapierConfiguration` is a **Component** (not Resource) — use `Query<&mut RapierConfiguration>`
- `DebugRenderContext` is a **Resource** (not Component) — use `Option<ResMut<DebugRenderContext>>`
- Never enable `parallel` feature (rayon panics on WASM)
- Skip `picking-backend` (conflicts with bevy_picking)

### bevy_panorbit_camera v0.28
- Uses `yaw`/`pitch`/`target_yaw`/`target_pitch` — NO `alpha`/`beta` fields
- Smoothness range is 0.0-1.0 (NOT unbounded)

### transform-gizmo-bevy v0.8
- Needs default features (`gizmo_picking_backend` + `mouse_interaction`). Don't set `default-features = false`

### bevy_hanabi 0.16 (GPU Particles)
- `EffectAsset::new(capacity, spawner, module)` + `.init()/.update()/.render()` builder
- `ExprWriter::new()` -> `writer.lit(val).uniform(other).expr()`. Call `finish()` AFTER all expressions
- `SpawnerSettings::rate(f32.into())` / `::once()` / `::burst()`
- `SimulationSpace::Global`/`Local`, `AlphaMode::Add`/`Blend`/`Premultiply`
- Key modifiers: `SetAttributeModifier`, `SetPositionSphereModifier`, `SetPositionCircleModifier`, `AccelModifier::new(expr)`, `LinearDragModifier::new(expr)`, `ColorOverLifetimeModifier`, `SizeOverLifetimeModifier`, `OrientModifier::new(OrientMode::FaceCameraPosition)`

## Rust Gotchas

- Float type inference: `.abs()` on match-returned floats needs explicit `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields needed for logging BEFORE the ownership move
- `Option<&&T>` from query find: Use `.and_then(|(_, sd)| sd.cloned())` to get `Option<T>` instead of `.as_ref()` which gives `Option<&&T>`
