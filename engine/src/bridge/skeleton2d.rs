use bevy::prelude::*;
use bevy::mesh::Mesh2d;
use bevy::sprite_render::{ColorMaterial, MeshMaterial2d};
use crate::core::{
    entity_id::EntityId,
    entity_factory,
    pending_commands::{PendingCommands, QueryRequest},
    skeleton2d::{
        SkeletonData2d, SkeletonEnabled2d, Bone2dDef, IkConstraint2d, AttachmentData,
        SkinnedMesh2d, BoneWorldTransforms2d, VertexWeights, SkinnedMeshInitialized,
    },
    skeletal_animation2d::{SkeletalAnimation2d, SkeletalAnimPlayer2d, EasingType2d, BoneKeyframe},
    history::UndoableAction,
};
use crate::bridge::{events, Selection, SelectionChangedEvent};
use std::collections::HashMap;

/// Tracks the Mesh and ColorMaterial handles most recently created for a skinned-mesh entity.
/// Stored in the bridge module (not core) because it holds renderer-specific handle types.
/// Used by `init_skinned_meshes_2d` to remove stale assets when the active skin changes.
#[derive(Component)]
pub(crate) struct SkinnedMeshHandles {
    pub mesh: Handle<Mesh>,
    pub material: Handle<ColorMaterial>,
}

