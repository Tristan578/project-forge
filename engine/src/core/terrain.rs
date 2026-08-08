//! Procedural terrain generation using noise functions.
//!
//! This module provides heightmap-based terrain generation using the `noise` crate
//! with support for multiple noise algorithms (Perlin, Simplex, Value) and fractal
//! Brownian motion (Fbm). Height-based vertex coloring provides visual feedback.

use bevy::prelude::*;
use bevy::mesh::{Indices, Mesh, PrimitiveTopology};
use noise::{Fbm, MultiFractal, NoiseFn, Perlin, SuperSimplex, Value};
use serde::{Deserialize, Serialize};

/// Noise algorithm type for terrain generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoiseType {
    Perlin,
    Simplex,
    Value,
}

impl Default for NoiseType {
    fn default() -> Self {
        NoiseType::Perlin
    }
}

/// Configuration for procedural terrain generation.
/// Stored as ECS component on terrain entities.
/// `PartialEq` is load-bearing, not cosmetic: `apply_terrain_updates` compares the
/// merged config against the live one so a no-op update does not cost the user an
/// undo press.
#[derive(Debug, Clone, PartialEq, Component, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainData {
    /// Noise algorithm to use
    pub noise_type: NoiseType,
    /// Number of noise octaves (1-8)
    pub octaves: u32,
    /// Base frequency of the noise
    pub frequency: f64,
    /// Amplitude multiplier per octave (lacunarity-related)
    pub amplitude: f64,
    /// Overall height multiplier applied to noise output
    pub height_scale: f32,
    /// Random seed for noise generation
    pub seed: u32,
    /// Grid resolution (vertices per side: 32, 64, 128, 256)
    pub resolution: u32,
    /// World-space size of the terrain (width and depth)
    pub size: f32,
}

impl Default for TerrainData {
    fn default() -> Self {
        Self {
            noise_type: NoiseType::Perlin,
            octaves: 4,
            frequency: 0.03,
            amplitude: 0.5,
            height_scale: 10.0,
            seed: 42,
            resolution: 64,
            size: 50.0,
        }
    }
}

/// Smallest grid resolution that can produce a mesh. `build_terrain_mesh`
/// computes `(res - 1) * (res - 1)` quads in `usize`, so anything below 2
/// underflows; `sculpt_heightmap` divides by `res - 1` and would produce
/// infinities. Every entry point validates against this.
pub const MIN_TERRAIN_RESOLUTION: u32 = 2;

/// Largest grid resolution accepted from a command payload. A heightmap is
/// `resolution^2` f32s plus a mesh with `resolution^2` vertices and
/// `6 * (resolution - 1)^2` indices, all inside the 32-bit WASM heap: 1024 is
/// ~4 MB of heights and ~25 MB of mesh buffers, already generous. Without a
/// cap, a single `spawn_terrain` with `resolution: 100000` allocates 40 GB and
/// aborts the whole WASM instance, losing the user's unsaved scene.
pub const MAX_TERRAIN_RESOLUTION: u32 = 1024;

/// Returns `Some(reason)` when a terrain config cannot be turned into a mesh.
///
/// Rejects rather than clamps: a caller that asked for a 100000-vertex grid did
/// not mean 1024, and silently substituting a different config makes the
/// spawn/update look successful while producing terrain nobody asked for.
///
/// Non-finite floats are refused here rather than at the noise call because
/// `f64::NAN` propagates through Fbm into every height, and a NaN vertex
/// position makes the entire mesh vanish from the render with no error anywhere.
pub fn terrain_data_rejection(data: &TerrainData) -> Option<String> {
    if data.resolution < MIN_TERRAIN_RESOLUTION || data.resolution > MAX_TERRAIN_RESOLUTION {
        return Some(format!(
            "resolution {} is outside the supported range {}..={}",
            data.resolution, MIN_TERRAIN_RESOLUTION, MAX_TERRAIN_RESOLUTION,
        ));
    }
    if !data.size.is_finite() || data.size <= 0.0 {
        return Some(format!("size {} must be finite and positive", data.size));
    }
    if !data.height_scale.is_finite() {
        return Some(format!("height_scale {} must be finite", data.height_scale));
    }
    if !data.frequency.is_finite() {
        return Some(format!("frequency {} must be finite", data.frequency));
    }
    if !data.amplitude.is_finite() {
        return Some(format!("amplitude {} must be finite", data.amplitude));
    }
    None
}

/// A partial update to a [`TerrainData`]: every field is optional, and an
/// omitted field keeps the entity's LIVE value.
///
/// The command layer used to build a whole `TerrainData` starting from
/// `TerrainData::default()`, which made every update a REPLACE — nudging
/// `height_scale` silently reset seed, resolution, size, octaves, frequency,
/// amplitude and noise type to the defaults, regenerating completely different
/// terrain.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TerrainDataPatch {
    pub noise_type: Option<NoiseType>,
    pub octaves: Option<u32>,
    pub frequency: Option<f64>,
    pub amplitude: Option<f64>,
    pub height_scale: Option<f32>,
    pub seed: Option<u32>,
    pub resolution: Option<u32>,
    pub size: Option<f32>,
}

