//! Game component bridge — applies game components, camera configs, and camera shake to ECS.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    history::{HistoryStack, UndoableAction},
    pending_commands::{PendingCommands, QueryRequest},
    game_camera::{GameCameraData, ActiveGameCamera, FirstPersonState, OrbitalState, GameCameraMode},
    game_components::{GameComponentRuntime, GameComponents, build_game_component},
};
use crate::bridge::{events, log, Selection, SelectionChangedEvent};
use crate::core::character_controller::{
    CharacterControllerDiagnostics, CharacterMotionState, DiagnosticsMirror, GroundedMirror,
};
use std::collections::HashMap;

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

/// What `set_game_camera` needs to read off a candidate entity: its id, whatever camera
/// configuration it already carries (for the runtime state that is not authored), and whether the
/// per-mode look state exists yet.
type GameCameraRow = (
    Entity,
    &'static EntityId,
    Option<&'static mut GameCameraData>,
    Has<FirstPersonState>,
    Has<OrbitalState>,
);

pub(super) fn apply_set_game_camera_requests(
    mut pending: ResMut<PendingCommands>,
    mut entity_query: Query<GameCameraRow>,
    mut commands: Commands,
) {
    let requests: Vec<_> = pending.set_game_camera_requests.drain(..).collect();
    for request in requests {
        let Some((entity, _eid, existing, has_first_person, has_orbital)) =
            entity_query.iter_mut().find(|(_, eid, _, _, _)| eid.0 == request.entity_id)
        else {
            continue;
        };

        // Runtime shake state is carried across rather than reset — see
        // `GameCameraData::configured`.
        //
        // Written THROUGH the query when the component is already present rather
        // than re-inserted via `Commands`: a deferred insert is applied at the
        // schedule's next sync point, which is after `apply_camera_shake_requests`
        // has mutated the live component, so a `camera_shake` issued in the same
        // frame as a `set_game_camera` was overwritten by this system's older
        // snapshot. Nothing orders the two systems (they merely serialize on
        // `PendingCommands`), so that was a silent loss in whichever order the
        // scheduler picked. Now both mutate the same component immediately and
        // neither can discard the other's write.
        match existing {
            Some(mut data) => {
                let merged = GameCameraData::configured(
                    Some(&data),
                    request.mode.clone(),
                    request.target_entity.clone(),
                );
                *data = merged;
            }
            None => {
                commands.entity(entity).insert(GameCameraData::configured(
                    None,
                    request.mode.clone(),
                    request.target_entity.clone(),
                ));
            }
        }

        // Insert state components if needed.
        //
        // Only when they are ABSENT: both accumulate where the player is
        // looking, so re-inserting the default snaps the view back to its
        // starting angle. A camera reconfigured mid-play — or stepped frame by
        // frame through a cutscene keyframe — would otherwise have its look
        // direction reset on every dispatch.
        match &request.mode {
            GameCameraMode::FirstPerson { .. } if !has_first_person => {
                commands.entity(entity).insert(FirstPersonState::default());
            }
            GameCameraMode::Orbital { .. } if !has_orbital => {
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
                // Answer in the same flat wire form `set_game_camera` accepts. Serializing
                // `GameCameraData` directly emits the externally-tagged `{"ThirdPersonFollow": {...}}`
                // mode object plus snake_case `target_entity`, neither of which any JS consumer reads.
                let mut game_camera_data = serde_json::json!({});
                if let Some(cam) = cam_data {
                    game_camera_data = cam.mode.to_flat();
                    if let Some(obj) = game_camera_data.as_object_mut() {
                        obj.insert(
                            "targetEntity".to_string(),
                            serde_json::to_value(&cam.target_entity).unwrap_or(serde_json::Value::Null),
                        );
                    }
                }
                let data = serde_json::json!({
                    "entityId": entity_id,
                    "gameCameraData": if cam_data.is_some() { game_camera_data } else { serde_json::Value::Null },
                    "isActive": active.is_some(),
                });
                events::emit_event("QUERY_GAME_CAMERA", &data);
            }
        }
    }
}

