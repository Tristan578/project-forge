//! Procedural mesh generation: extrude, lathe, and combine operations.
//!
//! This module provides tools for generating meshes programmatically:
//! - Extrude: Create 3D geometry by extruding a 2D cross-section along a linear path
//! - Lathe: Create rotational geometry by revolving a 2D profile around Y-axis
//! - Combine: Merge multiple meshes into a single mesh

use bevy::prelude::*;
use bevy::render::mesh::{Indices, Mesh};
use bevy::render::render_resource::PrimitiveTopology;
use serde::{Deserialize, Serialize};

/// Serializable mesh data for procedural results (stored in snapshots for undo/redo).
#[derive(Debug, Clone, Serialize, Deserialize, Component)]
#[serde(rename_all = "camelCase")]
pub struct ProceduralMeshData {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub operation: ProceduralOp,
}

/// Type of procedural operation that created this mesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProceduralOp {
    Extrude { shape: ExtrudeShape, length: f32, segments: u32 },
    Lathe { profile: Vec<[f32; 2]>, segments: u32 },
    Combine,
}

/// Cross-section shape for extrusion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtrudeShape {
    Circle { radius: f32, segments: u32 },
    Square { size: f32 },
    Hexagon { radius: f32 },
    Star { outer_radius: f32, inner_radius: f32, points: u32 },
}