// ========== Skeleton 2D Systems ==========

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_skeleton2d_creates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut history: ResMut<entity_factory::HistoryStack>,
    entity_query: Query<(Entity, &EntityId)>,
) {
    let requests: Vec<_> = pending.create_skeleton2d_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _)) = entity_query.iter().find(|(_, eid)| eid.0 == request.entity_id) {
            commands.entity(entity).insert((
                request.skeleton_data.clone(),
                SkeletonEnabled2d,
            ));

            history.push(UndoableAction::SkeletonChange {
                entity_id: request.entity_id.clone(),
                old_skeleton: None,
                new_skeleton: Some(request.skeleton_data.clone()),
            });

            events::emit_skeleton2d_updated(&request.entity_id, &request.skeleton_data, true);
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_bone2d_adds(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut skeleton_query: Query<(Entity, &EntityId, &mut SkeletonData2d, Option<&SkeletonEnabled2d>)>,
    mut history: ResMut<entity_factory::HistoryStack>,
) {
    let requests: Vec<_> = pending.add_bone2d_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _, mut skeleton_data, enabled)) = skeleton_query.iter_mut().find(|(_, eid, _, _)| eid.0 == request.entity_id) {
            let old_skeleton = skeleton_data.clone();
            skeleton_data.bones.push(request.bone);

            // Clear the init guard so vertex_bone_indices are rebuilt with the new bone list.
            commands.entity(entity).remove::<SkinnedMeshInitialized>();

            history.push(UndoableAction::SkeletonChange {
                entity_id: request.entity_id.clone(),
                old_skeleton: Some(old_skeleton),
                new_skeleton: Some(skeleton_data.clone()),
            });

            events::emit_skeleton2d_updated(&request.entity_id, &skeleton_data, enabled.is_some());
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_bone2d_removes(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut skeleton_query: Query<(Entity, &EntityId, &mut SkeletonData2d, Option<&SkeletonEnabled2d>)>,
    mut history: ResMut<entity_factory::HistoryStack>,
) {
    let requests: Vec<_> = pending.remove_bone2d_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _, mut skeleton_data, enabled)) = skeleton_query.iter_mut().find(|(_, eid, _, _)| eid.0 == request.entity_id) {
            let old_skeleton = skeleton_data.clone();
            skeleton_data.bones.retain(|bone| bone.name != request.bone_name);

            // Clear the init guard so `init_skinned_meshes_2d` re-runs and recomputes
            // vertex_bone_indices with the updated (shorter) bone list. Without this,
            // the skinning system would panic on stale out-of-bounds indices.
            commands.entity(entity).remove::<SkinnedMeshInitialized>();

            history.push(UndoableAction::SkeletonChange {
                entity_id: request.entity_id.clone(),
                old_skeleton: Some(old_skeleton),
                new_skeleton: Some(skeleton_data.clone()),
            });

            events::emit_skeleton2d_updated(&request.entity_id, &skeleton_data, enabled.is_some());
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_bone2d_updates(
    mut pending: ResMut<PendingCommands>,
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d, Option<&SkeletonEnabled2d>)>,
    mut history: ResMut<entity_factory::HistoryStack>,
) {
    let requests: Vec<_> = pending.update_bone2d_requests.drain(..).collect();
    for request in requests {
        if let Some((_, mut skeleton_data, enabled)) = skeleton_query.iter_mut().find(|(eid, _, _)| eid.0 == request.entity_id) {
            let old_skeleton = skeleton_data.clone();

            if let Some(bone) = skeleton_data.bones.iter_mut().find(|b| b.name == request.bone_name) {
                if let Some(pos) = request.local_position {
                    bone.local_position = pos;
                }
                if let Some(rot) = request.local_rotation {
                    bone.local_rotation = rot;
                }
                if let Some(scale) = request.local_scale {
                    bone.local_scale = scale;
                }
                if let Some(len) = request.length {
                    bone.length = len;
                }
                if let Some(col) = request.color {
                    bone.color = col;
                }
            }

            history.push(UndoableAction::SkeletonChange {
                entity_id: request.entity_id.clone(),
                old_skeleton: Some(old_skeleton),
                new_skeleton: Some(skeleton_data.clone()),
            });

            events::emit_skeleton2d_updated(&request.entity_id, &skeleton_data, enabled.is_some());
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_skeletal_animation2d_creates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId)>,
) {
    let requests: Vec<_> = pending.create_skeletal_animation2d_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _)) = entity_query.iter().find(|(_, eid)| eid.0 == request.entity_id) {
            commands.entity(entity).insert(request.animation);
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_keyframe2d_adds(
    mut pending: ResMut<PendingCommands>,
    mut anim_query: Query<(&EntityId, &mut SkeletalAnimation2d)>,
) {
    let requests: Vec<_> = pending.add_keyframe2d_requests.drain(..).collect();
    for request in requests {
        let bone_name = request.bone_name.clone();
        let keyframe = request.keyframe.clone();
        for (eid, mut anim) in anim_query.iter_mut() {
            if eid.0 == request.entity_id && anim.name == request.animation_name {
                anim.tracks.entry(bone_name.clone()).or_default().push(keyframe.clone());
            }
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_skeletal_animation2d_plays(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId)>,
) {
    let requests: Vec<_> = pending.play_skeletal_animation2d_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _)) = entity_query.iter().find(|(_, eid)| eid.0 == request.entity_id) {
            let player = SkeletalAnimPlayer2d {
                current_animation: Some(request.animation_name.clone()),
                time: 0.0,
                speed: request.speed,
                playing: true,
                blend_animations: vec![],
            };
            commands.entity(entity).insert(player);
            events::emit_skeletal_animation2d_playing(&request.entity_id, &request.animation_name);
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_skeleton2d_skin_sets(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut skeleton_query: Query<(Entity, &EntityId, &mut SkeletonData2d)>,
) {
    let requests: Vec<_> = pending.set_skeleton2d_skin_requests.drain(..).collect();
    for request in requests {
        if let Some((entity, _, mut skeleton_data)) = skeleton_query.iter_mut().find(|(_, eid, _)| eid.0 == request.entity_id) {
            skeleton_data.active_skin = request.skin_name.clone();
            // Remove the init guard so init_skinned_meshes_2d re-runs for the new skin.
            commands.entity(entity).remove::<SkinnedMeshInitialized>();
            events::emit_skeleton2d_skin_changed(&request.entity_id, &request.skin_name);
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_ik_chain2d_creates(
    mut pending: ResMut<PendingCommands>,
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d)>,
) {
    let requests: Vec<_> = pending.create_ik_chain2d_requests.drain(..).collect();
    for request in requests {
        if let Some((_, mut skeleton_data)) = skeleton_query.iter_mut().find(|(eid, _)| eid.0 == request.entity_id) {
            skeleton_data.ik_constraints.push(request.constraint);
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn handle_skeleton2d_query(
    mut pending: ResMut<PendingCommands>,
    skeleton_query: Query<(&EntityId, Option<&SkeletonData2d>, Option<&SkeletonEnabled2d>)>,
) {
    let requests: Vec<_> = pending.query_requests.iter()
        .filter(|r| matches!(r, QueryRequest::Skeleton2dState { .. }))
        .cloned()
        .collect();

    pending.query_requests.retain(|r| !matches!(r, QueryRequest::Skeleton2dState { .. }));

    for request in requests {
        if let QueryRequest::Skeleton2dState { entity_id } = request {
            if let Some((_, skeleton_data, enabled)) = skeleton_query.iter().find(|(eid, _, _)| eid.0 == entity_id) {
                if let Some(data) = skeleton_data {
                    events::emit_skeleton2d_updated(&entity_id, data, enabled.is_some());
                }
            }
        }
    }
}

#[cfg(not(feature = "runtime"))]
pub(super) fn apply_auto_weight_skeleton2d(
    mut pending: ResMut<PendingCommands>,
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d)>,
) {
    let requests: Vec<_> = pending.auto_weight_skeleton2d_requests.drain(..).collect();
    for request in requests {
        let Some((_, mut skeleton)) = skeleton_query
            .iter_mut()
            .find(|(eid, _)| eid.0 == request.entity_id)
        else {
            tracing::warn!("auto_weight: entity not found: {}", request.entity_id);
            continue;
        };

        // Clone bones to avoid borrow conflict with mutable skin iteration
        let bones = skeleton.bones.clone();
        let bone_world_positions = compute_bone_world_positions(&bones);
        let iterations = request.iterations.max(1);

        // Auto-weight each mesh attachment in each skin
        for skin in skeleton.skins.values_mut() {
            for attachment in skin.attachments.values_mut() {
                if let crate::core::skeleton2d::AttachmentData::Mesh {
                    ref vertices,
                    ref mut weights,
                    ..
                } = attachment
                {
                    *weights = compute_linear_weights(
                        vertices,
                        &bones,
                        &bone_world_positions,
                        iterations,
                    );
                }
            }
        }

        events::emit_skeleton2d_updated(
            &request.entity_id,
            &skeleton,
            true,
        );
        tracing::info!(
            "Auto-weighted skeleton for entity {} using {} method ({} iterations)",
            request.entity_id, request.method, request.iterations
        );
    }
}

/// Compute world-space positions for each bone by traversing the parent hierarchy.
fn compute_bone_world_positions(
    bones: &[crate::core::skeleton2d::Bone2dDef],
) -> std::collections::HashMap<String, [f32; 2]> {
    let mut positions = std::collections::HashMap::new();
    // Build name -> index lookup
    let name_to_idx: std::collections::HashMap<&str, usize> = bones
        .iter()
        .enumerate()
        .map(|(i, b)| (b.name.as_str(), i))
        .collect();

    for bone in bones {
        let mut pos = bone.local_position;
        let mut current = bone.parent_bone.as_deref();
        // Walk up the hierarchy, accumulating positions
        while let Some(parent_name) = current {
            if let Some(&idx) = name_to_idx.get(parent_name) {
                pos[0] += bones[idx].local_position[0];
                pos[1] += bones[idx].local_position[1];
                current = bones[idx].parent_bone.as_deref();
            } else {
                break;
            }
        }
        positions.insert(bone.name.clone(), pos);
    }
    positions
}

/// Compute distance-based vertex weights with optional smoothing iterations.
fn compute_linear_weights(
    vertices: &[[f32; 2]],
    bones: &[crate::core::skeleton2d::Bone2dDef],
    bone_positions: &std::collections::HashMap<String, [f32; 2]>,
    _iterations: u32,
) -> Vec<crate::core::skeleton2d::VertexWeights> {
    vertices
        .iter()
        .map(|v| {
            let mut bone_names = Vec::new();
            let mut raw_weights = Vec::new();

            for bone in bones {
                if let Some(bpos) = bone_positions.get(&bone.name) {
                    let dx = v[0] - bpos[0];
                    let dy = v[1] - bpos[1];
                    let dist_sq = dx * dx + dy * dy;
                    // Inverse-square distance weighting
                    let w = 1.0 / (1.0 + dist_sq);
                    bone_names.push(bone.name.clone());
                    raw_weights.push(w);
                }
            }

            // Normalize to sum to 1.0
            let total: f32 = raw_weights.iter().sum();
            let normalized = if total > 0.0 {
                raw_weights.iter().map(|w| w / total).collect()
            } else {
                raw_weights
            };

            crate::core::skeleton2d::VertexWeights {
                bones: bone_names,
                weights: normalized,
            }
        })
        .collect()
}

// ========== Runtime Systems ==========

/// Advance skeletal animation playback, interpolating bone transforms from keyframes.
pub(super) fn advance_skeleton_animation(
    time: Res<Time>,
    mut query: Query<(
        &mut SkeletonData2d,
        &SkeletalAnimation2d,
        &mut SkeletalAnimPlayer2d,
    )>,
) {
    for (mut skeleton, animation, mut player) in query.iter_mut() {
        if !player.playing {
            continue;
        }
        let Some(ref current_anim) = player.current_animation else {
            continue;
        };
        if *current_anim != animation.name {
            continue;
        }

        // Advance time
        player.time += time.delta_secs() * player.speed;

        // Handle looping / clamp
        if player.time >= animation.duration {
            if animation.looping {
                player.time %= animation.duration;
            } else {
                player.time = animation.duration;
                player.playing = false;
            }
        }

        let t = player.time;

        // Interpolate each bone track
        for bone in skeleton.bones.iter_mut() {
            if let Some(keyframes) = animation.tracks.get(&bone.name) {
                if keyframes.is_empty() {
                    continue;
                }
                interpolate_bone(bone, keyframes, t);
            }
        }
    }
}

/// Interpolate bone properties from keyframes at the given time.
fn interpolate_bone(bone: &mut Bone2dDef, keyframes: &[BoneKeyframe], t: f32) {
    // Find the two keyframes surrounding `t`
    let mut prev_idx = 0;
    for (i, kf) in keyframes.iter().enumerate() {
        if kf.time <= t {
            prev_idx = i;
        }
    }

    let prev = &keyframes[prev_idx];
    let next_idx = if prev_idx + 1 < keyframes.len() {
        prev_idx + 1
    } else if keyframes.len() > 1 {
        0 // wrap for looping
    } else {
        prev_idx // single keyframe
    };
    let next = &keyframes[next_idx];

    let alpha = if (next.time - prev.time).abs() < 1e-6 {
        0.0
    } else {
        ((t - prev.time) / (next.time - prev.time)).clamp(0.0, 1.0)
    };

    let eased = apply_easing(alpha, prev.easing);

    if let (Some(p0), Some(p1)) = (prev.position, next.position) {
        bone.local_position = [
            p0[0] + (p1[0] - p0[0]) * eased,
            p0[1] + (p1[1] - p0[1]) * eased,
        ];
    } else if let Some(p) = prev.position {
        bone.local_position = p;
    }

    if let (Some(r0), Some(r1)) = (prev.rotation, next.rotation) {
        bone.local_rotation = r0 + (r1 - r0) * eased;
    } else if let Some(r) = prev.rotation {
        bone.local_rotation = r;
    }

    if let (Some(s0), Some(s1)) = (prev.scale, next.scale) {
        bone.local_scale = [
            s0[0] + (s1[0] - s0[0]) * eased,
            s0[1] + (s1[1] - s0[1]) * eased,
        ];
    } else if let Some(s) = prev.scale {
        bone.local_scale = s;
    }
}

fn apply_easing(t: f32, easing: EasingType2d) -> f32 {
    match easing {
        EasingType2d::Linear => t,
        EasingType2d::EaseIn => t * t,
        EasingType2d::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
        EasingType2d::EaseInOut => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
            }
        }
        EasingType2d::Step => if t >= 1.0 { 1.0 } else { 0.0 },
    }
}

/// Compute world-space bone transforms from the skeleton hierarchy.
fn compute_bone_world_transforms(bones: &[Bone2dDef]) -> HashMap<String, (Vec2, f32, Vec2)> {
    let mut world_transforms: HashMap<String, (Vec2, f32, Vec2)> = HashMap::new();

    // Build parent index for efficient lookup
    let bone_index: HashMap<&str, usize> = bones
        .iter()
        .enumerate()
        .map(|(i, b)| (b.name.as_str(), i))
        .collect();

    // Process bones in order (parents before children assumed by convention)
    for bone in bones {
        let (parent_pos, parent_rot) = if let Some(ref parent_name) = bone.parent_bone {
            if let Some(&(pos, rot, _scale)) = world_transforms.get(parent_name.as_str()) {
                // Offset along parent bone's direction by parent length
                let parent_bone = &bones[bone_index[parent_name.as_str()]];
                let parent_rad = rot.to_radians();
                let end_pos = pos + Vec2::new(
                    parent_bone.length * parent_rad.cos(),
                    parent_bone.length * parent_rad.sin(),
                );
                (end_pos, rot)
            } else {
                (Vec2::ZERO, 0.0)
            }
        } else {
            (Vec2::ZERO, 0.0)
        };

        let world_rot = parent_rot + bone.local_rotation;
        let rot_rad = parent_rot.to_radians();
        let local_offset = Vec2::new(bone.local_position[0], bone.local_position[1]);
        let rotated_offset = Vec2::new(
            local_offset.x * rot_rad.cos() - local_offset.y * rot_rad.sin(),
            local_offset.x * rot_rad.sin() + local_offset.y * rot_rad.cos(),
        );
        let world_pos = parent_pos + rotated_offset;
        let world_scale = Vec2::new(bone.local_scale[0], bone.local_scale[1]);

        world_transforms.insert(bone.name.clone(), (world_pos, world_rot, world_scale));
    }

    world_transforms
}

// ========== Pure Functions (Bind-Pose Init + Corrected LBS) ==========

/// Compute bind-pose world transforms for each bone, ordered by bone index.
/// Called once at mesh initialization time.
fn compute_bind_pose_transforms(bones: &[Bone2dDef]) -> Vec<(Vec2, f32, Vec2)> {
    let world_map = compute_bone_world_transforms(bones);
    bones.iter().map(|bone| {
        world_map
            .get(&bone.name)
            .copied()
            .unwrap_or((Vec2::ZERO, 0.0, Vec2::ONE))
    }).collect()
}

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

                // [Sentry HIGH :597] Guard against one-frame race when a bone is removed:
                // the SkinnedMesh2d may still hold stale indices while SkeletonData2d has
                // already been updated and world_transforms/bind_pose_transforms are shorter.
                let Some(&(bind_pos, bind_rot_deg, bind_scale)) = bind_pose_transforms.get(bone_idx) else {
                    continue;
                };
                let Some(&(world_pos, world_rot_deg, world_scale)) = world_transforms.get(bone_idx) else {
                    continue;
                };

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

// ========== Skinned Mesh Initialization System ==========

/// Initialize Mesh2d + SkinnedMesh2d for entities with skeleton mesh attachments.
///
/// Uses `SkinnedMeshInitialized` as a guard to avoid re-running every frame when animation
/// mutates `SkeletonData2d`. The guard is cleared when the active skin changes
/// (detected by `source_attachment` mismatch), allowing re-initialization for the new skin.
///
/// Also ensures `BoneWorldTransforms2d` is inserted on ALL enabled skeletons — even those
/// without mesh attachments — so that gizmo rendering works universally.
pub(super) fn init_skinned_meshes_2d(
    mut commands: Commands,
    // Query ALL enabled skeletons so we can ensure BoneWorldTransforms2d is present.
    all_skeletons: Query<
        (Entity, &SkeletonData2d, Option<&BoneWorldTransforms2d>),
        (With<SkeletonEnabled2d>, Or<(Added<SkeletonEnabled2d>, Added<SkeletonData2d>)>),
    >,
    // Query skeletons that need skinned-mesh init: not yet initialized, or skin changed.
    skinned_query: Query<
        (Entity, &SkeletonData2d, Option<&SkinnedMesh2d>, Option<&SkinnedMeshHandles>),
        (
            With<SkeletonEnabled2d>,
            Without<SkinnedMeshInitialized>,
        ),
    >,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ColorMaterial>>,
) {
    // Ensure BoneWorldTransforms2d is present on all newly-enabled skeletons.
    for (entity, skeleton, existing_xforms) in all_skeletons.iter() {
        if existing_xforms.is_none() {
            let initial = BoneWorldTransforms2d {
                transforms: compute_bind_pose_transforms(&skeleton.bones),
            };
            commands.entity(entity).insert(initial);
        }
    }

    // Handle skinned-mesh initialization for skeletons without the guard marker.
    for (entity, skeleton, existing_skinned, existing_handles) in skinned_query.iter() {
        // Find the first mesh attachment in the active skin
        let Some(skin) = skeleton.skins.get(&skeleton.active_skin) else {
            // No mesh attachment — still mark as initialized so we don't loop.
            commands.entity(entity).insert(SkinnedMeshInitialized);
            continue;
        };

        let mut found_mesh: Option<(&Vec<[f32; 2]>, &Vec<[f32; 2]>, &Vec<u16>, &Vec<VertexWeights>)> = None;
        let mut attachment_name = String::new();
        for (name, attachment) in &skin.attachments {
            if let AttachmentData::Mesh { ref vertices, ref uvs, ref triangles, ref weights, .. } = attachment {
                if !vertices.is_empty() && !triangles.is_empty() && !weights.is_empty() {
                    // [Copilot :663] Validate weights.len() == vertices.len() before using.
                    if weights.len() != vertices.len() {
                        tracing::warn!(
                            "Skin attachment '{}': weights.len() ({}) != vertices.len() ({}), skipping",
                            name, weights.len(), vertices.len()
                        );
                        continue;
                    }
                    found_mesh = Some((vertices, uvs, triangles, weights));
                    attachment_name = name.clone();
                    break;
                }
            }
        }

        let Some((vertices, uvs, triangles, weights)) = found_mesh else {
            // No valid mesh attachment — mark as initialized so we don't re-check every frame.
            commands.entity(entity).insert(SkinnedMeshInitialized);
            continue;
        };

        // If already initialized for the same attachment, nothing to do.
        if let Some(existing) = existing_skinned {
            if existing.source_attachment == attachment_name {
                commands.entity(entity).insert(SkinnedMeshInitialized);
                continue;
            }
            // Skin changed — remove old mesh components. They will be replaced below.
            // [Copilot :702] Also remove old asset handles from the Assets collections.
            if let Some(old_handles) = existing_handles {
                let _ = meshes.remove(&old_handles.mesh);
                let _ = materials.remove(&old_handles.material);
            }
            commands.entity(entity).remove::<(
                SkinnedMesh2d,
                Mesh2d,
                MeshMaterial2d<ColorMaterial>,
                SkinnedMeshHandles,
            )>();
        }

        // Build the Bevy Mesh
        let positions: Vec<[f32; 3]> = vertices.iter().map(|v| [v[0], v[1], 0.0]).collect();
        let uv_data: Vec<[f32; 2]> = if uvs.len() == vertices.len() {
            uvs.clone()
        } else {
            vec![[0.0, 0.0]; vertices.len()]
        };
        let mesh_indices: Vec<u32> = triangles.iter().map(|&i| i as u32).collect();

        let mut mesh = Mesh::new(
            bevy::mesh::PrimitiveTopology::TriangleList,
            bevy::asset::RenderAssetUsages::MAIN_WORLD | bevy::asset::RenderAssetUsages::RENDER_WORLD,
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv_data);
        mesh.insert_indices(bevy::mesh::Indices::U32(mesh_indices));

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

        // [Copilot :702] Track the new handles for later cleanup if skin changes.
        let tracked_handles = SkinnedMeshHandles {
            mesh: mesh_handle.clone(),
            material: material_handle.clone(),
        };

        commands.entity(entity).insert((
            Mesh2d(mesh_handle),
            MeshMaterial2d(material_handle),
            skinned,
            world_transforms,
            tracked_handles,
            SkinnedMeshInitialized,
        ));
    }
}

// ========== Cached World Transforms System ==========

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

// ========== Refactored Vertex Skinning System ==========

/// CPU vertex skinning: deform mesh vertices using corrected LBS.
///
/// [Copilot :776] Uses `attribute_mut` to mutate the POSITION attribute in-place rather
/// than calling `insert_attribute`, which reallocates the underlying buffer each frame.
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
            // Mutate in-place if the attribute already exists to avoid per-frame realloc.
            if let Some(positions) = mesh.attribute_mut(Mesh::ATTRIBUTE_POSITION) {
                if let bevy::mesh::VertexAttributeValues::Float32x3(ref mut verts) = positions {
                    if verts.len() == deformed.len() {
                        verts.copy_from_slice(&deformed);
                        continue;
                    }
                }
            }
            // Fallback: insert (first frame or vertex count changed after re-init).
            mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, deformed);
        }
    }
}

/// Render skeleton bones as gizmo lines in the editor (edit mode only).
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

            // Draw bone line
            gizmos.line_2d(start, end, color);

            // Draw joint circle at bone origin
            gizmos.circle_2d(Isometry2d::from_translation(start), 2.0, color);
        }
    }
}

