use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    history::{HistoryStack, UndoableAction},
    pending_commands::{PendingCommands, QueryRequest},
    game_camera::{GameCameraData, ActiveGameCamera, FirstPersonState, OrbitalState, GameCameraMode},
    game_components::{GameComponents, build_game_component},
};
use crate::bridge::{events, log, Selection, SelectionChangedEvent};

// ---- Game Component Apply Systems ----

pub(super) fn apply_game_component_adds(
    mut pending: ResMut<PendingCommands>,
    mut entity_query: Query<(Entity, &EntityId, Option<&mut GameComponents>)>,
    mut commands: Commands,
    mut history: ResMut<HistoryStack>,
) {
    let requests: Vec<_> = pending.game_component_adds.drain(..).collect();
    for request in requests {
        let Some((entity, _eid, existing)) = entity_query.iter_mut().find(|(_, eid, _)| eid.0 == request.entity_id) else {
            continue;
        };

        let component_data = match build_game_component(&request.component_type, &request.properties_json) {
            Ok(data) => data,
            Err(e) => {
                log(&format!("Failed to build game component: {}", e));
                continue;
            }
        };

        let old_components = existing.as_ref().map(|gc| gc.as_ref().clone());

        if let Some(mut gc) = existing {
            gc.add(component_data);
            let new_components = Some(gc.clone());
            events::emit_game_component_changed(&request.entity_id, &gc.components);
            history.push(UndoableAction::GameComponentChange {
                entity_id: request.entity_id,
                old_components,
                new_components,
            });
        } else {
            let mut gc = GameComponents::default();
            gc.add(component_data);
            let new_components = Some(gc.clone());
            events::emit_game_component_changed(&request.entity_id, &gc.components);
            commands.entity(entity).insert(gc);
            history.push(UndoableAction::GameComponentChange {
                entity_id: request.entity_id,
                old_components: None,
                new_components,
            });
        }
    }
}

pub(super) fn apply_game_component_updates(
    mut pending: ResMut<PendingCommands>,
    mut entity_query: Query<(&EntityId, &mut GameComponents)>,
    mut history: ResMut<HistoryStack>,
) {
    let requests: Vec<_> = pending.game_component_updates.drain(..).collect();
    for request in requests {
        let Some((_eid, mut gc)) = entity_query.iter_mut().find(|(eid, _)| eid.0 == request.entity_id) else {
            continue;
        };

        let component_data = match build_game_component(&request.component_type, &request.properties_json) {
            Ok(data) => data,
            Err(e) => {
                log(&format!("Failed to build game component: {}", e));
                continue;
            }
        };

        let old_components = Some(gc.clone());
        gc.add(component_data); // add replaces existing of same type
        let new_components = Some(gc.clone());

        events::emit_game_component_changed(&request.entity_id, &gc.components);
        history.push(UndoableAction::GameComponentChange {
            entity_id: request.entity_id,
            old_components,
            new_components,
        });
    }
}

pub(super) fn apply_game_component_removals(
    mut pending: ResMut<PendingCommands>,
    mut entity_query: Query<(&EntityId, &mut GameComponents)>,
    mut history: ResMut<HistoryStack>,
) {
    let requests: Vec<_> = pending.game_component_removals.drain(..).collect();
    for request in requests {
        let Some((_eid, mut gc)) = entity_query.iter_mut().find(|(eid, _)| eid.0 == request.entity_id) else {
            continue;
        };

        let old_components = Some(gc.clone());
        gc.remove(&request.component_name);
        let new_components = Some(gc.clone());

        events::emit_game_component_changed(&request.entity_id, &gc.components);
        history.push(UndoableAction::GameComponentChange {
            entity_id: request.entity_id,
            old_components,
            new_components,
        });
    }
}

pub(super) fn process_game_component_queries(
    mut pending: ResMut<PendingCommands>,
    gc_query: Query<(&EntityId, Option<&GameComponents>)>,
) {
    let requests: Vec<_> = pending.query_requests.iter()
        .filter(|r| matches!(r, QueryRequest::GameComponentState { .. }))
        .cloned()
        .collect();

    // Remove processed requests
    pending.query_requests.retain(|r| !matches!(r, QueryRequest::GameComponentState { .. }));

    for request in requests {
        if let QueryRequest::GameComponentState { entity_id } = request {
            let components = gc_query.iter()
                .find(|(eid, _)| eid.0 == entity_id)
                .and_then(|(_, gc)| gc.map(|gc| &gc.components))
                .cloned()
                .unwrap_or_default();

            let data = serde_json::json!({
                "entityId": entity_id,
                "components": components,
            });
            events::emit_event("QUERY_GAME_COMPONENTS", &data);
        }
    }
}

