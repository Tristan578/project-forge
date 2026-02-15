use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    entity_factory,
    pending_commands::{PendingCommands, QueryRequest},
    skeleton2d::{SkeletonData2d, SkeletonEnabled2d},
    skeletal_animation2d::{SkeletalAnimation2d, SkeletalAnimPlayer2d},
    history::UndoableAction,
};
use crate::bridge::{events, Selection, SelectionChangedEvent};

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
