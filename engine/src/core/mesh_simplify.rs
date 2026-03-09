//! QEM (Quadric Error Metric) mesh simplification.
//!
//! Implements the Garland-Heckbert algorithm for LOD mesh generation.
//! Pure Rust, zero external dependencies beyond Bevy's mesh types.

use bevy::mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
use std::collections::BinaryHeap;
use std::cmp::Reverse;

/// Symmetric 4x4 quadric matrix stored as 10 unique floats.
/// Layout: [a, b, c, d, e, f, g, h, i, j]
/// Represents:
/// | a b c d |
/// | b e f g |
/// | c f h i |
/// | d g i j |
#[derive(Clone, Copy, Debug)]
struct Quadric([f32; 10]);

impl Quadric {
    fn zero() -> Self {
        Quadric([0.0; 10])
    }

    /// Create a quadric from a triangle plane equation (ax + by + cz + d = 0).
    fn from_plane(a: f32, b: f32, c: f32, d: f32) -> Self {
        Quadric([
            a * a, a * b, a * c, a * d,
            b * b, b * c, b * d,
            c * c, c * d,
            d * d,
        ])
    }

    fn add(&self, other: &Quadric) -> Quadric {
        let mut result = [0.0f32; 10];
        for i in 0..10 {
            result[i] = self.0[i] + other.0[i];
        }
        Quadric(result)
    }

    /// Evaluate the quadric error for a point [x, y, z].
    fn evaluate(&self, x: f32, y: f32, z: f32) -> f32 {
        let q = &self.0;
        // v^T * Q * v where v = [x, y, z, 1]
        x * (q[0] * x + q[1] * y + q[2] * z + q[3])
            + y * (q[1] * x + q[4] * y + q[5] * z + q[6])
            + z * (q[2] * x + q[5] * y + q[7] * z + q[8])
            + (q[3] * x + q[6] * y + q[8] * z + q[9])
    }

    /// Try to find the optimal collapse point by solving the linear system.
    /// Falls back to the midpoint of v1 and v2 if the matrix is singular.
    fn optimal_point(&self, v1: [f32; 3], v2: [f32; 3]) -> [f32; 3] {
        let q = &self.0;
        // Try to solve the 3x3 system (top-left of Q with last column as RHS)
        // | a b c | |x|   |-d|
        // | b e f | |y| = |-g|
        // | c f h | |z|   |-i|
        let det = q[0] * (q[4] * q[7] - q[5] * q[5])
            - q[1] * (q[1] * q[7] - q[5] * q[2])
            + q[2] * (q[1] * q[5] - q[4] * q[2]);

        if det.abs() > 1e-10 {
            let inv_det = 1.0 / det;
            let x = inv_det
                * (-q[3] * (q[4] * q[7] - q[5] * q[5])
                    + q[6] * (q[1] * q[7] - q[2] * q[5])
                    - q[8] * (q[1] * q[5] - q[2] * q[4]));
            let y = inv_det
                * (q[3] * (q[1] * q[7] - q[2] * q[5])
                    - q[6] * (q[0] * q[7] - q[2] * q[2])
                    + q[8] * (q[0] * q[5] - q[2] * q[1]));
            let z = inv_det
                * (-q[3] * (q[1] * q[5] - q[4] * q[2])
                    + q[6] * (q[0] * q[5] - q[1] * q[2])
                    - q[8] * (q[0] * q[4] - q[1] * q[1]));
            [x, y, z]
        } else {
            // Fallback: use midpoint
            [
                (v1[0] + v2[0]) * 0.5,
                (v1[1] + v2[1]) * 0.5,
                (v1[2] + v2[2]) * 0.5,
            ]
        }
    }
}

/// Edge collapse candidate, ordered by cost (lowest first).
#[derive(Clone, Debug)]
struct EdgeCollapse {
    cost: f32,
    v1: usize,
    v2: usize,
    optimal: [f32; 3],
}

impl PartialEq for EdgeCollapse {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost
    }
}

impl Eq for EdgeCollapse {}

impl PartialOrd for EdgeCollapse {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for EdgeCollapse {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Treat NaN costs as greater than any finite value so they sink
        // to the bottom of the min-heap and are never collapsed first.
        match (self.cost.is_nan(), other.cost.is_nan()) {
            (true, true) => std::cmp::Ordering::Equal,
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            (false, false) => self.cost.partial_cmp(&other.cost).unwrap_or(std::cmp::Ordering::Equal),
        }
    }
}

