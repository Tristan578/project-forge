//! Procedural terrain generation using noise functions.
//!
//! This module provides heightmap-based terrain generation using the `noise` crate
//! with support for multiple noise algorithms (Perlin, Simplex, Value) and fractal
//! Brownian motion (Fbm). Height-based vertex coloring provides visual feedback.

use bevy::prelude::*;
use bevy::render::mesh::{Indices, Mesh};
use bevy::render::render_resource::PrimitiveTopology;
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
#[derive(Debug, Clone, Component, Serialize, Deserialize)]
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
pub fn build_terrain_mesh(heights: &[f32], resolution: u32, size: f32) -> Mesh {
    let res = resolution as usize;
    let vertex_count = res * res;
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
        bevy::render::render_asset::RenderAssetUsages::default(),
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

/// Apply sculpting: modify heightmap at world-space position within radius.
/// `position` is in local terrain space (x, z).
/// `radius` is in world units.
/// `strength` is positive (raise) or negative (lower).
pub fn sculpt_heightmap(
    heights: &mut [f32],
    resolution: u32,
    size: f32,
    position: [f32; 2],
    radius: f32,
    strength: f32,
) {
    let res = resolution as usize;
    let half_size = size / 2.0;
    let step = size / (res as f32 - 1.0);

    // Convert world position to grid coordinates
    let cx = ((position[0] + half_size) / step).round() as i32;
    let cz = ((position[1] + half_size) / step).round() as i32;
    let grid_radius = (radius / step).ceil() as i32;

    for dz in -grid_radius..=grid_radius {
        for dx in -grid_radius..=grid_radius {
            let gx = cx + dx;
            let gz = cz + dz;

            if gx < 0 || gx >= res as i32 || gz < 0 || gz >= res as i32 {
                continue;
            }

            // Calculate distance from center in world units
            let wx = -half_size + gx as f32 * step;
            let wz = -half_size + gz as f32 * step;
            let dist = ((wx - position[0]).powi(2) + (wz - position[1]).powi(2)).sqrt();

            if dist > radius {
                continue;
            }

            // Smooth falloff (cosine)
            let falloff = ((1.0 - dist / radius) * std::f32::consts::FRAC_PI_2).cos();
            let falloff = falloff * falloff; // Squared for smoother edges
            heights[gz as usize * res + gx as usize] += strength * falloff;
        }
    }
}
