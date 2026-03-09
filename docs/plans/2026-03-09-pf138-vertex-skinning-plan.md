# PF-138: CPU-Based 2D Vertex Skinning — Implementation Plan

**Design Doc:** `docs/plans/2026-03-09-2d-vertex-skinning-design.md`
**Branch:** `feat/pf-138-vertex-skinning`
**Estimated Effort:** 4-6 hours across 6 tasks

---

## Pre-Implementation Checklist

- [ ] Read design doc (done during planning)
- [ ] Verify `bevy_sprite` feature enabled in `engine/Cargo.toml` (confirmed: line 32)
- [ ] Confirm no existing `SkinnedMesh2d` or `BoneWorldTransforms2d` types (confirmed: zero matches)
- [ ] Confirm `Mesh2d`, `MeshMaterial2d<ColorMaterial>` are available via `bevy::prelude::*` + `bevy::sprite::*`

---

## Task 1: Add `SkinnedMesh2d` and `BoneWorldTransforms2d` Components

**File:** `engine/src/core/skeleton2d.rs`
**Type:** Data structures only (no systems)
**Test:** `cargo test --lib -p spawnforge-engine` (compile check; unit tests in Task 2)

### 1.1 Add `SkinnedMesh2d` component

Append after the `SkeletonEnabled2d` marker (line 106):

```rust
/// Runtime component for CPU-skinned 2D meshes.
/// Created once when a skeleton with mesh attachments is enabled.
/// NOT serialized in scene files — derived from SkeletonData2d on load.
#[derive(Component)]
pub struct SkinnedMesh2d {
    /// Bind-pose vertex positions (never modified after creation).
    pub bind_positions: Vec<[f32; 2]>,
    /// Bind-pose UVs (copied to mesh once at init).
    pub bind_uvs: Vec<[f32; 2]>,
    /// Triangle indices (copied to mesh once at init).
    pub triangles: Vec<u16>,
    /// Pre-resolved bone indices per vertex (index into SkeletonData2d.bones).
    /// Replaces per-frame string-based HashMap lookups.
    pub vertex_bone_indices: Vec<Vec<usize>>,
    /// Corresponding weights per vertex (parallel to vertex_bone_indices).
    pub vertex_bone_weights: Vec<Vec<f32>>,
    /// Bind-pose world transforms per bone: (position, rotation_rad, scale).
    /// The inverse operation is applied analytically during skinning.
    pub bind_pose_transforms: Vec<(Vec2, f32, Vec2)>,
    /// Name of the source attachment (for skin-switch detection).
    pub source_attachment: String,
}
```

### 1.2 Add `BoneWorldTransforms2d` component

Append after `SkinnedMesh2d`:

```rust
/// Cached per-frame world transforms for skeleton bones.
/// Computed once after animation + IK, reused by skinning and gizmo systems.
#[derive(Component)]
pub struct BoneWorldTransforms2d {
    /// Per-bone: (world_position, world_rotation_deg, world_scale).
    /// Indexed by bone order in SkeletonData2d.bones.
    pub transforms: Vec<(Vec2, f32, Vec2)>,
}
```

### 1.3 Update imports in bridge/skeleton2d.rs

Add the two new types to the import block at line 7:

```rust
use crate::core::skeleton2d::{
    SkeletonData2d, SkeletonEnabled2d, Bone2dDef, IkConstraint2d, AttachmentData,
    SkinnedMesh2d, BoneWorldTransforms2d,
};
```

### Commit point
Message: `feat(engine): add SkinnedMesh2d and BoneWorldTransforms2d components`

---

## Task 2: Pure Functions — Bind-Pose Init + Corrected LBS

**File:** `engine/src/bridge/skeleton2d.rs`
**Type:** Pure functions + `#[cfg(test)]` unit tests
**Test command:** `cd engine && cargo test --lib skeleton2d --target wasm32-unknown-unknown` (or native if wasm target not set up for tests; these are pure Rust, no web_sys)

### 2.1 Add `compute_bind_pose_transforms` function

This reuses the existing `compute_bone_world_transforms()` (which returns a `HashMap<String, (Vec2, f32, Vec2)>`) but converts it to an ordered `Vec` indexed by bone position:

