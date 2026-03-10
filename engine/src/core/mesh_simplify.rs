//! Attribute-preserving mesh simplification for LOD generation.
//!
//! Provides a `MeshSimplifier` trait and two implementations:
//! - `QemSimplifier` — Quadric Error Metric edge collapse with UV/normal interpolation
//! - `FastSimplifier` — Sloppy position-only simplification for maximum speed
//!
//! The `SimplificationBackend` Bevy resource in `core/lod.rs` selects which
//! implementation is active at runtime. Default is `QemSimplifier`.

use bevy::mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
use std::collections::BinaryHeap;
use std::cmp::Reverse;

// ─── Public Trait ────────────────────────────────────────────────────────────

/// Trait abstracting mesh simplification algorithms.
///
/// Implementations must be `Send + Sync` for Bevy resource safety.
/// Both built-in implementations are stateless structs — trivially satisfied.
pub trait MeshSimplifier: Send + Sync {
    /// Simplify the mesh to approximately `target_ratio` of its original
    /// triangle count. Returns a new mesh. If simplification is not possible
    /// (too few triangles, non-triangle topology, etc.), returns a clone.
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh;

    /// Human-readable name for logging and UI display.
    fn name(&self) -> &'static str;
}

// ─── QEM Simplifier (attribute-preserving) ───────────────────────────────────

/// Attribute-preserving edge-collapse simplifier using Quadric Error Metrics.
///
/// UVs, normals, and vertex colors are linearly interpolated at each collapse
/// point, so simplified meshes retain valid texture mapping.
pub struct QemSimplifier;

impl MeshSimplifier for QemSimplifier {
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh {
        simplify_mesh(mesh, target_ratio)
    }

    fn name(&self) -> &'static str {
        "QEM (Garland-Heckbert)"
    }
}

// ─── Fast Simplifier (position-only, maximum speed) ──────────────────────────

/// Fast sloppy simplifier — operates on positions only, recomputes smooth
/// normals, and assigns planar UVs. Fastest option for very large meshes where
/// texture fidelity is less important (e.g., LOD3 / shadow meshes).
pub struct FastSimplifier;

impl MeshSimplifier for FastSimplifier {
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh {
        fast_simplify_mesh(mesh, target_ratio)
    }

    fn name(&self) -> &'static str {
        "Fast (position-only, flat normals)"
    }
}

// ─── Internal Quadric Type ────────────────────────────────────────────────────

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

    /// Return the t parameter [0..1] that minimises quadric error along
    /// the edge v1->v2. Used to interpolate vertex attributes at the collapse.
    fn optimal_t(&self, v1: [f32; 3], v2: [f32; 3]) -> f32 {
        let opt = self.optimal_point(v1, v2);
        let dx = v2[0] - v1[0];
        let dy = v2[1] - v1[1];
        let dz = v2[2] - v1[2];
        let len_sq = dx * dx + dy * dy + dz * dz;
        if len_sq < 1e-12 {
            return 0.5;
        }
        let t = ((opt[0] - v1[0]) * dx + (opt[1] - v1[1]) * dy + (opt[2] - v1[2]) * dz) / len_sq;
        t.clamp(0.0, 1.0)
    }
}

// ─── Edge Collapse Type ───────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct EdgeCollapse {
    cost: f32,
    v1: usize,
    v2: usize,
    optimal: [f32; 3],
    /// Interpolation parameter for attribute blending (0.0 = v1, 1.0 = v2).
    t: f32,
}

impl PartialEq for EdgeCollapse {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
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
        // NaN costs sink to the bottom of the min-heap
        match (self.cost.is_nan(), other.cost.is_nan()) {
            (true, true) => std::cmp::Ordering::Equal,
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            (false, false) => self.cost.partial_cmp(&other.cost).unwrap_or(std::cmp::Ordering::Equal),
        }
    }
}

// ─── Attribute Storage ────────────────────────────────────────────────────────

/// All optional per-vertex attribute arrays from the source mesh.
struct VertexAttributes {
    uvs: Option<Vec<[f32; 2]>>,
    normals: Option<Vec<[f32; 3]>>,
    colors: Option<Vec<[f32; 4]>>,
}