impl TerrainDataPatch {
    /// Overlay this patch onto a live config, returning the merged result.
    pub fn merge_into(&self, base: &TerrainData) -> TerrainData {
        TerrainData {
            noise_type: self.noise_type.unwrap_or(base.noise_type),
            octaves: self.octaves.unwrap_or(base.octaves),
            frequency: self.frequency.unwrap_or(base.frequency),
            amplitude: self.amplitude.unwrap_or(base.amplitude),
            height_scale: self.height_scale.unwrap_or(base.height_scale),
            seed: self.seed.unwrap_or(base.seed),
            resolution: self.resolution.unwrap_or(base.resolution),
            size: self.size.unwrap_or(base.size),
        }
    }
}

/// Marker component indicating this entity is an active terrain.
/// Following the PhysicsEnabled/ParticleEnabled pattern.
#[derive(Component, Debug, Clone, Copy)]
pub struct TerrainEnabled;

/// Serializable heightmap data for terrain entities.
/// Stored in EntitySnapshot for undo/redo and save/load.
#[derive(Debug, Clone, Serialize, Deserialize, Component)]
#[serde(rename_all = "camelCase")]
pub struct TerrainMeshData {
    /// Raw height values, row-major (resolution * resolution entries).
    pub heights: Vec<f32>,
    /// Grid resolution (vertices per side) at time of generation.
    pub resolution: u32,
    /// World-space size at time of generation.
    pub size: f32,
}

/// Generate a heightmap from noise parameters.
/// Returns a Vec<f32> of resolution * resolution height values.
pub fn generate_heightmap(data: &TerrainData) -> Vec<f32> {
    let res = data.resolution as usize;
    let mut heights = vec![0.0f32; res * res];

    // Build the noise source based on type
    match data.noise_type {
        NoiseType::Perlin => {
            let mut fbm = Fbm::<Perlin>::new(data.seed);
            fbm = fbm.set_octaves(data.octaves as usize);
            fbm = fbm.set_frequency(data.frequency);
            fbm = fbm.set_persistence(data.amplitude);
            sample_noise(&fbm, &mut heights, data);
        }
        NoiseType::Simplex => {
            let mut fbm = Fbm::<SuperSimplex>::new(data.seed);
            fbm = fbm.set_octaves(data.octaves as usize);
            fbm = fbm.set_frequency(data.frequency);
            fbm = fbm.set_persistence(data.amplitude);
            sample_noise(&fbm, &mut heights, data);
        }
        NoiseType::Value => {
            let mut fbm = Fbm::<Value>::new(data.seed);
            fbm = fbm.set_octaves(data.octaves as usize);
            fbm = fbm.set_frequency(data.frequency);
            fbm = fbm.set_persistence(data.amplitude);
            sample_noise(&fbm, &mut heights, data);
        }
    }

    heights
}

/// Sample noise into the heights array.
fn sample_noise<N: NoiseFn<f64, 2>>(noise: &N, heights: &mut [f32], data: &TerrainData) {
    let res = data.resolution as usize;
    for z in 0..res {
        for x in 0..res {
            let nx = x as f64;
            let nz = z as f64;
            let value = noise.get([nx, nz]);
            heights[z * res + x] = value as f32 * data.height_scale;
        }
    }
}