```rust
/// Compute bind-pose world transforms for each bone, ordered by bone index.
/// Called once at mesh initialization time.
fn compute_bind_pose_transforms(bones: &[Bone2dDef]) -> Vec<(Vec2, f32, Vec2)> {
    let world_map = compute_bone_world_transforms(bones);
    bones.iter().map(|bone| {
        let (pos, rot_deg, scale) = world_map
            .get(&bone.name)
            .copied()
            .unwrap_or((Vec2::ZERO, 0.0, Vec2::ONE));
        (pos, rot_deg, scale)
    }).collect()
}
```

### 2.2 Add `resolve_bone_indices` function

Converts per-vertex string bone names to integer indices:

```rust
/// Map bone name strings to indices in the bones array.
/// Returns (bone_indices, bone_weights) parallel vecs per vertex.
fn resolve_bone_indices(
    weights: &[VertexWeights],
    bones: &[Bone2dDef],
) -> (Vec<Vec<usize>>, Vec<Vec<f32>>) {
    let name_to_idx: HashMap<&str, usize> = bones
        .iter()
        .enumerate()
        .map(|(i, b)| (b.name.as_str(), i))
        .collect();

    let mut all_indices = Vec::with_capacity(weights.len());
    let mut all_weights = Vec::with_capacity(weights.len());

    for vw in weights {
        let mut indices = Vec::with_capacity(vw.bones.len());
        let mut ws = Vec::with_capacity(vw.weights.len());
        for (name, &w) in vw.bones.iter().zip(vw.weights.iter()) {
            if let Some(&idx) = name_to_idx.get(name.as_str()) {
                indices.push(idx);
                ws.push(w);
            }
        }
        all_indices.push(indices);
        all_weights.push(ws);
    }

    (all_indices, all_weights)
}
```

### 2.3 Rewrite `skin_vertices` with bind-pose inverse

Replace the existing `skin_vertices` function (lines 562-604) with the corrected LBS algorithm:

```rust
/// Corrected Linear Blend Skinning with bind-pose inverse.
///
/// For each vertex: v' = sum(w_i * forward(world_i, inverse(bind_i, v_bind)))
///
/// The inverse operation transforms the vertex from mesh space into
/// bone-local space by undoing the bind-pose transform. The forward
/// operation then applies the current animated world transform.
fn skin_vertices_lbs(
    bind_positions: &[[f32; 2]],
    vertex_bone_indices: &[Vec<usize>],
    vertex_bone_weights: &[Vec<f32>],
    bind_pose_transforms: &[(Vec2, f32, Vec2)],
    world_transforms: &[(Vec2, f32, Vec2)],
) -> Vec<[f32; 3]> {
    bind_positions
        .iter()
        .enumerate()
        .map(|(vi, &vertex)| {
            let v = Vec2::new(vertex[0], vertex[1]);
            let mut result = Vec2::ZERO;
            let mut total_weight = 0.0f32;

            let indices = &vertex_bone_indices[vi];
            let weights = &vertex_bone_weights[vi];

            for (&bone_idx, &weight) in indices.iter().zip(weights.iter()) {
                if weight < 1e-6 {
                    continue;
                }

                let (bind_pos, bind_rot_deg, bind_scale) = bind_pose_transforms[bone_idx];
                let (world_pos, world_rot_deg, world_scale) = world_transforms[bone_idx];

                // Step 1: Inverse bind-pose — vertex to bone-local space
                let bind_rad = bind_rot_deg.to_radians();
                let translated = v - bind_pos;
                let cos_b = (-bind_rad).cos();
                let sin_b = (-bind_rad).sin();
                let rotated = Vec2::new(
                    translated.x * cos_b - translated.y * sin_b,
                    translated.x * sin_b + translated.y * cos_b,
                );
                let local = Vec2::new(
                    if bind_scale.x.abs() > 1e-6 { rotated.x / bind_scale.x } else { 0.0 },
                    if bind_scale.y.abs() > 1e-6 { rotated.y / bind_scale.y } else { 0.0 },
                );

                // Step 2: Forward world transform — bone-local to world space
                let world_rad = world_rot_deg.to_radians();
                let scaled = Vec2::new(local.x * world_scale.x, local.y * world_scale.y);
                let cos_w = world_rad.cos();
                let sin_w = world_rad.sin();
                let world_rotated = Vec2::new(
                    scaled.x * cos_w - scaled.y * sin_w,
                    scaled.x * sin_w + scaled.y * cos_w,
                );
                let world_point = world_rotated + world_pos;

                result += world_point * weight;
                total_weight += weight;
            }

            if total_weight > 1e-6 {
                [result.x / total_weight, result.y / total_weight, 0.0]
            } else {
                [vertex[0], vertex[1], 0.0]
            }
        })
        .collect()
}
```