impl VertexAttributes {
    fn from_mesh(mesh: &Mesh, vertex_count: usize) -> Self {
        let uvs = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(v)) => Some(v.clone()),
            _ => None,
        };
        let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
            Some(VertexAttributeValues::Float32x3(v)) => Some(v.clone()),
            _ => None,
        };
        let colors = match mesh.attribute(Mesh::ATTRIBUTE_COLOR) {
            Some(VertexAttributeValues::Float32x4(v)) => Some(v.clone()),
            _ => None,
        };

        // Ensure all attribute arrays have at least vertex_count entries
        let uvs = uvs.filter(|v| v.len() >= vertex_count);
        let normals = normals.filter(|v| v.len() >= vertex_count);
        let colors = colors.filter(|v| v.len() >= vertex_count);

        Self { uvs, normals, colors }
    }

    /// Linearly interpolate all attributes at parameter `t` between v1 and v2,
    /// writing the result into v1's slot.
    fn interpolate(&mut self, v1: usize, v2: usize, t: f32) {
        let s = 1.0 - t;
        if let Some(ref mut uvs) = self.uvs {
            let a = uvs[v1];
            let b = uvs[v2];
            uvs[v1] = [s * a[0] + t * b[0], s * a[1] + t * b[1]];
        }
        if let Some(ref mut normals) = self.normals {
            let a = normals[v1];
            let b = normals[v2];
            let mut n = [
                s * a[0] + t * b[0],
                s * a[1] + t * b[1],
                s * a[2] + t * b[2],
            ];
            // Re-normalise the interpolated normal
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if len > 1e-12 {
                let inv = 1.0 / len;
                n[0] *= inv;
                n[1] *= inv;
                n[2] *= inv;
            }
            normals[v1] = n;
        }
        if let Some(ref mut colors) = self.colors {
            let a = colors[v1];
            let b = colors[v2];
            colors[v1] = [
                s * a[0] + t * b[0],
                s * a[1] + t * b[1],
                s * a[2] + t * b[2],
                s * a[3] + t * b[3],
            ];
        }
    }

    /// Compact the attribute arrays to only include vertices marked as used.
    fn compact(&self, vertex_used: &[bool]) -> CompactedAttributes {
        let uvs = self.uvs.as_ref().map(|arr| {
            vertex_used.iter().enumerate()
                .filter(|(_, &used)| used)
                .map(|(i, _)| arr[i])
                .collect::<Vec<_>>()
        });
        let normals = self.normals.as_ref().map(|arr| {
            vertex_used.iter().enumerate()
                .filter(|(_, &used)| used)
                .map(|(i, _)| arr[i])
                .collect::<Vec<_>>()
        });
        let colors = self.colors.as_ref().map(|arr| {
            vertex_used.iter().enumerate()
                .filter(|(_, &used)| used)
                .map(|(i, _)| arr[i])
                .collect::<Vec<_>>()
        });
        CompactedAttributes { uvs, normals, colors }
    }
}

struct CompactedAttributes {
    uvs: Option<Vec<[f32; 2]>>,
    normals: Option<Vec<[f32; 3]>>,
    colors: Option<Vec<[f32; 4]>>,
}

// ─── Public simplify_mesh (QEM, attribute-preserving) ────────────────────────

/// Simplify a Bevy mesh using Quadric Error Metric edge collapse.
///
/// Unlike the previous implementation this version **preserves vertex attributes**
/// (UVs, normals, vertex colours) by linearly interpolating them at each collapse
/// point. The interpolation parameter is determined by the optimal collapse
/// position projected onto the edge, so attribute quality degrades gracefully.
///
/// `target_ratio` is the fraction of triangles to keep (e.g., 0.5 = 50%).
pub fn simplify_mesh(mesh: &Mesh, target_ratio: f32) -> Mesh {
    if mesh.primitive_topology() != PrimitiveTopology::TriangleList {
        return mesh.clone();
    }

    let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(pos)) => pos.clone(),
        _ => return mesh.clone(),
    };

    if positions.len() < 3 {
        return mesh.clone();
    }

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

    let n = positions.len();
    let mut attrs = VertexAttributes::from_mesh(mesh, n);

    let (new_positions, new_indices, vertex_used) =
        qem_simplify_with_attrs(&positions, &indices, target_tris, &mut attrs);

    let compacted = attrs.compact(&vertex_used);

    build_output_mesh(new_positions, new_indices, compacted)
}

// ─── Fast Simplifier (position-only) ─────────────────────────────────────────

/// Fast position-only simplification (QEM without attribute tracking).
pub fn fast_simplify_mesh(mesh: &Mesh, target_ratio: f32) -> Mesh {
    if mesh.primitive_topology() != PrimitiveTopology::TriangleList {
        return mesh.clone();
    }

    let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(pos)) => pos.clone(),
        _ => return mesh.clone(),
    };

    if positions.len() < 3 {
        return mesh.clone();
    }

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

    let (new_positions, new_indices) = qem_simplify(&positions, &indices, target_tris);

    let mut result = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::default(),
    );
    result.insert_attribute(Mesh::ATTRIBUTE_POSITION, new_positions.clone());
    let normals = compute_smooth_normals(&new_positions, &new_indices);
    result.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    let uvs: Vec<[f32; 2]> = new_positions.iter()
        .map(|p| [p[0] * 0.5 + 0.5, p[2] * 0.5 + 0.5])
        .collect();
    result.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    result.insert_indices(Indices::U32(new_indices));
    result
}