/// Build a Bevy Mesh from heightmap data.
/// Includes positions, normals (computed from gradient), and vertex colors.
///
/// Degenerate geometry yields an EMPTY mesh rather than panicking: the index
/// loop computes `(res - 1) * (res - 1)` in `usize`, so `resolution` below 2
/// underflows, and `rebuild_terrain_mesh` feeds this straight from a
/// deserialized `.forge` file on every scene load, undo and redo.
pub fn build_terrain_mesh(heights: &[f32], resolution: u32, size: f32) -> Mesh {
    let res = resolution as usize;
    let vertex_count = res * res;
    if resolution < MIN_TERRAIN_RESOLUTION
        || heights.len() < vertex_count
        || !size.is_finite()
        || size <= 0.0
    {
        let mut empty = Mesh::new(
            PrimitiveTopology::TriangleList,
            bevy::asset::RenderAssetUsages::default(),
        );
        // Populate every attribute the normal path emits. A mesh missing
        // ATTRIBUTE_POSITION is not a valid render input; an empty one is.
        empty.insert_attribute(Mesh::ATTRIBUTE_POSITION, Vec::<[f32; 3]>::new());
        empty.insert_attribute(Mesh::ATTRIBUTE_NORMAL, Vec::<[f32; 3]>::new());
        empty.insert_attribute(Mesh::ATTRIBUTE_COLOR, Vec::<[f32; 4]>::new());
        empty.insert_indices(Indices::U32(Vec::new()));
        return empty;
    }
    let half_size = size / 2.0;
    let step = size / (res as f32 - 1.0);

    let mut positions = Vec::with_capacity(vertex_count);
    let mut normals = Vec::with_capacity(vertex_count);
    let mut colors = Vec::with_capacity(vertex_count);

    // Track min/max height for color normalization
    let min_h = heights
        .iter()
        .cloned()
        .fold(f32::INFINITY, f32::min);
    let max_h = heights
        .iter()
        .cloned()
        .fold(f32::NEG_INFINITY, f32::max);
    let height_range = (max_h - min_h).max(0.001);

    // Generate positions and vertex colors
    for z in 0..res {
        for x in 0..res {
            let px = -half_size + x as f32 * step;
            let pz = -half_size + z as f32 * step;
            let py = heights[z * res + x];
            positions.push([px, py, pz]);

            // Height-based vertex coloring
            let t = (py - min_h) / height_range; // 0.0 = lowest, 1.0 = highest
            let color = height_to_color(t);
            colors.push(color);
        }
    }

    // Compute normals from heightmap gradient (central differences)
    for z in 0..res {
        for x in 0..res {
            let h_left = if x > 0 {
                heights[z * res + (x - 1)]
            } else {
                heights[z * res + x]
            };
            let h_right = if x < res - 1 {
                heights[z * res + (x + 1)]
            } else {
                heights[z * res + x]
            };
            let h_down = if z > 0 {
                heights[(z - 1) * res + x]
            } else {
                heights[z * res + x]
            };
            let h_up = if z < res - 1 {
                heights[(z + 1) * res + x]
            } else {
                heights[z * res + x]
            };

            // Normal from cross product of tangent vectors
            let dx = (h_right - h_left) / (2.0 * step);
            let dz = (h_up - h_down) / (2.0 * step);
            let normal = bevy::math::Vec3::new(-dx, 1.0, -dz).normalize();
            normals.push([normal.x, normal.y, normal.z]);
        }
    }

    // Generate triangle indices (two triangles per grid cell)
    let quad_count = (res - 1) * (res - 1);
    let mut indices: Vec<u32> = Vec::with_capacity(quad_count * 6);
    for z in 0..(res - 1) {
        for x in 0..(res - 1) {
            let top_left = (z * res + x) as u32;
            let top_right = top_left + 1;
            let bottom_left = ((z + 1) * res + x) as u32;
            let bottom_right = bottom_left + 1;

            // First triangle (top-left, bottom-left, top-right)
            indices.push(top_left);
            indices.push(bottom_left);
            indices.push(top_right);

            // Second triangle (top-right, bottom-left, bottom-right)
            indices.push(top_right);
            indices.push(bottom_left);
            indices.push(bottom_right);
        }
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Rebuild mesh from stored TerrainMeshData (for undo/redo/save/load).
pub fn rebuild_terrain_mesh(mesh_data: &TerrainMeshData) -> Mesh {
    build_terrain_mesh(&mesh_data.heights, mesh_data.resolution, mesh_data.size)
}

/// Convert normalized height (0.0-1.0) to vertex color.
/// Green at low, brown/tan at medium, white at high altitude.
fn height_to_color(t: f32) -> [f32; 4] {
    if t < 0.3 {
        // Low: green (grass)
        [0.2, 0.6, 0.15, 1.0]
    } else if t < 0.6 {
        // Medium: lerp green -> brown
        let local_t = (t - 0.3) / 0.3;
        [
            0.2 + local_t * 0.35,  // 0.2 -> 0.55
            0.6 - local_t * 0.3,   // 0.6 -> 0.30
            0.15 - local_t * 0.05, // 0.15 -> 0.10
            1.0,
        ]
    } else if t < 0.85 {
        // High: lerp brown -> grey/rock
        let local_t = (t - 0.6) / 0.25;
        [
            0.55 - local_t * 0.1,  // 0.55 -> 0.45
            0.30 + local_t * 0.15, // 0.30 -> 0.45
            0.10 + local_t * 0.30, // 0.10 -> 0.40
            1.0,
        ]
    } else {
        // Peak: lerp grey -> white (snow)
        let local_t = (t - 0.85) / 0.15;
        [
            0.45 + local_t * 0.55, // 0.45 -> 1.0
            0.45 + local_t * 0.55, // 0.45 -> 1.0
            0.40 + local_t * 0.60, // 0.40 -> 1.0
            1.0,
        ]
    }
}

/// Apply sculpting: modify the heightmap around `position` within `radius`.
///
/// `position` is in TERRAIN-LOCAL space (x, z) — the caller subtracts the
/// terrain entity's translation first. The whole command API speaks world
/// space, so `apply_terrain_sculpts` does that conversion; taking world space
/// here would mean the brush landed at the wrong spot on any terrain that is
/// not sitting at the origin.
///
/// `radius` is in world units and must be finite and positive.
/// `strength` is positive (raise) or negative (lower) and must be finite.
///
/// Degenerate inputs are a no-op rather than a panic or a poisoned heightmap:
/// a `.forge` scene file and a JS command payload can both carry them.
pub fn sculpt_heightmap(
    heights: &mut [f32],
    resolution: u32,
    size: f32,
    position: [f32; 2],
    radius: f32,
    strength: f32,
) {
    // A NaN height is unrecoverable — it propagates into every later mesh
    // rebuild and makes the terrain silently disappear — so refuse the inputs
    // that produce one instead of writing it.
    if resolution < MIN_TERRAIN_RESOLUTION
        || !size.is_finite()
        || size <= 0.0
        || !radius.is_finite()
        || radius <= 0.0
        || !strength.is_finite()
        || !position[0].is_finite()
        || !position[1].is_finite()
    {
        return;
    }

    let res = resolution as usize;
    if heights.len() < res * res {
        // A truncated heightmap (hand-edited scene file) would index out of
        // bounds below.
        return;
    }

    let half_size = size / 2.0;
    let step = size / (res as f32 - 1.0);

    // Convert local position to grid coordinates.
    let cx = ((position[0] + half_size) / step).round();
    let cz = ((position[1] + half_size) / step).round();
    let grid_radius = (radius / step).ceil();

    // Clamp the scan box to the grid BEFORE iterating. The naive
    // `-grid_radius..=grid_radius` sweep costs O((radius / step)^2), so a radius
    // of 1e9 on a step-1.0 grid is ~6.3e18 iterations — an unkillable hang of
    // the browser tab from a single unvalidated payload. Clamping makes the cost
    // O(resolution^2) no matter what the caller asks for, with identical output:
    // every cell the naive loop would have visited outside the grid was skipped
    // by the bounds check anyway.
    //
    // The clamp is done in f32 (not i32) on purpose: `1e9_f32 as i32` saturates
    // to i32::MAX, and `cx + dx` on the extremes would then overflow.
    let last = (res - 1) as f32;
    let x_start = (cx - grid_radius).clamp(0.0, last) as usize;
    let x_end = (cx + grid_radius).clamp(0.0, last) as usize;
    let z_start = (cz - grid_radius).clamp(0.0, last) as usize;
    let z_end = (cz + grid_radius).clamp(0.0, last) as usize;

    // A brush entirely off one side of the grid collapses to a single clamped
    // cell, which the distance check below then rejects.
    for gz in z_start..=z_end {
        for gx in x_start..=x_end {
            // Calculate distance from center in world units
            let wx = -half_size + gx as f32 * step;
            let wz = -half_size + gz as f32 * step;
            let dist = ((wx - position[0]).powi(2) + (wz - position[1]).powi(2)).sqrt();

            if dist > radius {
                continue;
            }

            // Smooth falloff (cosine): 1.0 at the brush centre decaying to 0.0
            // at the rim. `dist / radius` — NOT `1.0 - dist / radius`, which is
            // the same curve reflected and gives the centre zero strength and
            // the rim full strength, i.e. a raise brush that carves a ring.
            let falloff = ((dist / radius) * std::f32::consts::FRAC_PI_2).cos();
            let falloff = falloff * falloff; // Squared for smoother edges
            heights[gz * res + gx] += strength * falloff;
        }
    }
}

#[cfg(test)]
mod sculpt_tests {
    use super::*;

    /// An 8x8 grid over 7.0 world units: `step` is exactly 1.0, so grid cell
    /// `(x, z)` sits at world `(-3.5 + x, -3.5 + z)`.
    const RES: u32 = 8;
    const SIZE: f32 = 7.0;

    fn flat() -> Vec<f32> {
        vec![0.0f32; (RES * RES) as usize]
    }

    /// The brush must be strongest at its centre and weaken outward. Shipping
    /// the inverse (nothing at the centre, full strength at the rim) turns every
    /// raise into a crater ring, which is what this pins.
    #[test]
    fn sculpt_falloff_is_strongest_at_the_centre() {
        let mut heights = flat();
        // Centre on cell (3,3) => world (-0.5, -0.5), radius 2.0.
        sculpt_heightmap(&mut heights, RES, SIZE, [-0.5, -0.5], 2.0, 5.0);

        let centre = heights[3 * RES as usize + 3];
        let one_out = heights[3 * RES as usize + 4]; // dist 1.0
        let two_out = heights[3 * RES as usize + 5]; // dist 2.0 (at the rim)

        assert!(
            (centre - 5.0).abs() < 1e-4,
            "the brush centre must receive full strength, got {centre}",
        );
        assert!(
            one_out > 0.0 && one_out < centre,
            "falloff must decrease outward: centre {centre}, one_out {one_out}",
        );
        assert!(
            two_out < one_out,
            "falloff must keep decreasing to the rim: one_out {one_out}, two_out {two_out}",
        );
        assert!(
            two_out.abs() < 1e-4,
            "the rim must receive ~zero strength, got {two_out}",
        );
    }

    #[test]
    fn sculpt_leaves_everything_outside_the_radius_untouched() {
        let mut heights = flat();
        sculpt_heightmap(&mut heights, RES, SIZE, [-3.5, -3.5], 1.5, 5.0);

        // (2,2) is inside the square scan box but outside the circle (dist ~2.12).
        assert_eq!(heights[2 * RES as usize + 2], 0.0);
        // (7,7) is far outside the scan box entirely.
        assert_eq!(heights[7 * RES as usize + 7], 0.0);
    }

    #[test]
    fn sculpt_lowers_with_negative_strength() {
        let mut heights = flat();
        sculpt_heightmap(&mut heights, RES, SIZE, [-0.5, -0.5], 2.0, -5.0);
        let centre = heights[3 * RES as usize + 3];
        assert!(
            (centre + 5.0).abs() < 1e-4,
            "negative strength must lower the centre by the full strength, got {centre}",
        );
    }

    /// The scan cost must be bounded by the GRID, never by the caller's radius.
    /// The naive `-grid_radius..=grid_radius` square is O((radius/step)^2), so a
    /// radius of 1e9 on a step-1.0 grid is ~6.3e18 iterations — an unkillable
    /// hang of the browser tab, reachable from an unvalidated payload.
    ///
    /// A wall-clock assertion is the only honest way to pin "terminates": the
    /// pre-fix loop would blow any budget by many orders of magnitude.
    #[test]
    fn sculpt_with_an_enormous_radius_terminates_and_covers_the_whole_grid() {
        let mut heights = flat();
        let started = std::time::Instant::now();
        sculpt_heightmap(&mut heights, RES, SIZE, [-0.5, -0.5], 1e9, 5.0);
        let elapsed = started.elapsed();

        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "an enormous radius must cost O(grid), not O(radius^2); took {elapsed:?}",
        );
        // radius >> the grid, so every cell is well inside the brush and the
        // falloff is ~1.0 everywhere.
        for (index, height) in heights.iter().enumerate() {
            assert!(
                (height - 5.0).abs() < 1e-2,
                "cell {index} should be raised by ~5.0, got {height}",
            );
        }
    }

    /// The same bound must hold when the brush centre is far off-grid: clamping
    /// has to happen on both ends of the scan range, not just the upper one.
    #[test]
    fn sculpt_far_off_grid_terminates_without_touching_anything() {
        let mut heights = flat();
        let started = std::time::Instant::now();
        sculpt_heightmap(&mut heights, RES, SIZE, [-1e8, -1e8], 1e7, 5.0);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "an off-grid brush must not scan the space between it and the grid",
        );
        assert_eq!(heights, flat(), "a brush that misses the grid changes nothing");
    }

    /// NaN/inf anywhere in the inputs must be refused outright. `heights += NaN`
    /// poisons a cell permanently: every later mesh rebuild emits NaN vertex
    /// positions, so the terrain renders as nothing at all with no error.
    #[test]
    fn sculpt_with_non_finite_inputs_leaves_the_heightmap_untouched() {
        let cases: [(&str, [f32; 2], f32, f32); 7] = [
            ("NaN strength", [-0.5, -0.5], 2.0, f32::NAN),
            ("inf strength", [-0.5, -0.5], 2.0, f32::INFINITY),
            ("NaN radius", [-0.5, -0.5], f32::NAN, 5.0),
            ("inf radius", [-0.5, -0.5], f32::INFINITY, 5.0),
            ("NaN position", [f32::NAN, -0.5], 2.0, 5.0),
            ("inf position", [-0.5, f32::INFINITY], 2.0, 5.0),
            ("non-positive radius", [-0.5, -0.5], 0.0, 5.0),
        ];

        for (label, position, radius, strength) in cases {
            let mut heights = flat();
            sculpt_heightmap(&mut heights, RES, SIZE, position, radius, strength);
            assert_eq!(
                heights,
                flat(),
                "{label} must be refused, leaving the heightmap untouched",
            );
        }
    }

    /// A `resolution` below 2 makes `step` divide by zero, and a non-positive
    /// `size` makes it zero — both turn every write into NaN. Terrain loaded
    /// from a hand-edited `.forge` can carry either.
    #[test]
    fn sculpt_with_degenerate_geometry_is_a_no_op() {
        for (label, resolution, size) in [
            ("resolution 0", 0u32, SIZE),
            ("resolution 1", 1u32, SIZE),
            ("zero size", RES, 0.0f32),
            ("negative size", RES, -7.0f32),
            ("NaN size", RES, f32::NAN),
        ] {
            let mut heights = flat();
            sculpt_heightmap(&mut heights, resolution, size, [-0.5, -0.5], 2.0, 5.0);
            assert_eq!(heights, flat(), "{label} must be refused as a no-op");
        }
    }

    /// A heightmap shorter than `resolution^2` (a truncated or hand-edited
    /// `.forge`) must not index out of bounds.
    #[test]
    fn sculpt_with_a_short_heightmap_is_a_no_op() {
        let mut heights = vec![0.0f32; 4];
        sculpt_heightmap(&mut heights, RES, SIZE, [-0.5, -0.5], 2.0, 5.0);
        assert_eq!(heights, vec![0.0f32; 4]);
    }
}