**Key differences from the old `skin_vertices`:**
1. Takes indexed bone arrays instead of string-keyed HashMap
2. Applies bind-pose inverse before world transform (fixes drift bug)
3. Returns `[f32; 3]` directly (avoids a second conversion loop in the caller)
4. Handles zero-scale bones defensively

### 2.4 Unit tests

Add a `#[cfg(test)]` module at the bottom of `bridge/skeleton2d.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::skeleton2d::{Bone2dDef, VertexWeights};

    fn make_bone(name: &str, parent: Option<&str>, pos: [f32; 2], rot: f32, length: f32) -> Bone2dDef {
        Bone2dDef {
            name: name.to_string(),
            parent_bone: parent.map(|s| s.to_string()),
            local_position: pos,
            local_rotation: rot,
            local_scale: [1.0, 1.0],
            length,
            color: [1.0, 1.0, 1.0, 1.0],
        }
    }

    #[test]
    fn test_identity_skinning_returns_bind_pose() {
        // Single root bone at origin, no rotation, no scale
        let bones = vec![make_bone("root", None, [0.0, 0.0], 0.0, 50.0)];
        let bind_pose = compute_bind_pose_transforms(&bones);

        let bind_positions = vec![[10.0, 20.0], [30.0, 40.0]];
        let vertex_bone_indices = vec![vec![0], vec![0]];
        let vertex_bone_weights = vec![vec![1.0], vec![1.0]];

        // World transforms == bind-pose transforms (no animation)
        let world_transforms = bind_pose.clone();

        let result = skin_vertices_lbs(
            &bind_positions,
            &vertex_bone_indices,
            &vertex_bone_weights,
            &bind_pose,
            &world_transforms,
        );

        // With identity skinning (world == bind), output should match input
        assert!((result[0][0] - 10.0).abs() < 0.01, "x0: {}", result[0][0]);
        assert!((result[0][1] - 20.0).abs() < 0.01, "y0: {}", result[0][1]);
        assert!((result[1][0] - 30.0).abs() < 0.01, "x1: {}", result[1][0]);
        assert!((result[1][1] - 40.0).abs() < 0.01, "y1: {}", result[1][1]);
    }

    #[test]
    fn test_single_bone_rotation() {
        // Root bone at origin, bind pose has 0 rotation
        let bones = vec![make_bone("root", None, [0.0, 0.0], 0.0, 50.0)];
        let bind_pose = compute_bind_pose_transforms(&bones);

        // Vertex at (10, 0) bound to root bone
        let bind_positions = vec![[10.0, 0.0]];
        let vertex_bone_indices = vec![vec![0]];
        let vertex_bone_weights = vec![vec![1.0]];

        // Animate: rotate root 90 degrees
        let world_transforms = vec![(Vec2::ZERO, 90.0, Vec2::ONE)];

        let result = skin_vertices_lbs(
            &bind_positions,
            &vertex_bone_indices,
            &vertex_bone_weights,
            &bind_pose,
            &world_transforms,
        );

        // (10, 0) rotated 90 degrees -> (0, 10)
        assert!((result[0][0] - 0.0).abs() < 0.1, "x: {}", result[0][0]);
        assert!((result[0][1] - 10.0).abs() < 0.1, "y: {}", result[0][1]);
    }

    #[test]
    fn test_two_bone_blend() {
        // Two bones at different positions
        let bones = vec![
            make_bone("a", None, [0.0, 0.0], 0.0, 50.0),
            make_bone("b", None, [100.0, 0.0], 0.0, 50.0),
        ];
        let bind_pose = compute_bind_pose_transforms(&bones);

        // Vertex at (50, 0) with 50/50 blend between bone a and bone b
        let bind_positions = vec![[50.0, 0.0]];
        let vertex_bone_indices = vec![vec![0, 1]];
        let vertex_bone_weights = vec![vec![0.5, 0.5]];

        // Move bone a up by 20, bone b down by 20
        let world_transforms = vec![
            (Vec2::new(0.0, 20.0), 0.0, Vec2::ONE),
            (Vec2::new(100.0, -20.0), 0.0, Vec2::ONE),
        ];

        let result = skin_vertices_lbs(
            &bind_positions,
            &vertex_bone_indices,
            &vertex_bone_weights,
            &bind_pose,
            &world_transforms,
        );

        // 50/50 blend: y should average to 0 ((20 + -20) / 2)
        assert!((result[0][0] - 50.0).abs() < 0.1, "x: {}", result[0][0]);
        assert!((result[0][1] - 0.0).abs() < 0.1, "y: {}", result[0][1]);
    }

    #[test]
    fn test_resolve_bone_indices() {
        let bones = vec![
            make_bone("hip", None, [0.0, 0.0], 0.0, 30.0),
            make_bone("knee", Some("hip"), [0.0, -30.0], 0.0, 30.0),
        ];
        let weights = vec![
            VertexWeights {
                bones: vec!["knee".to_string(), "hip".to_string()],
                weights: vec![0.7, 0.3],
            },
        ];

        let (indices, ws) = resolve_bone_indices(&weights, &bones);

        assert_eq!(indices[0], vec![1, 0]); // knee=1, hip=0
        assert!((ws[0][0] - 0.7).abs() < 1e-6);
        assert!((ws[0][1] - 0.3).abs() < 1e-6);
    }

    #[test]
    fn test_bind_pose_transforms_two_bone_chain() {
        let bones = vec![
            make_bone("root", None, [0.0, 0.0], 0.0, 50.0),
            make_bone("child", Some("root"), [10.0, 0.0], 45.0, 30.0),
        ];

        let bind = compute_bind_pose_transforms(&bones);

        // Root should be at origin
        assert!((bind[0].0.x).abs() < 0.01);
        assert!((bind[0].0.y).abs() < 0.01);
        assert!((bind[0].1).abs() < 0.01); // 0 degrees

        // Child should be offset from root's end (root length=50, rot=0 -> end at (50,0))
        // plus child local_position (10, 0) rotated by parent's world rot (0 deg)
        // child world pos = (50, 0) + rotate(0, (10, 0)) = (60, 0)
        assert!((bind[1].0.x - 60.0).abs() < 0.1, "child x: {}", bind[1].0.x);
        assert!((bind[1].0.y).abs() < 0.1, "child y: {}", bind[1].0.y);
        assert!((bind[1].1 - 45.0).abs() < 0.01); // 45 degrees
    }
}
```