// ─── Attribute-preserving QEM core ───────────────────────────────────────────

fn qem_simplify_with_attrs(
    positions: &[[f32; 3]],
    indices: &[u32],
    target_tris: usize,
    attrs: &mut VertexAttributes,
) -> (Vec<[f32; 3]>, Vec<u32>, Vec<bool>) {
    let n = positions.len();
    let mut pos = positions.to_vec();
    let mut remap: Vec<usize> = (0..n).collect();

    let mut quadrics = vec![Quadric::zero(); n];
    let tri_count_initial = indices.len() / 3;

    for t in 0..tri_count_initial {
        let i0 = indices[t * 3] as usize;
        let i1 = indices[t * 3 + 1] as usize;
        let i2 = indices[t * 3 + 2] as usize;
        let p0 = pos[i0];
        let p1 = pos[i1];
        let p2 = pos[i2];
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        if len < 1e-12 { continue; }
        let inv = 1.0 / len;
        let (a, b, c) = (nx * inv, ny * inv, nz * inv);
        let d = -(a * p0[0] + b * p0[1] + c * p0[2]);
        let q = Quadric::from_plane(a, b, c, d);
        quadrics[i0] = quadrics[i0].add(&q);
        quadrics[i1] = quadrics[i1].add(&q);
        quadrics[i2] = quadrics[i2].add(&q);
    }

    let mut heap: BinaryHeap<Reverse<EdgeCollapse>> = BinaryHeap::new();
    let mut seen_edges = std::collections::HashSet::new();

    let mut triangles: Vec<[usize; 3]> = (0..tri_count_initial)
        .map(|t| [
            indices[t * 3] as usize,
            indices[t * 3 + 1] as usize,
            indices[t * 3 + 2] as usize,
        ])
        .collect();

    let mut vertex_tris: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (ti, tri) in triangles.iter().enumerate() {
        for &vi in tri.iter() {
            vertex_tris[vi].push(ti);
        }
    }

    for t in 0..tri_count_initial {
        let tri_verts = triangles[t];
        for edge_idx in 0..3 {
            let mut v1 = tri_verts[edge_idx];
            let mut v2 = tri_verts[(edge_idx + 1) % 3];
            if v1 > v2 { std::mem::swap(&mut v1, &mut v2); }
            if seen_edges.insert((v1, v2)) {
                let combined = quadrics[v1].add(&quadrics[v2]);
                let opt = combined.optimal_point(pos[v1], pos[v2]);
                let t_attr = combined.optimal_t(pos[v1], pos[v2]);
                let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
                heap.push(Reverse(EdgeCollapse { cost, v1, v2, optimal: opt, t: t_attr }));
            }
        }
    }

    let mut current_tri_count = tri_count_initial;
    let mut removed = vec![false; tri_count_initial];

    while current_tri_count > target_tris {
        let collapse = match heap.pop() {
            Some(Reverse(c)) => c,
            None => break,
        };

        let actual_v1 = resolve(&mut remap, collapse.v1);
        let actual_v2 = resolve(&mut remap, collapse.v2);
        if actual_v1 == actual_v2 { continue; }

        // Recompute the interpolation parameter from the current resolved
        // positions, since earlier collapses may have moved actual_v1/actual_v2
        // from where they were when this entry was pushed onto the heap.
        let combined_q = quadrics[actual_v1].add(&quadrics[actual_v2]);
        let fresh_t = combined_q.optimal_t(pos[actual_v1], pos[actual_v2]);
        pos[actual_v1] = collapse.optimal;
        attrs.interpolate(actual_v1, actual_v2, fresh_t);

        remap[actual_v2] = actual_v1;
        quadrics[actual_v1] = quadrics[actual_v1].add(&quadrics[actual_v2]);

        let v2_adj = std::mem::take(&mut vertex_tris[actual_v2]);
        let mut tris_removed = 0;
        for &ti in &v2_adj {
            if removed[ti] { continue; }
            let tri = &mut triangles[ti];
            for v in tri.iter_mut() { *v = resolve(&mut remap, *v); }
            if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                removed[ti] = true;
                tris_removed += 1;
            } else {
                vertex_tris[actual_v1].push(ti);
            }
        }

        let v1_adj_len = vertex_tris[actual_v1].len();
        let mut i = 0;
        while i < vertex_tris[actual_v1].len().min(v1_adj_len) {
            let ti = vertex_tris[actual_v1][i];
            if !removed[ti] {
                let tri = &mut triangles[ti];
                for v in tri.iter_mut() { *v = resolve(&mut remap, *v); }
                if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                    removed[ti] = true;
                    tris_removed += 1;
                }
            }
            i += 1;
        }

        vertex_tris[actual_v1].sort_unstable();
        vertex_tris[actual_v1].dedup();
        vertex_tris[actual_v1].retain(|&ti| !removed[ti]);

        current_tri_count = current_tri_count.saturating_sub(tris_removed);

        let v1 = actual_v1;
        let mut new_neighbors = std::collections::HashSet::new();
        for &ti in &vertex_tris[v1] {
            if removed[ti] { continue; }
            let tri = triangles[ti];
            for &tv in tri.iter() {
                let rv = resolve(&mut remap, tv);
                if rv != v1 {
                    let key = if v1 < rv { (v1, rv) } else { (rv, v1) };
                    new_neighbors.insert(key);
                }
            }
        }

        for (nv1, nv2) in new_neighbors {
            let combined = quadrics[nv1].add(&quadrics[nv2]);
            let opt = combined.optimal_point(pos[nv1], pos[nv2]);
            let t_attr = combined.optimal_t(pos[nv1], pos[nv2]);
            let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
            heap.push(Reverse(EdgeCollapse { cost, v1: nv1, v2: nv2, optimal: opt, t: t_attr }));
        }
    }

    let mut vertex_used = vec![false; n];
    let mut final_tris: Vec<[usize; 3]> = Vec::new();

    for (ti, tri) in triangles.iter().enumerate() {
        if removed[ti] { continue; }
        let rv0 = resolve(&mut remap, tri[0]);
        let rv1 = resolve(&mut remap, tri[1]);
        let rv2 = resolve(&mut remap, tri[2]);
        if rv0 == rv1 || rv1 == rv2 || rv0 == rv2 { continue; }
        vertex_used[rv0] = true;
        vertex_used[rv1] = true;
        vertex_used[rv2] = true;
        final_tris.push([rv0, rv1, rv2]);
    }

    let mut new_index = vec![0usize; n];
    let mut new_positions: Vec<[f32; 3]> = Vec::new();
    for (i, &used) in vertex_used.iter().enumerate() {
        if used {
            new_index[i] = new_positions.len();
            new_positions.push(pos[i]);
        }
    }

    let new_indices: Vec<u32> = final_tris.iter()
        .flat_map(|tri| [
            new_index[tri[0]] as u32,
            new_index[tri[1]] as u32,
            new_index[tri[2]] as u32,
        ])
        .collect();

    (new_positions, new_indices, vertex_used)
}

