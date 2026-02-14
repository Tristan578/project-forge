//! CSG (Constructive Solid Geometry) boolean operations.
//!
//! Provides union, difference, and intersection on mesh entities.
//! Uses the `csgrs` library for BSP-based boolean operations.

use bevy::prelude::*;
use bevy::render::mesh::{Indices, VertexAttributeValues};
use bevy::render::render_resource::PrimitiveTopology;
use serde::{Deserialize, Serialize};

use csgrs::mesh::Mesh as CsgMesh;
use csgrs::mesh::polygon::Polygon as CsgPolygon;
use csgrs::mesh::vertex::Vertex as CsgVertex;
use csgrs::traits::CSG;
// Use nalgebra types re-exported through csgrs → parry3d to avoid version conflicts
use csgrs::float_types::parry3d::na::{Point3, Vector3};

/// Serializable mesh data for CSG results (stored in snapshots for undo/redo).
#[derive(Debug, Clone, Serialize, Deserialize, Component)]
pub struct CsgMeshData {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// CSG operation type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsgOperation {
    Union,
    Subtract,
    Intersect,
}

/// Extract vertex data from a Bevy Mesh and convert to csgrs Mesh.
///
/// The mesh is transformed to world space using the provided Transform
/// so that CSG operations work correctly across different entity positions.
pub fn bevy_mesh_to_csg(
    mesh: &Mesh,
    transform: &Transform,
) -> Result<CsgMesh<()>, String> {
    // 1. Extract positions
    let positions = mesh.attribute(Mesh::ATTRIBUTE_POSITION)
        .ok_or("Mesh has no position attribute")?;
    let positions: Vec<[f32; 3]> = match positions {
        VertexAttributeValues::Float32x3(v) => v.clone(),
        _ => return Err("Unexpected position attribute format".into()),
    };

    // 2. Extract normals (generate if missing)
    let normals = mesh.attribute(Mesh::ATTRIBUTE_NORMAL);
    let normals: Vec<[f32; 3]> = match normals {
        Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
        _ => {
            // Generate flat normals from faces if not present
            vec![[0.0, 1.0, 0.0]; positions.len()]
        }
    };

    // 3. Extract indices
    let indices = mesh.indices()
        .ok_or("Mesh has no indices")?;
    let indices: Vec<u32> = match indices {
        Indices::U32(v) => v.clone(),
        Indices::U16(v) => v.iter().map(|i| *i as u32).collect(),
    };

    // 4. Transform positions and normals to world space
    let world_matrix = transform.compute_matrix();
    let normal_matrix = world_matrix.inverse().transpose();

    let world_positions: Vec<[f32; 3]> = positions.iter().map(|p| {
        let wp = world_matrix.transform_point3(Vec3::from(*p));
        [wp.x, wp.y, wp.z]
    }).collect();

    let world_normals: Vec<[f32; 3]> = normals.iter().map(|n| {
        let wn = normal_matrix.transform_vector3(Vec3::from(*n)).normalize_or_zero();
        [wn.x, wn.y, wn.z]
    }).collect();

    // 5. Build csgrs polygons from triangles
    if indices.len() % 3 != 0 {
        return Err("Index count is not a multiple of 3".into());
    }

    let mut polygons = Vec::with_capacity(indices.len() / 3);
    for tri in indices.chunks(3) {
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        if i0 >= world_positions.len() || i1 >= world_positions.len() || i2 >= world_positions.len() {
            return Err("Index out of bounds".into());
        }

        let v0 = CsgVertex {
            pos: Point3::new(
                world_positions[i0][0],
                world_positions[i0][1],
                world_positions[i0][2],
            ),
            normal: Vector3::new(
                world_normals[i0][0],
                world_normals[i0][1],
                world_normals[i0][2],
            ),
        };
        let v1 = CsgVertex {
            pos: Point3::new(
                world_positions[i1][0],
                world_positions[i1][1],
                world_positions[i1][2],
            ),
            normal: Vector3::new(
                world_normals[i1][0],
                world_normals[i1][1],
                world_normals[i1][2],
            ),
        };
        let v2 = CsgVertex {
            pos: Point3::new(
                world_positions[i2][0],
                world_positions[i2][1],
                world_positions[i2][2],
            ),
            normal: Vector3::new(
                world_normals[i2][0],
                world_normals[i2][1],
                world_normals[i2][2],
            ),
        };

        polygons.push(CsgPolygon::new(vec![v0, v1, v2], None));
    }

    Ok(CsgMesh::from_polygons(&polygons, None))
}

/// Convert a csgrs Mesh result back to a Bevy Mesh.
///
/// Returns both the Bevy Mesh and the serializable CsgMeshData
/// (for snapshot storage in undo/redo).
pub fn csg_to_bevy_mesh(csg_mesh: &CsgMesh<()>) -> Result<(Mesh, CsgMeshData), String> {
    // Triangulate the result (csgrs can produce n-gons from BSP splitting)
    let triangulated = csg_mesh.triangulate();

    if triangulated.polygons.is_empty() {
        return Err("CSG operation produced empty mesh".into());
    }

    // Build vertex arrays and index buffer
    // csgrs triangulate() produces polygons with exactly 3 vertices each
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    for polygon in &triangulated.polygons {
        if polygon.vertices.len() != 3 {
            // Skip non-triangle polygons (should not happen after triangulate())
            continue;
        }
        let base_idx = positions.len() as u32;
        for vertex in &polygon.vertices {
            positions.push([
                vertex.pos.x,
                vertex.pos.y,
                vertex.pos.z,
            ]);
            normals.push([
                vertex.normal.x,
                vertex.normal.y,
                vertex.normal.z,
            ]);
        }
        indices.push(base_idx);
        indices.push(base_idx + 1);
        indices.push(base_idx + 2);
    }

    if positions.is_empty() {
        return Err("CSG operation produced empty mesh after triangulation".into());
    }

    // Build Bevy Mesh
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::render::render_asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals.clone());
    mesh.insert_indices(Indices::U32(indices.clone()));

    let mesh_data = CsgMeshData {
        positions,
        normals,
        indices,
    };

    Ok((mesh, mesh_data))
}

/// Rebuild a Bevy Mesh from stored CsgMeshData (for undo/redo snapshot restore).
pub fn rebuild_mesh_from_data(data: &CsgMeshData) -> Mesh {
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::render::render_asset::RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, data.positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, data.normals.clone());
    mesh.insert_indices(Indices::U32(data.indices.clone()));
    mesh
}

/// Perform a CSG boolean operation on two meshes.
pub fn perform_csg(
    mesh_a: &CsgMesh<()>,
    mesh_b: &CsgMesh<()>,
    operation: CsgOperation,
) -> CsgMesh<()> {
    match operation {
        CsgOperation::Union => mesh_a.union(mesh_b),
        CsgOperation::Subtract => mesh_a.difference(mesh_b),
        CsgOperation::Intersect => mesh_a.intersection(mesh_b),
    }
}