### Commit point
Message: `feat(engine): add corrected LBS skinning functions with bind-pose inverse and unit tests`

---

## Task 3: `init_skinned_meshes_2d` System

**File:** `engine/src/bridge/skeleton2d.rs`
**Type:** New Bevy system
**Test command:** WASM build (compile check); visual test via dev server

### 3.1 Add the initialization system

This system detects entities that need mesh creation and builds all the runtime data:

```rust
/// Initialize Mesh2d + SkinnedMesh2d for entities with skeleton mesh attachments.
///
/// Runs on entities that have SkeletonData2d + SkeletonEnabled2d but no SkinnedMesh2d yet.
/// Also re-initializes when the active skin changes (detected by source_attachment mismatch).
pub(super) fn init_skinned_meshes_2d(
    mut commands: Commands,
    query: Query<
        (Entity, &SkeletonData2d, Option<&SkinnedMesh2d>),
        (With<SkeletonEnabled2d>, Or<(Added<SkeletonEnabled2d>, Changed<SkeletonData2d>)>),
    >,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ColorMaterial>>,
) {
    for (entity, skeleton, existing_skinned) in query.iter() {
        // Find the first mesh attachment in the active skin
        let Some(skin) = skeleton.skins.get(&skeleton.active_skin) else {
            continue;
        };

        let mut found_mesh = None;
        let mut attachment_name = String::new();
        for (name, attachment) in &skin.attachments {
            if let AttachmentData::Mesh { ref vertices, ref uvs, ref triangles, ref weights, .. } = attachment {
                if !vertices.is_empty() && !triangles.is_empty() && !weights.is_empty() {
                    found_mesh = Some((vertices, uvs, triangles, weights));
                    attachment_name = name.clone();
                    break;
                }
            }
        }

        let Some((vertices, uvs, triangles, weights)) = found_mesh else {
            continue;
        };

        // Skip if already initialized for this attachment
        if let Some(existing) = existing_skinned {
            if existing.source_attachment == attachment_name {
                continue;
            }
            // Skin changed — remove old mesh components (will be re-created below)
            commands.entity(entity).remove::<(SkinnedMesh2d, Mesh2d, MeshMaterial2d<ColorMaterial>)>();
        }

        // Build the Bevy Mesh
        let positions: Vec<[f32; 3]> = vertices.iter().map(|v| [v[0], v[1], 0.0]).collect();
        let uv_data: Vec<[f32; 2]> = if uvs.len() == vertices.len() {
            uvs.clone()
        } else {
            vec![[0.0, 0.0]; vertices.len()]
        };
        let indices: Vec<u32> = triangles.iter().map(|&i| i as u32).collect();

        let mut mesh = Mesh::new(
            bevy::mesh::PrimitiveTopology::TriangleList,
            bevy::asset::RenderAssetUsages::MAIN_WORLD | bevy::asset::RenderAssetUsages::RENDER_WORLD,
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv_data);
        mesh.insert_indices(bevy::mesh::Indices::U32(indices));

        let mesh_handle = meshes.add(mesh);
        let material_handle = materials.add(ColorMaterial::default());

        // Resolve bone indices (string -> index)
        let (vertex_bone_indices, vertex_bone_weights) = resolve_bone_indices(weights, &skeleton.bones);

        // Compute bind-pose transforms
        let bind_pose_transforms = compute_bind_pose_transforms(&skeleton.bones);

        // Compute initial world transforms (same as bind pose before any animation)
        let world_transforms = BoneWorldTransforms2d {
            transforms: bind_pose_transforms.clone(),
        };

        let skinned = SkinnedMesh2d {
            bind_positions: vertices.clone(),
            bind_uvs: uvs.clone(),
            triangles: triangles.clone(),
            vertex_bone_indices,
            vertex_bone_weights,
            bind_pose_transforms,
            source_attachment: attachment_name,
        };

        commands.entity(entity).insert((
            Mesh2d(mesh_handle),
            MeshMaterial2d(material_handle),
            skinned,
            world_transforms,
        ));
    }
}
```

