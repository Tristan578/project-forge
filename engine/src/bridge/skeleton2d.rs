use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    entity_factory,
    pending_commands::{PendingCommands, QueryRequest},
    skeleton2d::{SkeletonData2d, SkeletonEnabled2d, Bone2dDef, IkConstraint2d},
    skeletal_animation2d::{SkeletalAnimation2d, SkeletalAnimPlayer2d, EasingType2d, BoneKeyframe},
    history::UndoableAction,
};
use crate::bridge::{events, Selection, SelectionChangedEvent};
use std::collections::HashMap;

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
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d, Option<&SkeletonEnabled2d>)>,
    mut history: ResMut<entity_factory::HistoryStack>,
) {
    let requests: Vec<_> = pending.add_bone2d_requests.drain(..).collect();
    for request in requests {
        if let Some((_, mut skeleton_data, enabled)) = skeleton_query.iter_mut().find(|(eid, _, _)| eid.0 == request.entity_id) {
            let old_skeleton = skeleton_data.clone();
            skeleton_data.bones.push(request.bone);

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
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d, Option<&SkeletonEnabled2d>)>,
    mut history: ResMut<entity_factory::HistoryStack>,
) {
    let requests: Vec<_> = pending.remove_bone2d_requests.drain(..).collect();
    for request in requests {
        if let Some((_, mut skeleton_data, enabled)) = skeleton_query.iter_mut().find(|(eid, _, _)| eid.0 == request.entity_id) {
            let old_skeleton = skeleton_data.clone();
            skeleton_data.bones.retain(|bone| bone.name != request.bone_name);

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
    mut skeleton_query: Query<(&EntityId, &mut SkeletonData2d)>,
) {
    let requests: Vec<_> = pending.set_skeleton2d_skin_requests.drain(..).collect();
    for request in requests {
        if let Some((_, mut skeleton_data)) = skeleton_query.iter_mut().find(|(eid, _)| eid.0 == request.entity_id) {
            skeleton_data.active_skin = request.skin_name.clone();
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
) {
    let requests: Vec<_> = pending.auto_weight_skeleton2d_requests.drain(..).collect();
    for _request in requests {
        // Placeholder for auto-weight algorithm
        // This would require complex mesh-to-skeleton weight calculations
    }
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

/// Render skeleton bones as gizmo lines in the editor (edit mode only).
#[cfg(not(feature = "runtime"))]
pub(super) fn render_skeleton_bones(
    query: Query<(&Transform, &SkeletonData2d, &SkeletonEnabled2d)>,
    mut gizmos: Gizmos,
) {
    for (transform, skeleton, _) in query.iter() {
        let entity_pos = transform.translation.truncate();
        let world_transforms = compute_bone_world_transforms(&skeleton.bones);

        for bone in &skeleton.bones {
            if let Some(&(bone_pos, bone_rot, _)) = world_transforms.get(&bone.name) {
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
    mut selection_events: EventReader<SelectionChangedEvent>,
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