/// Simplify a Bevy mesh using Quadric Error Metric edge collapse.
///
/// `target_ratio` is the fraction of triangles to keep (e.g., 0.5 = 50%).
/// Returns a new simplified mesh, or a clone if simplification is not possible.
pub fn simplify_mesh(mesh: &Mesh, target_ratio: f32) -> Mesh {
    // Only process triangle lists
    if mesh.primitive_topology() != PrimitiveTopology::TriangleList {
        return mesh.clone();
    }

    // Extract positions
    let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(pos)) => pos.clone(),
        _ => return mesh.clone(),
    };

    if positions.len() < 3 {
        return mesh.clone();
    }

    // Extract indices (generate trivial if none)
    let indices: Vec<u32> = match mesh.indices() {
        Some(Indices::U32(idx)) => idx.clone(),
        Some(Indices::U16(idx)) => idx.iter().map(|&i| i as u32).collect(),
        None => (0..positions.len() as u32).collect(),
    };

    let tri_count = indices.len() / 3;
    if tri_count < 4 {
        return mesh.clone();
    }

    let target_tris = ((tri_count as f32 * target_ratio).ceil() as usize).max(4);
    if target_tris >= tri_count {
        return mesh.clone();
    }

    // Run QEM simplification on the index buffer
    let (new_positions, new_indices) = qem_simplify(&positions, &indices, target_tris);

    // Build the output mesh
    let mut result = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::default(),
    );
    result.insert_attribute(Mesh::ATTRIBUTE_POSITION, new_positions.clone());

    // Recompute flat normals for the simplified mesh
    let normals = compute_smooth_normals(&new_positions, &new_indices);
    result.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);

    // Generate trivial UVs (planar projection) for simplified mesh
    let uvs: Vec<[f32; 2]> = new_positions.iter().map(|p| [p[0] * 0.5 + 0.5, p[2] * 0.5 + 0.5]).collect();
    result.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);

    result.insert_indices(Indices::U32(new_indices));
    result
}