### 3.2 Required imports

Add to the top of `bridge/skeleton2d.rs`:

```rust
use bevy::sprite::ColorMaterial;
```

Note: `Mesh2d` and `MeshMaterial2d` are already available through `bevy::prelude::*`.

### Edge cases to handle
- **No mesh attachment in active skin:** System skips entity silently (no error).
- **Empty vertex/triangle arrays:** Guard clause prevents creating degenerate meshes.
- **Skin switch:** Detected by `Changed<SkeletonData2d>` (since `active_skin` is a field). Old `SkinnedMesh2d` + `Mesh2d` removed and rebuilt.
- **Missing bone names in weights:** `resolve_bone_indices` silently skips unknown bones (vertex will have fewer effective weights).
- **Zero-weight-sum vertices:** `skin_vertices_lbs` returns bind-pose position as fallback.

### Commit point
Message: `feat(engine): add init_skinned_meshes_2d system for mesh attachment materialization`

---

## Task 4: Refactor `compute_bone_world_transforms_2d` to System

**File:** `engine/src/bridge/skeleton2d.rs`
**Type:** New system + refactor callers
**Test command:** `cd engine && cargo check --target wasm32-unknown-unknown --features webgl2`

### 4.1 Add the system

This system writes cached world transforms to `BoneWorldTransforms2d`, replacing per-call-site recomputation:

```rust
/// Compute and cache bone world transforms for all enabled skeletons.
/// Runs after animation + IK, before skinning.
pub(super) fn compute_bone_world_transforms_2d(
    mut query: Query<
        (&SkeletonData2d, &mut BoneWorldTransforms2d),
        With<SkeletonEnabled2d>,
    >,
) {
    for (skeleton, mut world_xforms) in query.iter_mut() {
        let world_map = compute_bone_world_transforms(&skeleton.bones);
        world_xforms.transforms = skeleton.bones.iter().map(|bone| {
            world_map
                .get(&bone.name)
                .copied()
                .unwrap_or((Vec2::ZERO, 0.0, Vec2::ONE))
        }).collect();
    }
}
```

### 4.2 Refactor `apply_vertex_skinning_2d`

Replace the existing system (lines 520-559) to use the new components:

```rust
/// CPU vertex skinning: deform mesh vertices using corrected LBS.
pub(super) fn apply_vertex_skinning_2d(
    query: Query<(
        &SkinnedMesh2d,
        &BoneWorldTransforms2d,
        &Mesh2d,
    )>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    for (skinned, world_xforms, mesh_handle) in query.iter() {
        let deformed = skin_vertices_lbs(
            &skinned.bind_positions,
            &skinned.vertex_bone_indices,
            &skinned.vertex_bone_weights,
            &skinned.bind_pose_transforms,
            &world_xforms.transforms,
        );

        if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
            mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, deformed);
        }
    }
}
```

**Key change:** Uses `mesh.insert_attribute()` (bulk replace) instead of iterating individual positions. This is more efficient and avoids length-mismatch bugs.

### 4.3 Refactor `render_skeleton_bones` to use cached transforms

Replace the `compute_bone_world_transforms` call inside `render_skeleton_bones`:

```rust
#[cfg(not(feature = "runtime"))]
pub(super) fn render_skeleton_bones(
    query: Query<(&Transform, &SkeletonData2d, &BoneWorldTransforms2d), With<SkeletonEnabled2d>>,
    mut gizmos: Gizmos,
) {
    for (transform, skeleton, world_xforms) in query.iter() {
        let entity_pos = transform.translation.truncate();

        for (i, bone) in skeleton.bones.iter().enumerate() {
            if i >= world_xforms.transforms.len() {
                break;
            }
            let (bone_pos, bone_rot, _) = world_xforms.transforms[i];
            let start = entity_pos + bone_pos;
            let rot_rad = bone_rot.to_radians();
            let end = start + Vec2::new(
                bone.length * rot_rad.cos(),
                bone.length * rot_rad.sin(),
            );

            let color = Color::srgba(bone.color[0], bone.color[1], bone.color[2], bone.color[3]);
            gizmos.line_2d(start, end, color);
            gizmos.circle_2d(Isometry2d::from_translation(start), 2.0, color);
        }
    }
}
```

**Note:** Entities without `BoneWorldTransforms2d` (legacy skeletons not yet re-enabled) will be silently excluded from gizmo rendering. This is acceptable since `init_skinned_meshes_2d` inserts the component when `SkeletonEnabled2d` is present.

### Commit point
Message: `refactor(engine): replace per-call-site bone world transform computation with cached system`

---

## Task 5: Register Systems with Correct Ordering in `bridge/mod.rs`

**File:** `engine/src/bridge/mod.rs`
**Type:** System registration
**Test command:** `cd engine && cargo check --target wasm32-unknown-unknown --features webgl2`

### 5.1 Replace the existing skeleton2d system registration

Current (lines 392-397):
```rust
// Skeletal 2D runtime systems (animation playback + IK solving + vertex skinning)
.add_systems(Update, (
    skeleton2d::advance_skeleton_animation,
    skeleton2d::solve_ik_constraints_2d,
    skeleton2d::apply_vertex_skinning_2d,
).chain())
```

Replace with:
```rust
// Skeletal 2D: init skinned meshes (runs on Added/Changed detection)
.add_systems(Update, skeleton2d::init_skinned_meshes_2d)
// Skeletal 2D runtime: animate -> IK -> compute world transforms -> skin vertices
.add_systems(Update, (
    skeleton2d::advance_skeleton_animation,
    skeleton2d::solve_ik_constraints_2d,
    skeleton2d::compute_bone_world_transforms_2d,
    skeleton2d::apply_vertex_skinning_2d,
).chain())
```

### 5.2 Ordering rationale

The `.chain()` enforces sequential execution:
1. `advance_skeleton_animation` — reads `Time`, writes `SkeletonData2d.bones[].local_*` from keyframes
2. `solve_ik_constraints_2d` — reads target `Transform`, writes `SkeletonData2d.bones[].local_rotation`
3. `compute_bone_world_transforms_2d` — reads `SkeletonData2d.bones`, writes `BoneWorldTransforms2d`
4. `apply_vertex_skinning_2d` — reads `SkinnedMesh2d` + `BoneWorldTransforms2d`, writes `Assets<Mesh>`

The `init_skinned_meshes_2d` system runs independently (not chained) because it only triggers on `Added`/`Changed` filters and does not conflict with the animation chain.

### 5.3 Verify `render_skeleton_bones` still registered

