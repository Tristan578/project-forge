# CPU-Based 2D Vertex Skinning Design Document

**Ticket:** PF-30
**Date:** 2026-03-09
**Status:** Design Review
**Related Research:** PF-92, PF-99

## 1. Problem Statement

Phase 2D-5 (Skeletal 2D Animation) delivered data structures and UI for 2D skeletal
animation, but is marked "UI ONLY -- no engine integration." The core data types
(`SkeletonData2d`, `SkeletalAnimation2d`, `Bone2dDef`, `AttachmentData::Mesh`,
`VertexWeights`) exist in `engine/src/core/skeleton2d.rs` and
`engine/src/core/skeletal_animation2d.rs`. Bridge systems in
`engine/src/bridge/skeleton2d.rs` already contain implementation code for:

- `advance_skeleton_animation` -- keyframe interpolation on bone transforms
- `solve_ik_constraints_2d` -- 2-bone analytical IK
- `apply_vertex_skinning_2d` -- CPU mesh deformation
- `render_skeleton_bones` -- gizmo debug rendering
- `compute_bone_world_transforms` -- hierarchy traversal
- `skin_vertices` -- weighted vertex blending

These systems are registered in `bridge/mod.rs` and run every frame, but
**they do not produce visible output** because:

1. No entity ever has both `SkeletonData2d` + `SkeletonEnabled2d` + `Mesh2d`
   components simultaneously. The skeleton creation flow inserts skeleton data
   but never creates a corresponding `Mesh2d`.
2. The `skin_vertices` function transforms bind-pose vertices but there is no
   mechanism to create the initial Bevy `Mesh` from the `AttachmentData::Mesh`
   vertex/UV/triangle data.
3. Bind-pose storage is missing -- the current code reads `vertices` from the
   attachment each frame as the bind pose, but these are the same vertices
   being overwritten in the Bevy mesh, causing progressive drift.

## 2. Goals

- Skinned 2D mesh attachments render correctly in both edit and play modes
- Animation playback visibly deforms meshes in real time
- Works on both WebGPU and WebGL2 backends
- Performance target: 50+ skinned sprites at 60fps on WASM (mid-range hardware)
- No new Rust dependencies required

## 3. Existing Code Audit

### 3.1 What Works

| Component | Status | Location |
|-----------|--------|----------|
| `SkeletonData2d` ECS component | Functional | `core/skeleton2d.rs` |
| `SkeletalAnimation2d` component | Functional | `core/skeletal_animation2d.rs` |
| Bone hierarchy traversal | Functional | `bridge/skeleton2d.rs:compute_bone_world_transforms()` |
| Keyframe interpolation | Functional | `bridge/skeleton2d.rs:advance_skeleton_animation()` |
| 2-bone IK solver | Functional | `bridge/skeleton2d.rs:solve_ik_constraints_2d()` |
| Auto-weight computation | Functional | `bridge/skeleton2d.rs:compute_linear_weights()` |
| Skin switching | Functional | `bridge/skeleton2d.rs:apply_skeleton2d_skin_sets()` |
| Gizmo bone debug rendering | Functional | `bridge/skeleton2d.rs:render_skeleton_bones()` |
| JSON command dispatch | Functional | `core/commands/sprites.rs` (11 skeleton commands) |
| Web store/inspector | Functional | `spriteSlice.ts`, `SkeletonInspector` |

### 3.2 What Needs Work

| Issue | Description | Severity |
|-------|-------------|----------|
| No mesh creation | `AttachmentData::Mesh` data is never materialized into a Bevy `Mesh` + `Mesh2d` | **Critical** |
| No bind-pose storage | `skin_vertices` reads from attachment vertices (bind pose) but writes to the same Bevy mesh -- no separate bind-pose copy | **Critical** |
| No texture mapping | `Mesh` attachments reference `texture_id` but no `Image` asset is loaded/applied | **High** |
| No `ColorMaterial` creation | 2D meshes need `MeshMaterial2d<ColorMaterial>` but none is created | **High** |
| Slot draw ordering | `SlotDef` exists but is unused -- no z-ordering of mesh attachments | **Medium** |
| Blend modes | `BlendMode2d` enum exists but no rendering integration | **Low** |
| Multi-attachment support | `apply_vertex_skinning_2d` processes first mesh attachment only | **Medium** |

