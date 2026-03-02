# Third-Party Library APIs

## csgrs 0.20 (CSG Boolean Operations)
- **nalgebra version conflict:** Uses nalgebra 0.33 (via parry3d 0.19). Do NOT add nalgebra as direct dep — re-export via `csgrs::float_types::parry3d::na::{Point3, Vector3}`
- **CSG trait:** `union()`, `difference()`, `intersection()` are on `csgrs::traits::CSG` trait, not inherent. Must `use csgrs::traits::CSG;`
- **Module paths:** `csgrs::mesh::polygon::Polygon` (NOT `csgrs::polygon`), `csgrs::mesh::vertex::Vertex` (NOT `csgrs::vertex`). Vertex field is `pos` (NOT `position`)
- **from_polygons:** `Mesh::from_polygons(&[Polygon<S>], metadata: Option<S>)` — requires both args. Use `None`
- **earcut feature:** Must enable `"earcut"` for triangulation. Without it, `compile_error!`
- **doc-image-embed:** csgrs pulls this proc-macro. Compiles natively — needs Windows SDK LIB paths. `build_wasm.ps1` auto-detects

## noise 0.9 (Procedural Noise)
- `Fbm::<Perlin>::new(seed)` — constructor takes seed directly. `Seedable` trait removed in 0.9
- `MultiFractal` trait for `.set_octaves()/.set_frequency()/.set_persistence()`
- `NoiseFn::get()` takes `[f64; 2]`/`[f64; 3]`, returns f64 — cast to f32 for Bevy

## serde-wasm-bindgen 0.6
- Default `to_value()` serializes maps as JS `Map`. Use `Serializer::json_compatible()` for plain objects

## Terrain Patterns
- **TerrainData vs TerrainMeshData:** Separate components. `TerrainData` = noise config (serializable), `TerrainMeshData` = computed heightmap (serializable). Both in `EntitySnapshot`
- **Vertex coloring:** `Mesh::ATTRIBUTE_COLOR` with `Vec<[f32; 4]>` (green->brown->white). `StandardMaterial` must have `base_color: Color::WHITE`

## Texture Pipeline
- JS sends base64 data URL -> `apply_texture_load` decodes -> Bevy `Image` asset -> `TextureHandleMap` resource -> `sync_material_data` applies to `StandardMaterial` slots
- `TextureHandleMap` (`core/asset_manager.rs`): Maps asset ID strings to `Handle<Image>`
- All 5 slots synced: `base_color_texture`, `normal_map_texture`, `metallic_roughness_texture`, `emissive_texture`, `occlusion_texture`

## Particle GPU Rendering
- `ParticleData` + `ParticleEnabled` ECS components (always compiled) -> `sync_hanabi_effects` (WebGPU only) creates child entity with `ParticleEffect`
- Tracking via `HanabiEffectLink`/`HanabiEffectParent` markers
- `HanabiPlugin` registration gated behind `#[cfg(feature = "webgpu")]`
- Don't leave stub implementations connected to UI — if controls exist, backend must work