The existing registration at line 524:
```rust
.add_systems(Update, skeleton2d::render_skeleton_bones)
```
Remains unchanged. It naturally reads `BoneWorldTransforms2d` after it's been written by the chain above (same `Update` schedule, but Bevy's change detection ensures data is fresh within the same frame due to the `.chain()` constraint on the producer).

### Commit point
Message: `feat(engine): register skinning systems with correct ordering in bridge/mod.rs`

---

## Task 6: Cleanup + Remove Dead Code

**File:** `engine/src/bridge/skeleton2d.rs`
**Type:** Code removal
**Test command:** `cd engine && cargo check --target wasm32-unknown-unknown --features webgl2 && cargo check --target wasm32-unknown-unknown --features webgpu`

### 6.1 Remove old `skin_vertices` function

Delete the old function (lines 562-604) which is now replaced by `skin_vertices_lbs`.

### 6.2 Remove unused imports

After the refactor, verify that `VertexAttributeValues` is no longer imported (the new code uses `mesh.insert_attribute()` instead of mutating through `attribute_mut()`).

Remove from line 2 if no longer used:
```rust
use bevy::mesh::VertexAttributeValues;
```

### 6.3 Verify both feature builds compile

```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
```

### Commit point
Message: `refactor(engine): remove dead skin_vertices function and unused imports`

---

## Verification Checklist

After all tasks are complete, run the full verification suite:

```bash
# 1. WASM build (both backends)
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu

# 2. Unit tests (pure Rust functions)
cd engine && cargo test --lib

# 3. Web lint + typecheck (should be unaffected — no web changes)
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit

# 4. Web unit tests (should be unaffected)
cd web && npx vitest run

# 5. Full WASM build for visual testing
powershell -ExecutionPolicy Bypass -File build_wasm.ps1

# 6. Visual test: open http://localhost:3000/dev
# Create entity -> add skeleton2d -> add bone -> add mesh attachment -> enable skeleton
# Verify: mesh appears, gizmo bones visible, animation deforms mesh
```

---

## Architecture Compliance Notes

1. **Bridge isolation:** All new systems are in `bridge/skeleton2d.rs`. New data types (`SkinnedMesh2d`, `BoneWorldTransforms2d`) are in `core/skeleton2d.rs` (no web_sys/js_sys dependency).
2. **No new Rust dependencies.** Uses only `bevy::sprite::ColorMaterial` which is already available via the `bevy_sprite` feature.
3. **No web layer changes.** The skinning is entirely engine-side. The existing JS store, inspector, and MCP commands continue to work unchanged.
4. **Not serialized.** `SkinnedMesh2d` and `BoneWorldTransforms2d` are runtime-only components, not included in `EntitySnapshot` or `.forge` scene files. They are recomputed when a skeleton is loaded and enabled.
5. **WASM 4GB memory limit.** A skinned mesh with 200 vertices and 20 bones uses approximately 200 * (8 + 8 + 40 + 40) + 20 * 20 = ~19.6 KB per entity. At 200 entities that's ~4 MB — well within limits.
6. **Query param limit.** The new `init_skinned_meshes_2d` system has 4 params (commands, query, meshes, materials). The refactored `apply_vertex_skinning_2d` has 2 params. Both well under the 16-param limit.

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `engine/src/core/skeleton2d.rs` | +`SkinnedMesh2d`, +`BoneWorldTransforms2d` components |
| `engine/src/bridge/skeleton2d.rs` | +`init_skinned_meshes_2d`, +`compute_bone_world_transforms_2d`, +`skin_vertices_lbs`, +`resolve_bone_indices`, +`compute_bind_pose_transforms`, refactor `apply_vertex_skinning_2d`, refactor `render_skeleton_bones`, +unit tests, -old `skin_vertices` |
| `engine/src/bridge/mod.rs` | Updated system registration with ordering chain |

## Files NOT Modified (Intentionally)

| File | Reason |
|------|--------|
| `core/entity_factory.rs` | `SkinnedMesh2d` is runtime-only, not in snapshots |
| `bridge/scene_io.rs` | Skeleton data is already serialized via `SkeletonData2d`; runtime components recomputed on load |
| `web/src/**` | No web layer changes needed — skinning is engine-side only |
| `core/history.rs` | Undo/redo operates on `SkeletonData2d`; runtime mesh is recomputed |
