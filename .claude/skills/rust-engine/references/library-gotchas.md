# Library-Specific Gotchas

## bevy_rapier3d / bevy_rapier2d (v0.33)
- `RapierConfiguration` is a **Component** (not Resource) — use `Query<&mut RapierConfiguration>`
- `DebugRenderContext` is a **Resource** — use `Option<ResMut<DebugRenderContext>>`
- **Never** enable `parallel` feature (rayon panics on WASM)
- Skip `picking-backend` (conflicts with bevy_picking)
- `default-features = false` with `dim3`/`dim2`, `async-collider`, `debug-render-3d`/`2d`

## bevy_panorbit_camera (v0.34)
- Fields: `yaw`/`pitch`/`target_yaw`/`target_pitch` — NO `alpha`/`beta`
- Smoothness: 0.0-1.0 range (NOT unbounded)

## transform-gizmo-bevy (v0.9, local fork)
- Path dep at `.transform-gizmo-fork/crates/transform-gizmo-bevy`
- Needs default features (`gizmo_picking_backend` + `mouse_interaction`)
- Don't set `default-features = false`

## bevy_hanabi (v0.18, GPU Particles)
- `EffectAsset::new(capacity, spawner, module)` + `.init()/.update()/.render()` builder
- `ExprWriter::new()` → `writer.lit(val).uniform(other).expr()`. Call `finish()` AFTER all expressions
- `SpawnerSettings::rate(f32.into())` / `::once()` / `::burst()`
- Gate with `#[cfg(feature = "webgpu")]` for GPU rendering. Data types always compiled.

## csgrs (v0.20)
- Boolean ops: `use csgrs::traits::CSG;` (trait, not inherent)
- Paths: `csgrs::mesh::polygon::Polygon`, `csgrs::mesh::vertex::Vertex` (field: `pos` not `position`)
- nalgebra: re-export via `csgrs::float_types::parry3d::na::*` — do NOT add as direct dep
- `from_polygons`: requires both args (`&[Polygon]`, `metadata: Option<S>`)
- Needs `earcut` feature for triangulation

## noise (v0.9)
- `Fbm::<Perlin>::new(seed)` — constructor takes seed directly (`Seedable` trait removed)
- `MultiFractal` trait for `.set_octaves()/.set_frequency()/.set_persistence()`
- `NoiseFn::get()` takes `[f64; N]`, returns f64 — cast to f32

## serde-wasm-bindgen (v0.6)
- Default `to_value()` serializes maps as JS `Map` — use `Serializer::json_compatible()`

## Rust Gotchas (from production)
- Float type inference: `.abs()` on match-returned floats needs `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields BEFORE ownership move
- `Option<&&T>` from query `.find()`: Use `.and_then(|(_, sd)| sd.cloned())`
- `runtime` feature gates system *registrations* in bridge/mod.rs, NOT function definitions