### 3.3 Skinning Algorithm Analysis

The existing `skin_vertices` function (lines 563-603 of `bridge/skeleton2d.rs`)
implements Linear Blend Skinning (LBS):

```
For each vertex v with bone weights (b_i, w_i):
  result = sum(w_i * (Rotate(bone_rot_i) * Scale(bone_scale_i) * v + bone_pos_i))
  result /= sum(w_i)
```

**Issues found:**

1. **No bind-pose inverse.** Classic LBS requires: `v' = sum(w_i * M_world_i * M_bind_inverse_i * v)`.
   The current code applies world transforms directly to the original vertex positions
   without first undoing the bind-pose transform. This means vertices are positioned
   relative to the world origin rather than relative to their bound bone.

2. **Scale applied before rotate is correct** but the lack of bind-pose inverse means
   the deformation will look wrong for any non-trivial skeleton pose.

3. **String-based bone lookups.** Each vertex weight references bones by name (Vec<String>),
   requiring a HashMap lookup per bone per vertex per frame. This is O(V * B) hash lookups.

## 4. Proposed Architecture

### 4.1 Overview

```
Bevy Frame Pipeline (per skinned entity):

1. advance_skeleton_animation  -- update bone local transforms from keyframes
2. solve_ik_constraints_2d     -- apply IK corrections
3. compute_world_transforms    -- traverse hierarchy, produce world matrices
4. compute_skinning_matrices   -- world * bind_pose_inverse per bone
5. apply_vertex_skinning       -- LBS: deform bind-pose vertices using skinning matrices
6. upload_to_mesh              -- write deformed positions + normals to Bevy Mesh
```

### 4.2 New Data Structures

#### 4.2.1 `SkinnedMesh2d` Component (new)

```rust
/// Runtime component holding the initialized mesh data for a skinned 2D entity.
/// Created once when a skeleton with mesh attachments is first enabled.
#[derive(Component)]
pub struct SkinnedMesh2d {
    /// Bind-pose vertex positions (never modified after creation)
    pub bind_positions: Vec<[f32; 2]>,
    /// Bind-pose UVs (copied to mesh once)
    pub bind_uvs: Vec<[f32; 2]>,
    /// Triangle indices (copied to mesh once)
    pub triangles: Vec<u16>,
    /// Pre-resolved bone indices per vertex (replaces string lookups)
    pub vertex_bone_indices: Vec<Vec<usize>>,
    /// Corresponding weights per vertex
    pub vertex_bone_weights: Vec<Vec<f32>>,
    /// Bind-pose inverse transforms per bone: (position, rotation_rad, scale)
    pub bind_pose_inverses: Vec<(Vec2, f32, Vec2)>,
    /// Which attachment this was created from (for skin switching)
    pub source_attachment: String,
}
```

Key design decisions:
- **Flat bone index arrays** instead of string-based lookups. Built once at mesh init
  by mapping bone names to indices in the `SkeletonData2d.bones` array.
- **Bind-pose inverses** computed once from the skeleton's rest pose at init time.
- **Separate from `SkeletonData2d`** to keep serializable data clean. This is runtime-only.

#### 4.2.2 `BoneWorldTransforms2d` Component (new)

```rust
/// Cached world transforms for the current frame, computed once and reused.
#[derive(Component)]
pub struct BoneWorldTransforms2d {
    /// Per-bone: (world_position, world_rotation_rad, world_scale)
    pub transforms: Vec<(Vec2, f32, Vec2)>,
}
```