/// Core QEM edge collapse loop.
fn qem_simplify(
    positions: &[[f32; 3]],
    indices: &[u32],
    target_tris: usize,
) -> (Vec<[f32; 3]>, Vec<u32>) {
    let n = positions.len();

    // Mutable copy of positions
    let mut pos = positions.to_vec();

    // Vertex remap: track which vertex each original vertex maps to after collapses
    let mut remap: Vec<usize> = (0..n).collect();

    // Compute per-vertex quadrics from adjacent triangles
    let mut quadrics = vec![Quadric::zero(); n];
    let tri_count_initial = indices.len() / 3;

    for t in 0..tri_count_initial {
        let i0 = indices[t * 3] as usize;
        let i1 = indices[t * 3 + 1] as usize;
        let i2 = indices[t * 3 + 2] as usize;

        let p0 = pos[i0];
        let p1 = pos[i1];
        let p2 = pos[i2];

        // Compute plane equation
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        if len < 1e-12 {
            continue;
        }
        let inv_len = 1.0 / len;
        let a = nx * inv_len;
        let b = ny * inv_len;
        let c = nz * inv_len;
        let d = -(a * p0[0] + b * p0[1] + c * p0[2]);

        let q = Quadric::from_plane(a, b, c, d);
        quadrics[i0] = quadrics[i0].add(&q);
        quadrics[i1] = quadrics[i1].add(&q);
        quadrics[i2] = quadrics[i2].add(&q);
    }

    // Build edge set and priority queue
    let mut heap: BinaryHeap<Reverse<EdgeCollapse>> = BinaryHeap::new();
    let mut seen_edges = std::collections::HashSet::new();

    for t in 0..tri_count_initial {
        let tri_verts = [
            indices[t * 3] as usize,
            indices[t * 3 + 1] as usize,
            indices[t * 3 + 2] as usize,
        ];
        for edge_idx in 0..3 {
            let mut v1 = tri_verts[edge_idx];
            let mut v2 = tri_verts[(edge_idx + 1) % 3];
            if v1 > v2 {
                std::mem::swap(&mut v1, &mut v2);
            }
            let edge_key = (v1, v2);
            if seen_edges.insert(edge_key) {
                let combined = quadrics[v1].add(&quadrics[v2]);
                let opt = combined.optimal_point(pos[v1], pos[v2]);
                let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
                heap.push(Reverse(EdgeCollapse {
                    cost,
                    v1,
                    v2,
                    optimal: opt,
                }));
            }
        }
    }

    // Make a mutable copy of indices as triangles
    let mut triangles: Vec<[usize; 3]> = (0..tri_count_initial)
        .map(|t| {
            [
                indices[t * 3] as usize,
                indices[t * 3 + 1] as usize,
                indices[t * 3 + 2] as usize,
            ]
        })
        .collect();

    let mut current_tri_count = tri_count_initial;
    let mut removed = vec![false; tri_count_initial];

    // Collapse edges until target
    while current_tri_count > target_tris {
        let collapse = match heap.pop() {
            Some(Reverse(c)) => c,
            None => break,
        };

        // Resolve actual vertices (follow remap chain)
        let actual_v1 = resolve(&remap, collapse.v1);
        let actual_v2 = resolve(&remap, collapse.v2);

        // Skip if already collapsed to the same vertex
        if actual_v1 == actual_v2 {
            continue;
        }

        // Collapse v2 into v1
        pos[actual_v1] = collapse.optimal;
        remap[actual_v2] = actual_v1;
        quadrics[actual_v1] = quadrics[actual_v1].add(&quadrics[actual_v2]);

        // Update triangles: remap v2 -> v1 and remove degenerate
        let mut tris_removed = 0;
        for (ti, tri) in triangles.iter_mut().enumerate() {
            if removed[ti] {
                continue;
            }
            for v in tri.iter_mut() {
                if resolve(&remap, *v) == actual_v2 {
                    *v = actual_v1;
                }
                *v = resolve(&remap, *v);
            }

            // Check degenerate (two or more same vertices)
            if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                removed[ti] = true;
                tris_removed += 1;
            }
        }

        current_tri_count = current_tri_count.saturating_sub(tris_removed);

        // Re-add edges adjacent to v1 with new costs
        let v1 = actual_v1;
        let mut new_neighbors = std::collections::HashSet::new();
        for (ti, tri) in triangles.iter().enumerate() {
            if removed[ti] {
                continue;
            }
            for &tv in tri.iter() {
                let rv = resolve(&remap, tv);
                if rv == v1 {
                    for &tv2 in tri.iter() {
                        let rv2 = resolve(&remap, tv2);
                        if rv2 != v1 {
                            let key = if v1 < rv2 { (v1, rv2) } else { (rv2, v1) };
                            new_neighbors.insert(key);
                        }
                    }
                }
            }
        }

        for (nv1, nv2) in new_neighbors {
            let combined = quadrics[nv1].add(&quadrics[nv2]);
            let opt = combined.optimal_point(pos[nv1], pos[nv2]);
            let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
            heap.push(Reverse(EdgeCollapse {
                cost,
                v1: nv1,
                v2: nv2,
                optimal: opt,
            }));
        }
    }

    // Collect surviving vertices and rebuild index buffer
    let mut vertex_used = vec![false; n];
    let mut final_tris: Vec<[usize; 3]> = Vec::new();

    for (ti, tri) in triangles.iter().enumerate() {
        if removed[ti] {
            continue;
        }
        let rv0 = resolve(&remap, tri[0]);
        let rv1 = resolve(&remap, tri[1]);
        let rv2 = resolve(&remap, tri[2]);
        if rv0 == rv1 || rv1 == rv2 || rv0 == rv2 {
            continue;
        }
        vertex_used[rv0] = true;
        vertex_used[rv1] = true;
        vertex_used[rv2] = true;
        final_tris.push([rv0, rv1, rv2]);
    }

    // Compact vertices
    let mut new_index = vec![0usize; n];
    let mut new_positions: Vec<[f32; 3]> = Vec::new();
    for (i, &used) in vertex_used.iter().enumerate() {
        if used {
            new_index[i] = new_positions.len();
            new_positions.push(pos[i]);
        }
    }

    let new_indices: Vec<u32> = final_tris
        .iter()
        .flat_map(|tri| {
            [
                new_index[tri[0]] as u32,
                new_index[tri[1]] as u32,
                new_index[tri[2]] as u32,
            ]
        })
        .collect();

    (new_positions, new_indices)
}

/// Follow the remap chain to find the canonical vertex.
fn resolve(remap: &[usize], mut v: usize) -> usize {
    while remap[v] != v {
        v = remap[v];
    }
    v
}