// ---- Game Camera Apply Systems ----

pub(super) fn apply_set_game_camera_requests(
    mut pending: ResMut<PendingCommands>,
    mut entity_query: Query<(Entity, &EntityId, Option<&GameCameraData>)>,
    mut commands: Commands,
) {
    let requests: Vec<_> = pending.set_game_camera_requests.drain(..).collect();
    for request in requests {
        let Some((entity, _eid, _existing)) = entity_query.iter_mut().find(|(_, eid, _)| eid.0 == request.entity_id) else {
            continue;
        };

        let camera_data = GameCameraData {
            mode: request.mode.clone(),
            target_entity: request.target_entity.clone(),
            ..Default::default()
        };

        commands.entity(entity).insert(camera_data);

        // Insert state components if needed
        match &request.mode {
            GameCameraMode::FirstPerson { .. } => {
                commands.entity(entity).insert(FirstPersonState::default());
            }
            GameCameraMode::Orbital { .. } => {
                commands.entity(entity).insert(OrbitalState::default());
            }
            _ => {}
        }

        events::emit_game_camera_changed(&request.entity_id, &request.mode, &request.target_entity);
    }
}

pub(super) fn apply_set_active_game_camera_requests(
    mut pending: ResMut<PendingCommands>,
    entity_query: Query<(Entity, &EntityId)>,
    active_query: Query<Entity, With<ActiveGameCamera>>,
    mut commands: Commands,
) {
    let requests: Vec<_> = pending.set_active_game_camera_requests.drain(..).collect();
    for request in requests {
        // Remove ActiveGameCamera from all current holders
        for entity in active_query.iter() {
            commands.entity(entity).remove::<ActiveGameCamera>();
        }

        // Add to the new entity
        if let Some((entity, _)) = entity_query.iter().find(|(_, eid)| eid.0 == request.entity_id) {
            commands.entity(entity).insert(ActiveGameCamera);
            events::emit_active_game_camera_changed(&request.entity_id);
        }
    }
}

pub(super) fn apply_camera_shake_requests(
    mut pending: ResMut<PendingCommands>,
    mut camera_query: Query<&mut GameCameraData, With<ActiveGameCamera>>,
) {
    let requests: Vec<_> = pending.camera_shake_requests.drain(..).collect();
    for request in requests {
        if let Ok(mut camera_data) = camera_query.single_mut() {
            camera_data.shake_intensity = request.intensity;
            camera_data.shake_duration = request.duration;
            camera_data.shake_timer = request.duration;
        }
    }
}

pub(super) fn process_game_camera_queries(
    mut pending: ResMut<PendingCommands>,
    camera_query: Query<(&EntityId, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
) {
    let requests: Vec<_> = pending.query_requests.iter()
        .filter(|r| matches!(r, QueryRequest::GameCameraState { .. }))
        .cloned()
        .collect();

    pending.query_requests.retain(|r| !matches!(r, QueryRequest::GameCameraState { .. }));

    for request in requests {
        if let QueryRequest::GameCameraState { entity_id } = request {
            if let Some((_, cam_data, active)) = camera_query.iter().find(|(eid, _, _)| eid.0 == entity_id) {
                let data = serde_json::json!({
                    "entityId": entity_id,
                    "gameCameraData": cam_data,
                    "isActive": active.is_some(),
                });
                events::emit_event("QUERY_GAME_CAMERA", &data);
            }
        }
    }
}

/// Emit game camera data when selection changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_game_camera_on_selection(
    selection: Res<Selection>,
    camera_query: Query<(&EntityId, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((eid, cam_data, active)) = camera_query.get(primary) {
                if let Some(data) = cam_data {
                    events::emit_game_camera_changed(&eid.0, &data.mode, &data.target_entity);
                }
                if active.is_some() {
                    events::emit_active_game_camera_changed(&eid.0);
                }
            }
        }
    }
}