Avoids recomputing world transforms in both the skinning system and the gizmo
rendering system. Computed once per frame after animation + IK.

### 4.3 System Pipeline

#### System 1: `init_skinned_meshes_2d` (new)

**Trigger:** Runs on entities with `Added<SkeletonEnabled2d>` or `Changed<SkeletonData2d>`
when the active skin has mesh attachments.

**Responsibilities:**
1. Read `SkeletonData2d.skins[active_skin].attachments`
2. Find `AttachmentData::Mesh` entries
3. Create a Bevy `Mesh` with:
   - `ATTRIBUTE_POSITION`: bind-pose vertices as `[x, y, 0.0]`
   - `ATTRIBUTE_UV_0`: UVs from attachment
   - `Indices`: triangles from attachment
   - `PrimitiveTopology::TriangleList`
4. Insert `Mesh2d(mesh_handle)` on the entity
5. Create `MeshMaterial2d<ColorMaterial>` with the attachment's texture (if loaded)
   or a white fallback
6. Build `SkinnedMesh2d` component:
   - Copy bind positions
   - Resolve bone name strings to indices
   - Compute bind-pose inverse from the current skeleton rest pose
7. Insert `BoneWorldTransforms2d` with identity transforms

**Skin switching:** When `active_skin` changes, remove old `SkinnedMesh2d` + `Mesh2d`
and reinitialize.

#### System 2: `compute_bone_world_transforms_2d` (refactored)

Replaces the existing per-call-site `compute_bone_world_transforms` function
with a system that writes results to `BoneWorldTransforms2d`:

```rust
fn compute_bone_world_transforms_2d(
    mut query: Query<
        (&SkeletonData2d, &mut BoneWorldTransforms2d),
        With<SkeletonEnabled2d>,
    >,
) {
    for (skeleton, mut world_transforms) in query.iter_mut() {
        // Traverse hierarchy, write to world_transforms.transforms
        // Parents-before-children order guaranteed by bones vec convention
    }
}
```

**Ordering:** Runs after `advance_skeleton_animation` and `solve_ik_constraints_2d`.

#### System 3: `apply_vertex_skinning_2d` (refactored)

The existing function is refactored to use the new data structures:

```rust
fn apply_vertex_skinning_2d(
    query: Query<(
        &SkinnedMesh2d,
        &BoneWorldTransforms2d,
        &Mesh2d,
    )>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    for (skinned, world_xforms, mesh_handle) in query.iter() {
        let deformed = compute_lbs(
            &skinned.bind_positions,
            &skinned.vertex_bone_indices,
            &skinned.vertex_bone_weights,
            &skinned.bind_pose_inverses,
            &world_xforms.transforms,
        );

        if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
            // Write deformed positions to ATTRIBUTE_POSITION
        }
    }
}
```

#### System 4: `sync_skinned_texture_2d` (new)

Listens for texture load events and updates `MeshMaterial2d<ColorMaterial>` when
a texture matching the attachment's `texture_id` becomes available.

### 4.4 Linear Blend Skinning (Corrected)

The corrected LBS algorithm with bind-pose inverse:

```
For each vertex i:
    v_bind = bind_positions[i]  // original rest-pose position
    v_deformed = Vec2::ZERO

    For each (bone_idx, weight) in vertex_weights[i]:
        // Skinning matrix = World * BindInverse
        // BindInverse undoes the rest-pose bone transform
        // World applies the current animated bone transform

        (bind_pos, bind_rot, bind_scale) = bind_pose_inverses[bone_idx]
        (world_pos, world_rot, world_scale) = world_transforms[bone_idx]

        // Apply bind-pose inverse: move vertex to bone-local space
        v_local = inverse_transform(bind_pos, bind_rot, bind_scale, v_bind)

        // Apply world transform: move from bone-local to world space
        v_world = forward_transform(world_pos, world_rot, world_scale, v_local)

        v_deformed += weight * v_world

    result[i] = v_deformed
```