// ─── Output Mesh Builder ──────────────────────────────────────────────────────

fn build_output_mesh(
    new_positions: Vec<[f32; 3]>,
    new_indices: Vec<u32>,
    attrs: CompactedAttributes,
) -> Mesh {
    let mut result = Mesh::new(
        PrimitiveTopology::TriangleList,
        bevy::asset::RenderAssetUsages::default(),
    );

    result.insert_attribute(Mesh::ATTRIBUTE_POSITION, new_positions.clone());

    if let Some(normals) = attrs.normals {
        result.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    } else {
        let normals = compute_smooth_normals(&new_positions, &new_indices);
        result.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    }

    if let Some(uvs) = attrs.uvs {
        result.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    } else {
        let uvs: Vec<[f32; 2]> = new_positions.iter()
            .map(|p| [p[0] * 0.5 + 0.5, p[2] * 0.5 + 0.5])
            .collect();
        result.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    }

    if let Some(colors) = attrs.colors {
        result.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    }

    result.insert_indices(Indices::U32(new_indices));
    result
}

// ─── Legacy position-only QEM (used by FastSimplifier) ───────────────────────

fn qem_simplify(
    positions: &[[f32; 3]],
    indices: &[u32],
    target_tris: usize,
) -> (Vec<[f32; 3]>, Vec<u32>) {
    let n = positions.len();
    let mut pos = positions.to_vec();
    let mut remap: Vec<usize> = (0..n).collect();
    let mut quadrics = vec![Quadric::zero(); n];
    let tri_count_initial = indices.len() / 3;

    for t in 0..tri_count_initial {
        let i0 = indices[t * 3] as usize;
        let i1 = indices[t * 3 + 1] as usize;
        let i2 = indices[t * 3 + 2] as usize;
        let p0 = pos[i0]; let p1 = pos[i1]; let p2 = pos[i2];
        let e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        let e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        let nx = e1[1]*e2[2]-e1[2]*e2[1];
        let ny = e1[2]*e2[0]-e1[0]*e2[2];
        let nz = e1[0]*e2[1]-e1[1]*e2[0];
        let len = (nx*nx+ny*ny+nz*nz).sqrt();
        if len < 1e-12 { continue; }
        let inv = 1.0/len;
        let (a,b,c) = (nx*inv, ny*inv, nz*inv);
        let d = -(a*p0[0]+b*p0[1]+c*p0[2]);
        let q = Quadric::from_plane(a,b,c,d);
        quadrics[i0] = quadrics[i0].add(&q);
        quadrics[i1] = quadrics[i1].add(&q);
        quadrics[i2] = quadrics[i2].add(&q);
    }

    let mut heap: BinaryHeap<Reverse<EdgeCollapse>> = BinaryHeap::new();
    let mut seen_edges = std::collections::HashSet::new();

    let mut triangles: Vec<[usize; 3]> = (0..tri_count_initial)
        .map(|t| [indices[t*3] as usize, indices[t*3+1] as usize, indices[t*3+2] as usize])
        .collect();

    let mut vertex_tris: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (ti, tri) in triangles.iter().enumerate() {
        for &vi in tri.iter() { vertex_tris[vi].push(ti); }
    }

    for t in 0..tri_count_initial {
        let tri_verts = triangles[t];
        for edge_idx in 0..3 {
            let mut v1 = tri_verts[edge_idx];
            let mut v2 = tri_verts[(edge_idx+1)%3];
            if v1 > v2 { std::mem::swap(&mut v1, &mut v2); }
            if seen_edges.insert((v1, v2)) {
                let combined = quadrics[v1].add(&quadrics[v2]);
                let opt = combined.optimal_point(pos[v1], pos[v2]);
                let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
                heap.push(Reverse(EdgeCollapse { cost, v1, v2, optimal: opt, t: 0.5 }));
            }
        }
    }

    let mut current_tri_count = tri_count_initial;
    let mut removed = vec![false; tri_count_initial];

    while current_tri_count > target_tris {
        let collapse = match heap.pop() {
            Some(Reverse(c)) => c,
            None => break,
        };
        let actual_v1 = resolve(&mut remap, collapse.v1);
        let actual_v2 = resolve(&mut remap, collapse.v2);
        if actual_v1 == actual_v2 { continue; }

        pos[actual_v1] = collapse.optimal;
        remap[actual_v2] = actual_v1;
        quadrics[actual_v1] = quadrics[actual_v1].add(&quadrics[actual_v2]);

        let v2_adj = std::mem::take(&mut vertex_tris[actual_v2]);
        let mut tris_removed = 0;
        for &ti in &v2_adj {
            if removed[ti] { continue; }
            let tri = &mut triangles[ti];
            for v in tri.iter_mut() { *v = resolve(&mut remap, *v); }
            if tri[0]==tri[1] || tri[1]==tri[2] || tri[0]==tri[2] {
                removed[ti] = true;
                tris_removed += 1;
            } else {
                vertex_tris[actual_v1].push(ti);
            }
        }

        let v1_adj_len = vertex_tris[actual_v1].len();
        let mut i = 0;
        while i < vertex_tris[actual_v1].len().min(v1_adj_len) {
            let ti = vertex_tris[actual_v1][i];
            if !removed[ti] {
                let tri = &mut triangles[ti];
                for v in tri.iter_mut() { *v = resolve(&mut remap, *v); }
                if tri[0]==tri[1] || tri[1]==tri[2] || tri[0]==tri[2] {
                    removed[ti] = true;
                    tris_removed += 1;
                }
            }
            i += 1;
        }

        vertex_tris[actual_v1].sort_unstable();
        vertex_tris[actual_v1].dedup();
        vertex_tris[actual_v1].retain(|&ti| !removed[ti]);

        current_tri_count = current_tri_count.saturating_sub(tris_removed);

        let v1 = actual_v1;
        let mut new_neighbors = std::collections::HashSet::new();
        for &ti in &vertex_tris[v1] {
            if removed[ti] { continue; }
            let tri = triangles[ti];
            for &tv in tri.iter() {
                let rv = resolve(&mut remap, tv);
                if rv != v1 {
                    let key = if v1 < rv { (v1, rv) } else { (rv, v1) };
                    new_neighbors.insert(key);
                }
            }
        }
        for (nv1, nv2) in new_neighbors {
            let combined = quadrics[nv1].add(&quadrics[nv2]);
            let opt = combined.optimal_point(pos[nv1], pos[nv2]);
            let cost = combined.evaluate(opt[0], opt[1], opt[2]).abs();
            heap.push(Reverse(EdgeCollapse { cost, v1: nv1, v2: nv2, optimal: opt, t: 0.5 }));
        }
    }

    let mut vertex_used = vec![false; n];
    let mut final_tris: Vec<[usize; 3]> = Vec::new();
    for (ti, tri) in triangles.iter().enumerate() {
        if removed[ti] { continue; }
        let rv0 = resolve(&mut remap, tri[0]);
        let rv1 = resolve(&mut remap, tri[1]);
        let rv2 = resolve(&mut remap, tri[2]);
        if rv0==rv1 || rv1==rv2 || rv0==rv2 { continue; }
        vertex_used[rv0] = true;
        vertex_used[rv1] = true;
        vertex_used[rv2] = true;
        final_tris.push([rv0, rv1, rv2]);
    }

    let mut new_index = vec![0usize; n];
    let mut new_positions: Vec<[f32; 3]> = Vec::new();
    for (i, &used) in vertex_used.iter().enumerate() {
        if used {
            new_index[i] = new_positions.len();
            new_positions.push(pos[i]);
        }
    }

    let new_indices: Vec<u32> = final_tris.iter()
        .flat_map(|tri| [
            new_index[tri[0]] as u32,
            new_index[tri[1]] as u32,
            new_index[tri[2]] as u32,
        ])
        .collect();

    (new_positions, new_indices)
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/// Follow the remap chain to find the canonical vertex, with path compression.
fn resolve(remap: &mut [usize], mut v: usize) -> usize {
    let mut root = v;
    while remap[root] != root { root = remap[root]; }
    while remap[v] != root {
        let next = remap[v];
        remap[v] = root;
        v = next;
    }
    root
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
        let e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
        let e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
        let nx = e1[1]*e2[2]-e1[2]*e2[1];
        let ny = e1[2]*e2[0]-e1[0]*e2[2];
        let nz = e1[0]*e2[1]-e1[1]*e2[0];
        for &idx in &[i0, i1, i2] {
            normals[idx][0] += nx;
            normals[idx][1] += ny;
            normals[idx][2] += nz;
        }
    }
    for normal in &mut normals {
        let len = (normal[0]*normal[0]+normal[1]*normal[1]+normal[2]*normal[2]).sqrt();
        if len > 1e-12 {
            let inv = 1.0/len;
            normal[0] *= inv; normal[1] *= inv; normal[2] *= inv;
        } else {
            *normal = [0.0, 1.0, 0.0];
        }
    }
    normals
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
    use bevy::asset::RenderAssetUsages;

    fn make_quad() -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 1.0], [0.0, 0.0, 1.0]],
        );
        mesh.insert_indices(Indices::U32(vec![0, 1, 2, 0, 2, 3]));
        mesh
    }

    fn make_grid(size: u32) -> Mesh {
        let mut positions = Vec::new();
        let mut uvs: Vec<[f32; 2]> = Vec::new();
        let mut normals: Vec<[f32; 3]> = Vec::new();
        let mut indices = Vec::new();

        for z in 0..=size {
            for x in 0..=size {
                positions.push([x as f32, 0.0, z as f32]);
                uvs.push([x as f32 / size as f32, z as f32 / size as f32]);
                normals.push([0.0, 1.0, 0.0]);
            }
        }

        let cols = size + 1;
        for z in 0..size {
            for x in 0..size {
                let tl = z * cols + x;
                let tr = tl + 1;
                let bl = tl + cols;
                let br = bl + 1;
                indices.push(tl); indices.push(bl); indices.push(tr);
                indices.push(tr); indices.push(bl); indices.push(br);
            }
        }

        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
        mesh.insert_indices(Indices::U32(indices));
        mesh
    }

    #[test]
    fn qem_simplifier_trait_reduces_triangles() {
        let mesh = make_grid(10);
        let simplifier = QemSimplifier;
        let result = simplifier.simplify(&mesh, 0.5);
        let orig_tris = mesh.indices().unwrap().len() / 3;
        let result_tris = result.indices().unwrap().len() / 3;
        assert!(result_tris < orig_tris, "Expected fewer triangles");
    }

    #[test]
    fn fast_simplifier_trait_reduces_triangles() {
        let mesh = make_grid(10);
        let simplifier = FastSimplifier;
        let result = simplifier.simplify(&mesh, 0.5);
        let orig_tris = mesh.indices().unwrap().len() / 3;
        let result_tris = result.indices().unwrap().len() / 3;
        assert!(result_tris < orig_tris, "Expected fewer triangles");
    }

    #[test]
    fn qem_simplifier_name() {
        assert!(QemSimplifier.name().contains("QEM"));
    }

    #[test]
    fn fast_simplifier_name() {
        assert!(FastSimplifier.name().contains("Fast"));
    }

    #[test]
    fn simplify_mesh_preserves_uvs_from_source() {
        let mesh = make_grid(10);
        let result = simplify_mesh(&mesh, 0.5);
        let uvs = match result.attribute(Mesh::ATTRIBUTE_UV_0).unwrap() {
            VertexAttributeValues::Float32x2(v) => v.clone(),
            _ => panic!("Expected Float32x2 UVs"),
        };
        let all_in_range = uvs.iter().all(|[u, v]| *u >= -0.01 && *u <= 1.01 && *v >= -0.01 && *v <= 1.01);
        assert!(all_in_range, "UV out of expected [0,1] range: {:?}", &uvs[..uvs.len().min(5)]);
    }

    #[test]
    fn simplify_mesh_without_source_uvs_falls_back_to_planar() {
        let grid = make_grid(5);
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        let positions = grid.attribute(Mesh::ATTRIBUTE_POSITION).unwrap().clone();
        let indices = grid.indices().unwrap().clone();
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        match indices {
            Indices::U32(i) => mesh.insert_indices(Indices::U32(i)),
            Indices::U16(i) => mesh.insert_indices(Indices::U16(i)),
        }
        let result = simplify_mesh(&mesh, 0.5);
        assert!(result.attribute(Mesh::ATTRIBUTE_UV_0).is_some(), "Should have fallback UVs");
    }

    #[test]
    fn simplify_mesh_preserves_normals_from_source() {
        let mesh = make_grid(10);
        let result = simplify_mesh(&mesh, 0.5);
        let normals = match result.attribute(Mesh::ATTRIBUTE_NORMAL).unwrap() {
            VertexAttributeValues::Float32x3(v) => v.clone(),
            _ => panic!("Expected Float32x3 normals"),
        };
        for n in &normals {
            let len = (n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt();
            assert!((len - 1.0).abs() < 0.01, "Normal not unit: {:?} len={}", n, len);
        }
    }

    #[test]
    fn simplify_mesh_returns_clone_for_small_mesh() {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        );
        mesh.insert_indices(Indices::U32(vec![0, 1, 2]));
        let result = simplify_mesh(&mesh, 0.5);
        assert_eq!(result.indices().unwrap().len(), 3);
    }

    #[test]
    fn simplify_mesh_returns_clone_when_ratio_is_one() {
        let mesh = make_quad();
        let result = simplify_mesh(&mesh, 1.0);
        assert_eq!(result.indices().unwrap().len(), mesh.indices().unwrap().len());
    }

    #[test]
    fn simplify_mesh_reduces_triangle_count() {
        let mesh = make_grid(10);
        let original_tri_count = mesh.indices().unwrap().len() / 3;
        assert_eq!(original_tri_count, 200);
        let result = simplify_mesh(&mesh, 0.5);
        let simplified_tri_count = result.indices().unwrap().len() / 3;
        assert!(simplified_tri_count < original_tri_count,
            "Expected fewer triangles: got {} vs original {}", simplified_tri_count, original_tri_count);
        assert!(simplified_tri_count <= (original_tri_count as f32 * 0.7) as usize,
            "Expected at most 70% of original: got {}", simplified_tri_count);
    }

    #[test]
    fn simplify_mesh_aggressive_ratio() {
        let mesh = make_grid(10);
        let original_tri_count = mesh.indices().unwrap().len() / 3;
        let result = simplify_mesh(&mesh, 0.1);
        let simplified_tri_count = result.indices().unwrap().len() / 3;
        assert!(simplified_tri_count < original_tri_count / 2,
            "Expected aggressive simplification: got {} from {}", simplified_tri_count, original_tri_count);
    }

    #[test]
    fn simplify_mesh_preserves_topology() {
        let mesh = make_grid(5);
        let result = simplify_mesh(&mesh, 0.5);
        assert_eq!(result.primitive_topology(), PrimitiveTopology::TriangleList);
        assert!(result.indices().unwrap().len() % 3 == 0);
        let pos_count = match result.attribute(Mesh::ATTRIBUTE_POSITION).unwrap() {
            VertexAttributeValues::Float32x3(p) => p.len(),
            _ => panic!("Expected Float32x3 positions"),
        };
        match result.indices().unwrap() {
            Indices::U32(idx) => {
                for &i in idx {
                    assert!((i as usize) < pos_count,
                        "Index {} out of bounds (positions: {})", i, pos_count);
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
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]);
        let result = simplify_mesh(&mesh, 0.5);
        assert_eq!(result.primitive_topology(), PrimitiveTopology::LineList);
    }

    #[test]
    fn quadric_zero_evaluates_to_zero() {
        let q = Quadric::zero();
        assert_eq!(q.evaluate(1.0, 2.0, 3.0), 0.0);
    }

    #[test]
    fn quadric_from_plane_evaluates_correctly() {
        let q = Quadric::from_plane(0.0, 1.0, 0.0, 0.0);
        assert!((q.evaluate(5.0, 0.0, 3.0)).abs() < 1e-6);
        assert!((q.evaluate(0.0, 1.0, 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn quadric_add_combines() {
        let q1 = Quadric::from_plane(1.0, 0.0, 0.0, 0.0);
        let q2 = Quadric::from_plane(0.0, 1.0, 0.0, 0.0);
        let combined = q1.add(&q2);
        assert!(combined.evaluate(0.0, 0.0, 0.0).abs() < 1e-6);
        assert!((combined.evaluate(1.0, 1.0, 0.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn quadric_optimal_point_falls_back_to_midpoint_for_singular() {
        let q = Quadric::zero();
        let v1 = [0.0, 0.0, 0.0];
        let v2 = [2.0, 4.0, 6.0];
        let opt = q.optimal_point(v1, v2);
        assert!((opt[0] - 1.0).abs() < 1e-6);
        assert!((opt[1] - 2.0).abs() < 1e-6);
        assert!((opt[2] - 3.0).abs() < 1e-6);
    }

    #[test]
    fn quadric_optimal_t_clamps_to_unit_range() {
        let q = Quadric::zero();
        let v1 = [0.0, 0.0, 0.0];
        let v2 = [1.0, 0.0, 0.0];
        let t = q.optimal_t(v1, v2);
        assert!(t >= 0.0 && t <= 1.0, "t={} out of [0,1]", t);
    }

    #[test]
    fn attribute_interpolation_midpoint() {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, vec![[0.0_f32, 0.0_f32], [1.0_f32, 1.0_f32]]);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[1.0_f32, 0.0_f32, 0.0_f32], [0.0_f32, 1.0_f32, 0.0_f32]]);
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0_f32, 0.0_f32, 0.0_f32], [1.0_f32, 0.0_f32, 0.0_f32]]);
        mesh.insert_indices(Indices::U32(vec![]));
        let mut attrs = VertexAttributes::from_mesh(&mesh, 2);
        attrs.interpolate(0, 1, 0.5);
        let uvs = attrs.uvs.unwrap();
        assert!((uvs[0][0] - 0.5).abs() < 1e-5);
        assert!((uvs[0][1] - 0.5).abs() < 1e-5);
        let normals = attrs.normals.unwrap();
        let n = normals[0];
        let len = (n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt();
        assert!((len - 1.0).abs() < 1e-5, "Interpolated normal not unit: len={}", len);
    }

    #[test]
    fn compute_smooth_normals_produces_unit_normals() {
        let positions = vec![[0.0,0.0,0.0],[1.0,0.0,0.0],[0.0,0.0,1.0],[1.0,0.0,1.0]];
        let indices = vec![0, 1, 2, 1, 3, 2];
        let normals = compute_smooth_normals(&positions, &indices);
        assert_eq!(normals.len(), positions.len());
        for n in &normals {
            let len = (n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt();
            assert!((len - 1.0).abs() < 1e-5, "Normal not unit: {:?}", n);
        }
    }

    #[test]
    fn compute_smooth_normals_flat_plane_points_up() {
        let positions = vec![[0.0,0.0,0.0],[1.0,0.0,0.0],[0.0,0.0,1.0]];
        let indices = vec![0, 1, 2];
        let normals = compute_smooth_normals(&positions, &indices);
        for n in &normals {
            assert!((n[0]).abs() < 1e-5);
            assert!((n[1].abs() - 1.0).abs() < 1e-5);
            assert!((n[2]).abs() < 1e-5);
        }
    }

    #[test]
    fn edge_collapse_nan_cost_sorts_last() {
        let mut heap = BinaryHeap::new();
        heap.push(Reverse(EdgeCollapse { cost: f32::NAN, v1: 0, v2: 1, optimal: [0.0; 3], t: 0.5 }));
        heap.push(Reverse(EdgeCollapse { cost: 1.0,     v1: 2, v2: 3, optimal: [0.0; 3], t: 0.5 }));
        heap.push(Reverse(EdgeCollapse { cost: 0.5,     v1: 4, v2: 5, optimal: [0.0; 3], t: 0.5 }));
        let first = heap.pop().unwrap().0;
        assert_eq!(first.cost, 0.5);
        let second = heap.pop().unwrap().0;
        assert_eq!(second.cost, 1.0);
        let third = heap.pop().unwrap().0;
        assert!(third.cost.is_nan());
    }
}
