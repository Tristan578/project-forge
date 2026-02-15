use bevy::prelude::*;
use crate::core::{
    entity_id::{EntityId, EntityName},
    history::{HistoryStack, UndoableAction},
    input::{InputMap, InputState},
    pending_commands::{EntityType, PendingCommands},
    scripting::ScriptData,
    engine_mode::EngineMode,
};
use crate::bridge::{events, Selection, SelectionChangedEvent};

/// System that applies pending input binding updates (works in all modes).
pub(super) fn apply_input_binding_updates(
    mut pending: ResMut<PendingCommands>,
    mut input_map: ResMut<InputMap>,
) {
    let mut changed = false;

    // Process preset requests first (replaces entire map)
    for request in pending.input_preset_requests.drain(..) {
        *input_map = request.preset.default_bindings();
        changed = true;
        tracing::info!("Applied input preset: {:?}", request.preset);
    }

    // Process individual binding updates
    for update in pending.input_binding_updates.drain(..) {
        let name = update.action_def.name.clone();
        input_map.actions.insert(name.clone(), update.action_def);
        input_map.preset = None; // Mark as custom
        changed = true;
        tracing::info!("Updated input binding: {}", name);
    }

    // Process binding removals
    for removal in pending.input_binding_removals.drain(..) {
        if input_map.actions.remove(&removal.action_name).is_some() {
            input_map.preset = None;
            changed = true;
            tracing::info!("Removed input binding: {}", removal.action_name);
        }
    }

    if changed {
        events::emit_input_bindings_changed(&input_map);
    }
}

/// System that emits entity states every frame during Play mode for the script runtime.
pub(super) fn emit_play_tick_system(
    mode: Res<EngineMode>,
    query: Query<(&EntityId, &Transform, &EntityName, Option<&EntityType>)>,
    input_state: Res<InputState>,
) {
    if !matches!(*mode, EngineMode::Play) {
        return;
    }

    let entities: Vec<(String, [f32; 3], [f32; 3], [f32; 3], String, String, f32)> = query.iter()
        .map(|(eid, transform, ename, etype)| {
            let pos = transform.translation;
            let rot = transform.rotation.to_euler(bevy::math::EulerRot::XYZ);
            let scale = transform.scale;
            let type_str = etype.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "unknown".to_string());
            // Estimate collider radius from max of scale dimensions * 0.5
            let collider_r = scale.x.max(scale.y).max(scale.z) * 0.5;
            (
                eid.0.clone(),
                [pos.x, pos.y, pos.z],
                [rot.0, rot.1, rot.2],
                [scale.x, scale.y, scale.z],
                ename.0.clone(),
                type_str,
                collider_r,
            )
        })
        .collect();

    events::emit_play_tick(&entities, &input_state);
}

/// System that applies pending script updates (always-active).
pub(super) fn apply_script_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.script_updates.drain(..) {
        for (entity, entity_id, current_script) in query.iter() {
            if entity_id.0 == update.entity_id {
                let old_script = current_script.cloned();
                let new_script = ScriptData {
                    source: update.source.clone(),
                    enabled: update.enabled,
                    template: update.template.clone(),
                };

                // Insert or update script component
                commands.entity(entity).insert(new_script.clone());

                // Record for undo
                history.push(UndoableAction::ScriptChange {
                    entity_id: update.entity_id.clone(),
                    old_script,
                    new_script: Some(new_script.clone()),
                });

                // Emit change event
                events::emit_script_changed(&update.entity_id, Some(&new_script));
                break;
            }
        }
    }
}

/// System that applies pending script removals (always-active).
pub(super) fn apply_script_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ScriptData>)>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.script_removals.drain(..) {
        for (entity, entity_id, current_script) in query.iter() {
            if entity_id.0 == removal.entity_id {
                let old_script = current_script.cloned();

                // Remove script component
                commands.entity(entity).remove::<ScriptData>();

                // Record for undo
                history.push(UndoableAction::ScriptChange {
                    entity_id: removal.entity_id.clone(),
                    old_script,
                    new_script: None,
                });

                // Emit change event
                events::emit_script_changed(&removal.entity_id, None);
                break;
            }
        }
    }
}

/// Emit script changed events on selection changes and script data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_script_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ScriptData), Changed<ScriptData>>,
    selection_query: Query<(&EntityId, Option<&ScriptData>)>,
    mut selection_events: EventReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, script_data)) = selection_query.get(primary) {
                events::emit_script_changed(&entity_id.0, script_data);
            }
        }
    }

    // Emit when script data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, script_data)) = query.get(primary) {
            events::emit_script_changed(&entity_id.0, Some(script_data));
        }
    }
}