#[cfg(test)]
mod build_terrain_mesh_guard_tests {
    use super::*;

    fn vertex_count(mesh: &Mesh) -> usize {
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
            .expect("a terrain mesh must always carry positions")
            .len()
    }

    /// `(res - 1) * (res - 1)` is computed in `usize`, so resolution 0 wraps to
    /// `usize::MAX` and tries to reserve ~1.8e19 indices. `rebuild_terrain_mesh`
    /// feeds this straight from a deserialized `.forge` file, so a hand-edited
    /// or truncated scene crashes the engine on load.
    #[test]
    fn degenerate_resolution_yields_an_empty_mesh_instead_of_panicking() {
        for resolution in [0u32, 1u32] {
            let mesh = build_terrain_mesh(&[], resolution, 10.0);
            assert_eq!(vertex_count(&mesh), 0, "resolution {resolution}");
        }
    }

    /// A heightmap shorter than `resolution^2` indexes out of bounds in the
    /// position loop. Same source: deserialized scene data.
    #[test]
    fn a_short_heightmap_yields_an_empty_mesh() {
        let mesh = build_terrain_mesh(&[0.0; 3], 8, 10.0);
        assert_eq!(vertex_count(&mesh), 0);
    }

    #[test]
    fn degenerate_size_yields_an_empty_mesh() {
        for size in [0.0f32, -5.0, f32::NAN] {
            let mesh = build_terrain_mesh(&[0.0; 64], 8, size);
            assert_eq!(vertex_count(&mesh), 0, "size {size}");
        }
    }