/// Drain per-frame game events (`game_win`, `collectible_collected`, `entity_death`,
/// `dialogue_trigger`, …) accumulated by the core game-component systems and emit each
/// to JS as a `GAME_EVENT`.
///
/// `GameComponentRuntime` only exists while a game is playing (inserted on Edit→Play,
/// removed on Play→Edit), so its presence IS the play gate — no `EngineMode` read is
/// needed, matching the other game-component systems.
///
/// Without this drain the runtime's `pending_events` Vec is never consumed: the win
/// event never reaches scripts/UI AND the Vec grows unbounded for the whole play
/// session. Not gated by the `runtime` feature — exported games need win events too.
pub(super) fn emit_game_events_system(
    runtime: Option<ResMut<GameComponentRuntime>>,
) {
    let Some(mut runtime) = runtime else {
        return;
    };
    // `take_pending_events` empties the queue (native-tested in core); an empty
    // queue is a cheap no-op here. GameEvent serializes camelCase:
    // { eventName, sourceEntityId, targetEntityId }.
    for event in runtime.take_pending_events() {
        events::emit_event("GAME_EVENT", &event);
    }
}


/// Mirror each character's ground contact to JS.
///
/// Rapier decides ground contact inside its character sweep and nothing on the
/// JS side can see it: the play-tick wire carries transforms, not contact
/// state. Without this a script cannot tell a jump from a fall, so
/// `forge.physics.isGrounded()` had no 3D answer at all (PF-1214).
///
/// Reads [`CharacterMotionState`], NOT Rapier's raw
/// `KinematicCharacterControllerOutput`, and the distinction is behavioural.
/// Rapier writes its output in `PostUpdate`, so on the Update frame that
/// consumes a jump the raw output still carries the PREVIOUS frame's
/// `grounded == true` — a script polling `isGrounded()` right after takeoff
/// would be told the character is still standing on the floor.
/// `step_character` clears the flag on a successful jump, so the motion state
/// is the jump-corrected value and the one a script should see. It is also the
/// exact value the jump gating itself used, so script and engine cannot
/// disagree about whether a character was airborne.
///
/// Ordered after `system_character_controller`, which owns that write: without
/// an explicit edge the two systems conflict on `CharacterMotionState` and the
/// resolution — this frame's value or last frame's — is unspecified.
///
/// Only CHANGES go out — one event per character per frame for a whole play
/// session is not a wire, it is a leak.
///
/// The whole state machine — the previous-frame map, the diff, and the reset
/// that makes a stopped-then-restarted game re-emit rather than silently agree
/// with a stale mirror — lives in [`GroundedMirror`] in `core/`, where it is
/// natively testable. The bridge is a thin wrapper around it: it collects the
/// query into a map, hands it over, and emits whatever comes back. Presence of
/// the runtime IS the play gate, matching every other game-component system.
///
/// Not gated by the `runtime` feature: an exported game runs the same scripts.
pub(super) fn emit_character_grounded_system(
    runtime: Option<Res<GameComponentRuntime>>,
    characters: Query<(&EntityId, &CharacterMotionState)>,
    mut mirror: Local<GroundedMirror>,
) {
    let current: HashMap<String, bool> = characters
        .iter()
        .map(|(eid, state)| (eid.0.clone(), state.grounded))
        .collect();

    for (entity_id, grounded) in mirror.observe(runtime.is_some(), current) {
        events::emit_character_grounded(&entity_id, grounded);
    }
}

/// Warn the creator about characters the controller had to skip.
///
/// `manage_character_controller_lifecycle` cannot attach a kinematic controller
/// to a character with no collider, so it records those entities instead of
/// dropping them silently. Before this the list was written and read by
/// nothing: the creator pressed Play, the player did not move, and the engine
/// knew exactly why but never said so (PF-1214, finding #2).
///
/// Emitted on CHANGE only, including the change to an empty list — that is how
/// the UI learns a previously-skipped character has been fixed and the warning
/// can be dismissed. [`DiagnosticsMirror`] owns that state machine in `core/`
/// so it can be tested natively; leaving Play resets it, so a restarted game
/// re-reports rather than staying quiet about a problem that is still there.
pub(super) fn emit_character_controller_diagnostics_system(
    diagnostics: Option<Res<CharacterControllerDiagnostics>>,
    mut mirror: Local<DiagnosticsMirror>,
) {
    let skipped: &[String] = diagnostics
        .as_ref()
        .map_or(&[], |d| d.skipped_without_collider.as_slice());

    if let Some(changed) = mirror.observe(diagnostics.is_some(), skipped) {
        events::emit_character_controller_diagnostics(&changed);
    }
}

/// Emit game camera data when selection changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_game_camera_on_selection(
    selection: Res<Selection>,
    camera_query: Query<(&EntityId, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
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