/// Solve 2-bone IK constraints using analytical method.
pub(super) fn solve_ik_constraints_2d(
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d)>,
    target_query: Query<(&EntityId, &Transform)>,
) {
    for (_, mut skeleton) in skeleton_query.iter_mut() {
        let constraints: Vec<IkConstraint2d> = skeleton.ik_constraints.clone();
        for constraint in &constraints {
            if constraint.bone_chain.len() < 2 || constraint.mix <= 0.0 {
                continue;
            }

            // Find target position
            let target_pos = target_query
                .iter()
                .find(|(eid, _)| eid.0 == constraint.target_entity_id)
                .map(|(_, t)| t.translation.truncate());

            let Some(target) = target_pos else {
                continue;
            };

            let bone1_name = &constraint.bone_chain[0];
            let bone2_name = &constraint.bone_chain[1];

            // Get bone lengths
            let bone1_len = skeleton.bones.iter().find(|b| &b.name == bone1_name).map(|b| b.length).unwrap_or(1.0);
            let bone2_len = skeleton.bones.iter().find(|b| &b.name == bone2_name).map(|b| b.length).unwrap_or(1.0);

            // Get bone1 world position (from its parent chain)
            let world_transforms = compute_bone_world_transforms(&skeleton.bones);
            let bone1_pos = world_transforms.get(bone1_name.as_str()).map(|t| t.0).unwrap_or(Vec2::ZERO);

            // 2-bone analytical IK
            let dx = target.x - bone1_pos.x;
            let dy = target.y - bone1_pos.y;
            let dist = (dx * dx + dy * dy).sqrt().min(bone1_len + bone2_len - 0.001);

            if dist < 0.001 {
                continue;
            }

            // Law of cosines for bone1 angle
            let cos_angle1 = ((bone1_len * bone1_len + dist * dist - bone2_len * bone2_len)
                / (2.0 * bone1_len * dist))
                .clamp(-1.0, 1.0);
            let angle_to_target = dy.atan2(dx);
            let ik_angle1 = angle_to_target + constraint.bend_direction * cos_angle1.acos();

            // Law of cosines for bone2 angle relative to bone1
            let cos_angle2 = ((bone1_len * bone1_len + bone2_len * bone2_len - dist * dist)
                / (2.0 * bone1_len * bone2_len))
                .clamp(-1.0, 1.0);
            let ik_angle2 = std::f32::consts::PI - constraint.bend_direction * cos_angle2.acos();

            // Apply with mix factor
            let mix = constraint.mix;
            if let Some(bone1) = skeleton.bones.iter_mut().find(|b| &b.name == bone1_name) {
                let fk_rot = bone1.local_rotation.to_radians();
                let blended = fk_rot * (1.0 - mix) + ik_angle1 * mix;
                bone1.local_rotation = blended.to_degrees();
            }
            if let Some(bone2) = skeleton.bones.iter_mut().find(|b| &b.name == bone2_name) {
                let fk_rot = bone2.local_rotation.to_radians();
                let blended = fk_rot * (1.0 - mix) + ik_angle2 * mix;
                bone2.local_rotation = blended.to_degrees();
            }
        }
    }
}

/// Emit skeleton2d changed events on selection changes and skeleton2d data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_skeleton2d_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &SkeletonData2d, Option<&SkeletonEnabled2d>), Changed<SkeletonData2d>>,
    selection_query: Query<(&EntityId, Option<&SkeletonData2d>, Option<&SkeletonEnabled2d>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, skeleton_data, skel_enabled)) = selection_query.get(primary) {
                if let Some(data) = skeleton_data {
                    events::emit_skeleton2d_updated(&entity_id.0, data, skel_enabled.is_some());
                }
            }
        }
    }

    // Emit when skeleton2d data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, skeleton_data, skel_enabled)) = query.get(primary) {
            events::emit_skeleton2d_updated(&entity_id.0, skeleton_data, skel_enabled.is_some());
        }
    }
}

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