    /// The guard must not swallow the healthy path.
    #[test]
    fn a_valid_heightmap_still_builds_a_full_mesh() {
        let mesh = build_terrain_mesh(&[0.0; 64], 8, 7.0);
        assert_eq!(vertex_count(&mesh), 64);
    }

    /// `rebuild_terrain_mesh` is the undo/redo/scene-load entry point, so the
    /// guard has to hold through it too.
    #[test]
    fn rebuild_from_degenerate_mesh_data_is_safe() {
        let mesh = rebuild_terrain_mesh(&TerrainMeshData {
            heights: Vec::new(),
            resolution: 0,
            size: 10.0,
        });
        assert_eq!(vertex_count(&mesh), 0);
    }
}

#[cfg(test)]
mod terrain_data_validation_tests {
    use super::*;

    #[test]
    fn a_default_terrain_config_is_accepted() {
        assert_eq!(terrain_data_rejection(&TerrainData::default()), None);
    }

    /// Every rejection reason must actually fire — a validator whose arms are
    /// unreachable is decoration.
    #[test]
    fn every_degenerate_field_is_rejected() {
        let cases: [(&str, TerrainData); 9] = [
            ("resolution 0", TerrainData { resolution: 0, ..Default::default() }),
            ("resolution 1", TerrainData { resolution: 1, ..Default::default() }),
            (
                "resolution above the cap",
                TerrainData { resolution: MAX_TERRAIN_RESOLUTION + 1, ..Default::default() },
            ),
            ("zero size", TerrainData { size: 0.0, ..Default::default() }),
            ("negative size", TerrainData { size: -1.0, ..Default::default() }),
            ("NaN size", TerrainData { size: f32::NAN, ..Default::default() }),
            ("NaN height_scale", TerrainData { height_scale: f32::NAN, ..Default::default() }),
            ("inf frequency", TerrainData { frequency: f64::INFINITY, ..Default::default() }),
            ("NaN amplitude", TerrainData { amplitude: f64::NAN, ..Default::default() }),
        ];

        for (label, data) in cases {
            assert!(
                terrain_data_rejection(&data).is_some(),
                "{label} must be rejected",
            );
        }
    }