/// Compute smooth per-vertex normals by averaging adjacent face normals.
fn compute_smooth_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0f32; 3]; positions.len()];

    let tri_count = indices.len() / 3;
    for t in 0..tri_count {
        let i0 = indices[t * 3] as usize;
        let i1 = indices[t * 3 + 1] as usize;
        let i2 = indices[t * 3 + 2] as usize;

        let p0 = positions[i0];
        let p1 = positions[i1];
        let p2 = positions[i2];

        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];

        for &idx in &[i0, i1, i2] {
            normals[idx][0] += nx;
            normals[idx][1] += ny;
            normals[idx][2] += nz;
        }
    }

    // Normalize
    for normal in &mut normals {
        let len = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if len > 1e-12 {
            let inv = 1.0 / len;
            normal[0] *= inv;
            normal[1] *= inv;
            normal[2] *= inv;
        } else {
            *normal = [0.0, 1.0, 0.0]; // Default up
        }
    }

    normals
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
    use bevy::asset::RenderAssetUsages;

    /// Build a simple quad (2 triangles, 4 vertices) for testing.
    fn make_quad() -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
            ],
        );
        mesh.insert_indices(Indices::U32(vec![0, 1, 2, 0, 2, 3]));
        mesh
    }

    /// Build a grid mesh with many triangles suitable for simplification.
    fn make_grid(size: u32) -> Mesh {
        let mut positions = Vec::new();
        let mut indices = Vec::new();

        for z in 0..=size {
            for x in 0..=size {
                positions.push([x as f32, 0.0, z as f32]);
            }
        }

        let cols = size + 1;
        for z in 0..size {
            for x in 0..size {
                let tl = z * cols + x;
                let tr = tl + 1;
                let bl = tl + cols;
                let br = bl + 1;
                indices.push(tl);
                indices.push(bl);
                indices.push(tr);
                indices.push(tr);
                indices.push(bl);
                indices.push(br);
            }
        }

        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.insert_indices(Indices::U32(indices));
        mesh
    }

    #[test]
    fn simplify_mesh_returns_clone_for_small_mesh() {
        // A quad with only 2 triangles (< 4) should be returned as-is
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        );
        mesh.insert_indices(Indices::U32(vec![0, 1, 2]));

        let result = simplify_mesh(&mesh, 0.5);
        // Should still have 1 triangle (unchanged)
        assert_eq!(result.indices().unwrap().len(), 3);
    }

    #[test]
    fn simplify_mesh_returns_clone_when_ratio_is_one() {
        let mesh = make_quad();
        let result = simplify_mesh(&mesh, 1.0);
        // target_tris >= tri_count so mesh is returned as-is
        assert_eq!(result.indices().unwrap().len(), mesh.indices().unwrap().len());
    }

    #[test]
    fn simplify_mesh_reduces_triangle_count() {
        // 10x10 grid = 200 triangles. Simplify to ~50%.
        let mesh = make_grid(10);
        let original_tri_count = mesh.indices().unwrap().len() / 3;
        assert_eq!(original_tri_count, 200);

        let result = simplify_mesh(&mesh, 0.5);
        let simplified_tri_count = result.indices().unwrap().len() / 3;

        // Should have fewer triangles than original
        assert!(
            simplified_tri_count < original_tri_count,
            "Expected fewer triangles: got {} vs original {}",
            simplified_tri_count,
            original_tri_count
        );
        // Should be roughly around the target (allow some tolerance)
        assert!(
            simplified_tri_count <= (original_tri_count as f32 * 0.7) as usize,
            "Expected at most 70% of original: got {} vs target ~100",
            simplified_tri_count
        );
    }

    #[test]
    fn simplify_mesh_aggressive_ratio() {
        let mesh = make_grid(10);
        let original_tri_count = mesh.indices().unwrap().len() / 3;

        let result = simplify_mesh(&mesh, 0.1);
        let simplified_tri_count = result.indices().unwrap().len() / 3;

        assert!(
            simplified_tri_count < original_tri_count / 2,
            "Expected aggressive simplification: got {} from {}",
            simplified_tri_count,
            original_tri_count
        );
    }

    #[test]
    fn simplify_mesh_preserves_topology() {
        let mesh = make_grid(5);
        let result = simplify_mesh(&mesh, 0.5);

        // Result must be a triangle list with valid indices
        assert_eq!(result.primitive_topology(), PrimitiveTopology::TriangleList);
        assert!(result.indices().unwrap().len() % 3 == 0);

        // All indices must refer to valid positions
        let pos_count = match result.attribute(Mesh::ATTRIBUTE_POSITION).unwrap() {
            VertexAttributeValues::Float32x3(p) => p.len(),
            _ => panic!("Expected Float32x3 positions"),
        };
        match result.indices().unwrap() {
            Indices::U32(idx) => {
                for &i in idx {
                    assert!(
                        (i as usize) < pos_count,
                        "Index {} out of bounds (positions: {})",
                        i,
                        pos_count
                    );
                }
            }
            _ => panic!("Expected U32 indices"),
        }
    }

    #[test]
    fn simplify_mesh_has_normals_and_uvs() {
        let mesh = make_grid(5);
        let result = simplify_mesh(&mesh, 0.5);

        assert!(result.attribute(Mesh::ATTRIBUTE_NORMAL).is_some(), "Missing normals");
        assert!(result.attribute(Mesh::ATTRIBUTE_UV_0).is_some(), "Missing UVs");
    }

    #[test]
    fn simplify_mesh_non_triangle_list_returns_clone() {
        let mut mesh = Mesh::new(PrimitiveTopology::LineList, RenderAssetUsages::default());
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
        );
        let result = simplify_mesh(&mesh, 0.5);
        assert_eq!(result.primitive_topology(), PrimitiveTopology::LineList);
    }

    // --- Quadric tests ---

    #[test]
    fn quadric_zero_evaluates_to_zero() {
        let q = Quadric::zero();
        assert_eq!(q.evaluate(1.0, 2.0, 3.0), 0.0);
    }

    #[test]
    fn quadric_from_plane_evaluates_correctly() {
        // Plane: y = 0 (normal [0,1,0], d = 0)
        let q = Quadric::from_plane(0.0, 1.0, 0.0, 0.0);
        // Point on the plane should have zero error
        assert!((q.evaluate(5.0, 0.0, 3.0)).abs() < 1e-6);
        // Point off the plane should have non-zero error
        assert!((q.evaluate(0.0, 1.0, 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn quadric_add_combines() {
        let q1 = Quadric::from_plane(1.0, 0.0, 0.0, 0.0);
        let q2 = Quadric::from_plane(0.0, 1.0, 0.0, 0.0);
        let combined = q1.add(&q2);

        // Point at origin should have zero error for both planes
        assert!(combined.evaluate(0.0, 0.0, 0.0).abs() < 1e-6);
        // Point at (1, 1, 0) should have error = 1 + 1 = 2
        assert!((combined.evaluate(1.0, 1.0, 0.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn quadric_optimal_point_falls_back_to_midpoint_for_singular() {
        // Zero quadric has a singular matrix
        let q = Quadric::zero();
        let v1 = [0.0, 0.0, 0.0];
        let v2 = [2.0, 4.0, 6.0];
        let opt = q.optimal_point(v1, v2);
        assert!((opt[0] - 1.0).abs() < 1e-6);
        assert!((opt[1] - 2.0).abs() < 1e-6);
        assert!((opt[2] - 3.0).abs() < 1e-6);
    }

    // --- compute_smooth_normals tests ---

    #[test]
    fn compute_smooth_normals_produces_unit_normals() {
        let positions = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
        ];
        let indices = vec![0, 1, 2, 1, 3, 2];
        let normals = compute_smooth_normals(&positions, &indices);

        assert_eq!(normals.len(), positions.len());
        for n in &normals {
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            assert!(
                (len - 1.0).abs() < 1e-5,
                "Normal not unit length: {:?} (len={})",
                n,
                len
            );
        }
    }

    #[test]
    fn compute_smooth_normals_flat_plane_points_up() {
        // XZ plane: normal should be (0, -1, 0) or (0, 1, 0) depending on winding
        let positions = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let indices = vec![0, 1, 2];
        let normals = compute_smooth_normals(&positions, &indices);

        // Cross product of (1,0,0) x (0,0,1) = (0,-1,0) — negative Y
        for n in &normals {
            assert!((n[0]).abs() < 1e-5);
            assert!((n[1].abs() - 1.0).abs() < 1e-5);
            assert!((n[2]).abs() < 1e-5);
        }
    }

    // --- EdgeCollapse NaN ordering ---

    #[test]
    fn edge_collapse_nan_cost_sorts_last() {
        use std::cmp::Reverse;
        let mut heap = BinaryHeap::new();

        heap.push(Reverse(EdgeCollapse {
            cost: f32::NAN,
            v1: 0,
            v2: 1,
            optimal: [0.0; 3],
        }));
        heap.push(Reverse(EdgeCollapse {
            cost: 1.0,
            v1: 2,
            v2: 3,
            optimal: [0.0; 3],
        }));
        heap.push(Reverse(EdgeCollapse {
            cost: 0.5,
            v1: 4,
            v2: 5,
            optimal: [0.0; 3],
        }));

        // Min-heap: smallest cost should come out first
        let first = heap.pop().unwrap().0;
        assert_eq!(first.cost, 0.5);
        let second = heap.pop().unwrap().0;
        assert_eq!(second.cost, 1.0);
        // NaN should be last
        let third = heap.pop().unwrap().0;
        assert!(third.cost.is_nan());
    }
}