Where:
```
inverse_transform(pos, rot, scale, v):
    translated = v - pos
    rotated = rotate(translated, -rot)
    scaled = [rotated.x / scale.x, rotated.y / scale.y]
    return scaled

forward_transform(pos, rot, scale, v):
    scaled = [v.x * scale.x, v.y * scale.y]
    rotated = rotate(scaled, rot)
    return rotated + pos
```

### 4.5 Bind-Pose Inverse Computation

Computed once at init time from the skeleton's rest-pose bone hierarchy:

```rust
fn compute_bind_pose_inverses(bones: &[Bone2dDef]) -> Vec<(Vec2, f32, Vec2)> {
    let world = compute_bone_world_transforms(bones);
    world.iter().map(|(pos, rot_deg, scale)| {
        // Store the world-space rest pose for each bone
        // The "inverse" is applied analytically during skinning
        (*pos, rot_deg.to_radians(), *scale)
    }).collect()
}
```

The inverse is not a matrix inverse -- it is applied procedurally during skinning
by reversing the transform steps (translate, rotate, scale in reverse order).

## 5. Integration Points

### 5.1 Files to Modify

| File | Changes |
|------|---------|
| `engine/src/core/skeleton2d.rs` | Add `SkinnedMesh2d`, `BoneWorldTransforms2d` structs |
| `engine/src/bridge/skeleton2d.rs` | Refactor `apply_vertex_skinning_2d`, add `init_skinned_meshes_2d`, `compute_bone_world_transforms_2d`, `sync_skinned_texture_2d` |
| `engine/src/bridge/mod.rs` | Register new systems in correct order, add system ordering constraints |
| `engine/src/core/entity_factory.rs` | Handle `SkinnedMesh2d` in snapshot/spawn if needed |
| `engine/src/bridge/scene_io.rs` | Ensure skeleton mesh data is exported/imported correctly |

### 5.2 System Ordering in `bridge/mod.rs`

```rust
// Play-mode systems (run during gameplay)
app.add_systems(Update, (
    skeleton2d::advance_skeleton_animation,
    skeleton2d::solve_ik_constraints_2d,
).chain().in_set(PlaySystemSet));

// Post-animation systems (run after animation updates)
app.add_systems(Update, (
    skeleton2d::compute_bone_world_transforms_2d,
    skeleton2d::apply_vertex_skinning_2d,
).chain().after(PlaySystemSet));

// Init system (runs when components change)
app.add_systems(Update, skeleton2d::init_skinned_meshes_2d);

// Editor-only
app.add_systems(Update, skeleton2d::render_skeleton_bones);
```

### 5.3 No Web Layer Changes Required

The web layer already handles:
- Skeleton data creation/editing via `spriteSlice.ts`
- Bone CRUD via MCP commands
- Skin switching via `set_skeleton2d_skin` command
- Animation playback via `play_skeletal_animation2d` command
- Skeleton inspector UI

The skinning is purely engine-side. JS sends skeleton/animation data, Rust renders it.

## 6. Performance Analysis

### 6.1 Per-Frame Cost Model

For a skinned sprite with V vertices and B bones:

| Operation | Cost | Notes |
|-----------|------|-------|
| Bone world transforms | O(B) | Linear hierarchy traversal |
| Vertex skinning | O(V * W_avg) | W_avg = avg weights per vertex (~2-4) |
| Mesh upload | O(V) | Write to `ATTRIBUTE_POSITION` |

Typical 2D character mesh: V=200, B=20, W_avg=3

Per-entity cost: ~200 * 3 = 600 multiply-add operations + 200 position writes.

### 6.2 WASM Performance Estimate

Based on terrain mesh generation benchmarks in this codebase (which process ~10K
vertices per frame on WASM without issue):