    /// The cap exists so a caller cannot ask for a 100_000^2 heightmap and OOM
    /// the WASM heap; the boundary itself must stay accepted.
    #[test]
    fn the_resolution_bounds_are_inclusive() {
        assert_eq!(
            terrain_data_rejection(&TerrainData {
                resolution: MIN_TERRAIN_RESOLUTION,
                ..Default::default()
            }),
            None,
        );
        assert_eq!(
            terrain_data_rejection(&TerrainData {
                resolution: MAX_TERRAIN_RESOLUTION,
                ..Default::default()
            }),
            None,
        );
    }
}

#[cfg(test)]
mod terrain_patch_tests {
    use super::*;

    fn base() -> TerrainData {
        TerrainData {
            noise_type: NoiseType::Value,
            octaves: 3,
            frequency: 0.11,
            amplitude: 0.77,
            height_scale: 12.5,
            seed: 7,
            resolution: 8,
            size: 7.0,
        }
    }

    /// The whole point of a patch: an omitted field keeps the LIVE value. The
    /// previous "build a full struct from defaults" shape silently reset the
    /// seven fields a caller did not mention.
    #[test]
    fn an_empty_patch_is_the_identity() {
        let merged = TerrainDataPatch::default().merge_into(&base());
        let original = base();
        assert_eq!(merged.noise_type, original.noise_type);
        assert_eq!(merged.octaves, original.octaves);
        assert_eq!(merged.frequency, original.frequency);
        assert_eq!(merged.amplitude, original.amplitude);
        assert_eq!(merged.height_scale, original.height_scale);
        assert_eq!(merged.seed, original.seed);
        assert_eq!(merged.resolution, original.resolution);
        assert_eq!(merged.size, original.size);
    }