/// Generate an extruded mesh from a 2D cross-section.
/// The cross-section is placed at Y=0 and extruded along the Y-axis for `length`.
pub fn generate_extrude_mesh(shape: &ExtrudeShape, length: f32, _segments: u32) -> Mesh {
    // Generate the cross-section vertices in 2D (XZ plane at Y=0)
    let cross_section = generate_cross_section(shape);
    let cs_len = cross_section.len();

    // Total vertex count: cross_section points at Y=0 and Y=length
    let vert_count = cs_len * 2;
    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(vert_count);
    let mut normals: Vec<[f32; 3]> = Vec::with_capacity(vert_count);
    let mut uvs: Vec<[f32; 2]> = Vec::with_capacity(vert_count);

    // Compute perimeter for UV mapping
    let perimeter = compute_perimeter(&cross_section);

    // Bottom cap vertices (Y=0)
    let mut u_acc = 0.0;
    for (i, &[x, z]) in cross_section.iter().enumerate() {
        positions.push([x, 0.0, z]);
        normals.push([x, 0.0, z]); // Placeholder, will compute proper normals below

        // U coordinate wraps around the perimeter
        if i > 0 {
            let dx = cross_section[i][0] - cross_section[i - 1][0];
            let dz = cross_section[i][1] - cross_section[i - 1][1];
            u_acc += (dx * dx + dz * dz).sqrt();
        }
        let u = if perimeter > 0.0 { u_acc / perimeter } else { 0.0 };
        uvs.push([u, 0.0]);
    }

    // Top cap vertices (Y=length)
    u_acc = 0.0;
    for (i, &[x, z]) in cross_section.iter().enumerate() {
        positions.push([x, length, z]);
        normals.push([x, 0.0, z]); // Placeholder

        if i > 0 {
            let dx = cross_section[i][0] - cross_section[i - 1][0];
            let dz = cross_section[i][1] - cross_section[i - 1][1];
            u_acc += (dx * dx + dz * dz).sqrt();
        }
        let u = if perimeter > 0.0 { u_acc / perimeter } else { 0.0 };
        uvs.push([u, 1.0]);
    }

    // Compute proper normals for side faces (perpendicular to extrusion direction)
    for i in 0..cs_len {
        let next_i = (i + 1) % cs_len;
        let dx = cross_section[next_i][0] - cross_section[i][0];
        let dz = cross_section[next_i][1] - cross_section[i][1];

        // Normal is perpendicular to the edge in XZ plane
        // Rotate edge vector 90 degrees CCW in XZ plane
        let nx = -dz;
        let nz = dx;
        let len = (nx * nx + nz * nz).sqrt();
        let (nx, nz) = if len > 0.0 { (nx / len, nz / len) } else { (0.0, 1.0) };

        // Apply to both bottom and top vertices
        normals[i] = [nx, 0.0, nz];
        normals[cs_len + i] = [nx, 0.0, nz];
    }

    // Generate side face indices (quads split into two triangles)
    let mut indices: Vec<u32> = Vec::with_capacity(cs_len * 6);
    for i in 0..cs_len {
        let next_i = (i + 1) % cs_len;

        let bottom_curr = i as u32;
        let bottom_next = next_i as u32;
        let top_curr = (cs_len + i) as u32;
        let top_next = (cs_len + next_i) as u32;

        // First triangle: bottom_curr, top_curr, bottom_next
        indices.push(bottom_curr);
        indices.push(top_curr);
        indices.push(bottom_next);

        // Second triangle: bottom_next, top_curr, top_next
        indices.push(bottom_next);
        indices.push(top_curr);
        indices.push(top_next);
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::render::render_asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Generate a 2D cross-section shape as a Vec of [x, z] coordinates.
fn generate_cross_section(shape: &ExtrudeShape) -> Vec<[f32; 2]> {
    match shape {
        ExtrudeShape::Circle { radius, segments } => {
            let mut points = Vec::with_capacity(*segments as usize);
            for i in 0..*segments {
                let angle = (i as f32) * std::f32::consts::TAU / (*segments as f32);
                let x = radius * angle.cos();
                let z = radius * angle.sin();
                points.push([x, z]);
            }
            points
        }
        ExtrudeShape::Square { size } => {
            let half = size / 2.0;
            vec![
                [-half, -half],
                [half, -half],
                [half, half],
                [-half, half],
            ]
        }
        ExtrudeShape::Hexagon { radius } => {
            let mut points = Vec::with_capacity(6);
            for i in 0..6 {
                let angle = (i as f32) * std::f32::consts::TAU / 6.0;
                let x = radius * angle.cos();
                let z = radius * angle.sin();
                points.push([x, z]);
            }
            points
        }
        ExtrudeShape::Star { outer_radius, inner_radius, points: point_count } => {
            let mut verts = Vec::with_capacity((point_count * 2) as usize);
            for i in 0..(point_count * 2) {
                let angle = (i as f32) * std::f32::consts::PI / (*point_count as f32);
                let r = if i % 2 == 0 { *outer_radius } else { *inner_radius };
                let x = r * angle.cos();
                let z = r * angle.sin();
                verts.push([x, z]);
            }
            verts
        }
    }
}

/// Compute the perimeter of a 2D cross-section.
fn compute_perimeter(cross_section: &[[f32; 2]]) -> f32 {
    let mut total = 0.0;
    for i in 0..cross_section.len() {
        let next_i = (i + 1) % cross_section.len();
        let dx = cross_section[next_i][0] - cross_section[i][0];
        let dz = cross_section[next_i][1] - cross_section[i][1];
        total += (dx * dx + dz * dz).sqrt();
    }
    total
}

/// Generate a lathed mesh by revolving a 2D profile around the Y-axis.
/// `profile` is a Vec of [radius, height] pairs defining the silhouette.
/// `segments` controls the number of subdivisions around the Y-axis (8-64).
pub fn generate_lathe_mesh(profile: &[[f32; 2]], segments: u32) -> Mesh {
    let profile_len = profile.len();
    if profile_len < 2 {
        // Degenerate case: return an empty mesh
        return Mesh::new(
            PrimitiveTopology::TriangleList,
            bevy::render::render_asset::RenderAssetUsages::default(),
        );
    }

    let vert_count = profile_len * segments as usize;
    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(vert_count);
    let mut normals: Vec<[f32; 3]> = Vec::with_capacity(vert_count);
    let mut uvs: Vec<[f32; 2]> = Vec::with_capacity(vert_count);

    // Generate vertices by rotating the profile around Y-axis
    for seg in 0..segments {
        let angle = (seg as f32) * std::f32::consts::TAU / (segments as f32);
        let cos_a = angle.cos();
        let sin_a = angle.sin();
        let u = (seg as f32) / (segments as f32);

        for (i, &[r, y]) in profile.iter().enumerate() {
            let x = r * cos_a;
            let z = r * sin_a;
            positions.push([x, y, z]);

            // Normal computation: approximate from profile tangent
            let (dx_profile, dy_profile) = if i == 0 {
                // First point: use forward difference
                let r1 = profile[1][0];
                let y1 = profile[1][1];
                (r1 - r, y1 - y)
            } else if i == profile_len - 1 {
                // Last point: use backward difference
                let r0 = profile[i - 1][0];
                let y0 = profile[i - 1][1];
                (r - r0, y - y0)
            } else {
                // Middle points: use central difference
                let r0 = profile[i - 1][0];
                let y0 = profile[i - 1][1];
                let r1 = profile[i + 1][0];
                let y1 = profile[i + 1][1];
                ((r1 - r0) * 0.5, (y1 - y0) * 0.5)
            };

            // Tangent in profile space is (dx_profile, dy_profile)
            // Normal is perpendicular: (-dy_profile, dx_profile) rotated to 3D
            let nx = -dy_profile * cos_a;
            let ny = dx_profile;
            let nz = -dy_profile * sin_a;
            let len = (nx * nx + ny * ny + nz * nz).sqrt();
            let (nx, ny, nz) = if len > 0.0 {
                (nx / len, ny / len, nz / len)
            } else {
                (cos_a, 0.0, sin_a) // Fallback to radial
            };
            normals.push([nx, ny, nz]);

            let v = (i as f32) / ((profile_len - 1) as f32);
            uvs.push([u, v]);
        }
    }

    // Generate triangle indices
    let quad_count = (segments as usize) * (profile_len - 1);
    let mut indices: Vec<u32> = Vec::with_capacity(quad_count * 6);

    for seg in 0..segments as usize {
        let next_seg = (seg + 1) % (segments as usize);
        for i in 0..(profile_len - 1) {
            let tl = (seg * profile_len + i) as u32;
            let tr = (next_seg * profile_len + i) as u32;
            let bl = (seg * profile_len + i + 1) as u32;
            let br = (next_seg * profile_len + i + 1) as u32;

            // First triangle
            indices.push(tl);
            indices.push(bl);
            indices.push(tr);

            // Second triangle
            indices.push(tr);
            indices.push(bl);
            indices.push(br);
        }
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::render::render_asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Combine multiple meshes into a single mesh.
/// Each mesh is provided as (positions, normals, indices, transform).
/// The positions and normals are transformed to world space before merging.
pub fn combine_meshes_data(
    meshes: Vec<(Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>, Transform)>,
) -> (Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>) {
    let mut combined_positions: Vec<[f32; 3]> = Vec::new();
    let mut combined_normals: Vec<[f32; 3]> = Vec::new();
    let mut combined_indices: Vec<u32> = Vec::new();

    for (positions, normals, indices, transform) in meshes {
        let base_idx = combined_positions.len() as u32;
        let world_matrix = transform.compute_matrix();
        let normal_matrix = world_matrix.inverse().transpose();

        // Transform positions to world space
        for pos in positions {
            let wp = world_matrix.transform_point3(Vec3::from(pos));
            combined_positions.push([wp.x, wp.y, wp.z]);
        }

        // Transform normals to world space
        for norm in normals {
            let wn = normal_matrix.transform_vector3(Vec3::from(norm)).normalize_or_zero();
            combined_normals.push([wn.x, wn.y, wn.z]);
        }

        // Offset indices by the base index
        for idx in indices {
            combined_indices.push(base_idx + idx);
        }
    }

    (combined_positions, combined_normals, combined_indices)
}

/// Rebuild a Bevy Mesh from stored ProceduralMeshData (for undo/redo/save-load).
pub fn rebuild_procedural_mesh(data: &ProceduralMeshData) -> Mesh {
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::render::render_asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, data.positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, data.normals.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, data.uvs.clone());
    mesh.insert_indices(Indices::U32(data.indices.clone()));
    mesh
}