| Skinned Entities | Vertices Total | Estimated Frame Time |
|-----------------|----------------|---------------------|
| 10 | 2,000 | <0.5ms |
| 50 | 10,000 | ~1-2ms |
| 100 | 20,000 | ~3-4ms |
| 200 | 40,000 | ~6-8ms |

**Target of 50+ skinned sprites at 60fps is achievable** with significant headroom.

### 6.3 Optimization Opportunities (Future)

1. **Bone index precomputation** (included in this design) eliminates HashMap lookups
2. **SIMD via wasm-simd** for bulk vertex transforms (not in initial implementation)
3. **Dirty flags** to skip skinning when no bones changed (add `Changed<SkeletonData2d>` filter)
4. **LOD-based vertex skip** for distant sprites (future, integrate with Phase 31)
5. **Batch mesh updates** via Bevy's `Mesh::insert_attribute` bulk API

## 7. Testing Strategy

### 7.1 Unit Tests (Rust, `#[cfg(test)]`)

- `test_compute_bind_pose_inverses` -- verify inverse matches forward transform
- `test_lbs_identity` -- skinning with identity transforms returns bind pose
- `test_lbs_single_bone` -- single bone rotation moves vertices correctly
- `test_lbs_two_bone_blend` -- 50/50 weight blend between two bones
- `test_bone_index_resolution` -- string-to-index mapping correctness
- `test_skin_switching_reinit` -- switching skins triggers mesh recreation

### 7.2 Integration Tests (via JSON commands)

- Create entity with skeleton + mesh attachment, verify `Mesh2d` is created
- Play animation, verify mesh positions change between frames
- Switch skins, verify mesh updates to new attachment
- Delete skeleton, verify `Mesh2d` + `SkinnedMesh2d` are cleaned up

### 7.3 Visual Verification

- Simple 2-bone arm with a rectangular mesh: rotate shoulder, verify elbow bends
- Full character skeleton (10+ bones): walk cycle animation
- IK target drag in editor: mesh deforms to follow

## 8. Rollout Plan

### Phase 1: Core Skinning (this ticket)
- `SkinnedMesh2d` + `BoneWorldTransforms2d` components
- `init_skinned_meshes_2d` system
- Corrected LBS with bind-pose inverse
- Bone index precomputation
- Unit tests

### Phase 2: Texture Support
- Load textures for mesh attachments via existing `TextureHandleMap`
- Create `ColorMaterial` with texture
- UV mapping verification

### Phase 3: Multi-Attachment + Slot Ordering
- Support multiple mesh attachments per entity (one per slot)
- Z-ordering based on `SlotDef` order
- Sprite attachments (non-mesh) follow bone transforms

### Phase 4: Polish
- Blend mode rendering support
- Dirty-flag optimization
- Editor preview (skinning in edit mode when "preview" toggled)

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Mesh2d requires `bevy_sprite` feature | Build break | Already enabled in Cargo.toml |
| ColorMaterial not available in custom pipeline | Rendering fails | Use `bevy::sprite::ColorMaterial` which is standard |
| Bevy mesh mutation performance on WASM | Frame drops | Benchmark early; positions-only update is cheap |
| Skeleton bone order not guaranteed parents-first | Incorrect transforms | Add validation at skeleton creation time |
| Query param limit exceeded in bridge/mod.rs | Compile error | Merge related queries per existing convention |

## 10. Open Questions

1. **Should `SkinnedMesh2d` be serialized in scene files?** Recommendation: No.
   It is derived from `SkeletonData2d` and can be recomputed on load. This keeps
   `.forge` files smaller and avoids version-coupling.

2. **Should skinning run in edit mode?** Recommendation: Only when explicitly
   previewing an animation. In edit mode, show the bind pose with gizmo overlays.
   This avoids confusing deformed mesh with the authored shape.

3. **Should we support Dual Quaternion Skinning (DQS)?** Recommendation: Not in
   Phase 1. LBS is sufficient for 2D (candy-wrapper artifacts are less visible in
   2D than 3D). DQS can be added later if needed.