    /// Setting one field must move exactly that field. Asserted per-field so a
    /// merge arm wired to the wrong destination cannot hide.
    #[test]
    fn each_field_can_be_patched_in_isolation() {
        let original = base();

        let merged = TerrainDataPatch { height_scale: Some(40.0), ..Default::default() }
            .merge_into(&original);
        assert_eq!(merged.height_scale, 40.0);
        assert_eq!(merged.seed, original.seed, "an unmentioned field must not move");
        assert_eq!(merged.resolution, original.resolution);
        assert_eq!(merged.size, original.size);
        assert_eq!(merged.noise_type, original.noise_type);

        let merged =
            TerrainDataPatch { noise_type: Some(NoiseType::Simplex), ..Default::default() }
                .merge_into(&original);
        assert_eq!(merged.noise_type, NoiseType::Simplex);
        assert_eq!(merged.height_scale, original.height_scale);

        let merged = TerrainDataPatch { octaves: Some(6), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.octaves, 6);

        let merged =
            TerrainDataPatch { frequency: Some(0.5), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.frequency, 0.5);

        let merged =
            TerrainDataPatch { amplitude: Some(0.25), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.amplitude, 0.25);

        let merged = TerrainDataPatch { seed: Some(999), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.seed, 999);

        let merged =
            TerrainDataPatch { resolution: Some(16), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.resolution, 16);
        assert_eq!(merged.size, original.size);

        let merged = TerrainDataPatch { size: Some(20.0), ..Default::default() }.merge_into(&original);
        assert_eq!(merged.size, 20.0);
        assert_eq!(merged.resolution, original.resolution);
    }
}

/// Terrain config changes waiting to be emitted to the JS shell.
///
/// The bridge had exactly one `TERRAIN_CHANGED` emitter and it fired only in
/// response to an explicit `get_terrain` query — which nothing in the web app
/// ever dispatched. So `editorStore.terrainData` stayed `{}` for the whole
/// session: spawning a terrain, editing its noise config, or loading a scene
/// containing one all left the Terrain inspector blank, and the user had no way
/// to see or re-edit the terrain they had just created.
///
/// This resource is the core-side half of the fix, so the "what changed"
/// decision is unit-testable natively; `bridge` only drains it and calls
/// `emit_terrain_changed`.
#[derive(Resource, Debug, Default)]
pub struct TerrainChangeEvents {
    pending: Vec<(String, TerrainData)>,
}

impl TerrainChangeEvents {
    /// Drain every queued change. Draining is the only read path, so a change
    /// cannot be emitted twice.
    pub fn take(&mut self) -> Vec<(String, TerrainData)> {
        std::mem::take(&mut self.pending)
    }

    /// Number of queued changes, for tests and diagnostics.
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

/// The exact wire shape of a `TERRAIN_CHANGED` event payload.
///
/// This lives in `core`, not in `bridge`, for one reason: `bridge` is compiled
/// only for `wasm32`, so a `#[cfg(test)]` beside it silently matches zero tests
/// under native `cargo test`. Declaring the payload here is what lets
/// `terrain_changed_wire_contract_tests` actually run and pin the shape.
///
/// `terrain_data` is deliberately NOT `#[serde(flatten)]`. It used to be, which
/// put every `TerrainData` field at the top level of the payload while the web
/// handler read a nested `payload.terrainData` — so the handler stored
/// `undefined` for every terrain and the inspector rendered nothing. The nested
/// form matches the sibling `SHADER_CHANGED` payload and `TerrainDataState`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainChangedPayload<'a> {
    pub entity_id: &'a str,
    pub terrain_data: &'a TerrainData,
}

/// Queue a `TERRAIN_CHANGED` notification for every terrain whose config was
/// added or mutated this frame.
///
/// `Changed<TerrainData>` covers insertion as well as mutation, so a freshly
/// spawned terrain and a scene-load restore both notify without a second system.
pub fn collect_terrain_changes(
    changed: Query<(&crate::core::entity_id::EntityId, &TerrainData), Changed<TerrainData>>,
    mut events: ResMut<TerrainChangeEvents>,
) {
    for (entity_id, data) in changed.iter() {
        events.pending.push((entity_id.0.clone(), data.clone()));
    }
}

#[cfg(test)]
mod terrain_change_event_tests {
    use super::*;
    use crate::core::entity_id::EntityId;

    /// A persistent `Schedule`, NOT `run_system_once`.
    ///
    /// `Changed<T>` is evaluated against the SYSTEM's own `last_run` tick, and
    /// `run_system_once` builds a fresh system every call whose `last_run` is
    /// zero — so every entity reads as changed on every invocation and a
    /// "nothing changed this frame" assertion can never fail. The regression
    /// this system exists to prevent (re-emitting on a quiet frame) is invisible
    /// under that harness.
    struct Harness {
        world: World,
        schedule: Schedule,
    }

    impl Harness {
        fn new() -> Self {
            let mut world = World::new();
            world.insert_resource(TerrainChangeEvents::default());
            let mut schedule = Schedule::default();
            schedule.add_systems(collect_terrain_changes);
            Self { world, schedule }
        }

        /// Advance one frame and drain whatever the system queued.
        fn frame(&mut self) -> Vec<(String, TerrainData)> {
            self.schedule.run(&mut self.world);
            self.world.resource_mut::<TerrainChangeEvents>().take()
        }
    }

    #[test]
    fn a_newly_spawned_terrain_queues_one_change() {
        let mut h = Harness::new();
        let config = TerrainData { seed: 4242, resolution: 8, size: 7.0, ..Default::default() };
        h.world.spawn((EntityId::new("terrain-1"), config.clone()));

        let emitted = h.frame();

        assert_eq!(emitted.len(), 1, "an inserted TerrainData counts as changed");
        assert_eq!(emitted[0].0, "terrain-1");
        assert_eq!(emitted[0].1, config);
    }

    #[test]
    fn an_unchanged_terrain_queues_nothing_on_a_later_frame() {
        let mut h = Harness::new();
        h.world.spawn((EntityId::new("terrain-1"), TerrainData::default()));
        assert_eq!(h.frame().len(), 1);

        assert!(
            h.frame().is_empty(),
            "a quiet frame must not re-emit — the JS shell would rebuild the \
             inspector on every tick",
        );
    }

    #[test]
    fn mutating_the_config_queues_the_new_value() {
        let mut h = Harness::new();
        let entity = h
            .world
            .spawn((EntityId::new("terrain-1"), TerrainData::default()))
            .id();
        let _ = h.frame();

        h.world.entity_mut(entity).get_mut::<TerrainData>().unwrap().seed = 999;

        let emitted = h.frame();
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].1.seed, 999, "the emitted payload must be the NEW config");
    }

    #[test]
    fn taking_drains_so_a_change_is_never_emitted_twice() {
        let mut h = Harness::new();
        h.world.spawn((EntityId::new("terrain-1"), TerrainData::default()));

        assert_eq!(h.frame().len(), 1);
        assert!(
            h.world.resource::<TerrainChangeEvents>().is_empty(),
            "take() must leave the queue empty",
        );
    }

    #[test]
    fn every_changed_terrain_is_reported_not_just_the_first() {
        let mut h = Harness::new();
        h.world.spawn((EntityId::new("terrain-1"), TerrainData::default()));
        h.world
            .spawn((EntityId::new("terrain-2"), TerrainData { seed: 7, ..Default::default() }));

        let mut emitted = h.frame();
        emitted.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(emitted.len(), 2);
        assert_eq!(emitted[0].0, "terrain-1");
        assert_eq!(emitted[1].0, "terrain-2");
    }
}

#[cfg(test)]
mod terrain_changed_wire_contract_tests {
    use super::*;

    /// The single source of truth for the `TERRAIN_CHANGED` wire shape, shared
    /// with the web handler's test (`web/src/hooks/events/__tests__/
    /// materialEvents.test.ts`), which parses this same file.
    ///
    /// `include_str!` rather than a runtime read on purpose: if the fixture is
    /// moved or deleted, that is a compile error here instead of a test that
    /// quietly stops covering the boundary. It is inside `#[cfg(test)]`, so the
    /// wasm build never reaches across into `web/`.
    const FIXTURE: &str =
        include_str!("../../../web/src/hooks/events/__tests__/fixtures/terrainChanged.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(FIXTURE).expect("terrainChanged.json is not valid JSON")
    }

    /// Both halves of the bridge are pinned to one file, so the engine cannot
    /// change what it emits without failing here, and the web handler cannot
    /// change what it reads without failing its own test against the same bytes.
    #[test]
    fn payload_serializes_to_the_shared_fixture() {
        let data = TerrainData::default();
        let payload = TerrainChangedPayload { entity_id: "terrain-789", terrain_data: &data };

        assert_eq!(
            serde_json::to_value(&payload).expect("payload must serialize"),
            fixture(),
            "TERRAIN_CHANGED payload drifted from the fixture the web handler is tested against"
        );
    }

    /// Guards the specific regression: `#[serde(flatten)]` on `terrain_data`
    /// hoists all eight `TerrainData` fields to the top level, which the web
    /// handler reads as `payload.terrainData === undefined`. Full-value equality
    /// above already catches it; this names it so the failure is diagnosable.
    #[test]
    fn terrain_data_is_nested_not_flattened() {
        let data = TerrainData::default();
        let payload = TerrainChangedPayload { entity_id: "terrain-789", terrain_data: &data };
        let value = serde_json::to_value(&payload).expect("payload must serialize");

        let mut keys: Vec<&str> = value
            .as_object()
            .expect("payload must be a JSON object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();

        assert_eq!(
            keys,
            ["entityId", "terrainData"],
            "TERRAIN_CHANGED must nest the config under `terrainData`; flattening it \
             puts the noise fields at the top level and the web handler reads undefined"
        );
        assert!(
            value["terrainData"].get("noiseType").is_some(),
            "nested config must carry the camelCase TerrainData fields"
        );
    }

    /// The fixture is only meaningful if it round-trips back into the real type:
    /// a hand-edited fixture with a misspelled or missing field would otherwise
    /// still satisfy a web test written against the same typo.
    #[test]
    fn fixture_deserializes_back_into_terrain_data() {
        let parsed: TerrainData = serde_json::from_value(fixture()["terrainData"].clone())
            .expect("fixture terrainData must deserialize into TerrainData");
        assert_eq!(parsed, TerrainData::default());
    }
}
