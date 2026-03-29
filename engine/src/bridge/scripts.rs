//! Script bridge — stores script metadata on ECS entities and handles play-tick input dispatch.
//! Actual script execution happens in the JS Web Worker sandbox, not in Rust.

use bevy::prelude::*;
use std::collections::HashMap;
use crate::core::{
    entity_id::{EntityId, EntityName},
    history::{HistoryStack, UndoableAction},
    input::{InputMap, InputState},
    pending_commands::{EntityType, PendingCommands},
    scripting::ScriptData,
    engine_mode::EngineMode,
};
use crate::bridge::{events, Selection, SelectionChangedEvent};

/// Per-entity state cached from the previous play-tick frame.
/// Used to compute deltas so only changed entities are emitted.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CachedEntityState {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
    pub name: String,
    pub entity_type: String,
    pub collider_radius: f32,
}

/// Resource that holds the previous frame's play-tick state.
/// Cleared automatically when leaving Play mode.
#[derive(Resource, Default)]
pub(crate) struct PlayTickCache {
    pub states: HashMap<String, CachedEntityState>,
}

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
///
/// Uses delta compression: only entities whose state changed since the previous frame
/// (plus newly added and removed entities) are included in the event payload. This
/// reduces JS deserialization work proportionally to scene size.
pub(super) fn emit_play_tick_system(
    mode: Res<EngineMode>,
    query: Query<(&EntityId, &Transform, &EntityName, Option<&EntityType>)>,
    input_state: Res<InputState>,
    mut cache: ResMut<PlayTickCache>,
) {
    if !matches!(*mode, EngineMode::Play) {
        // Clear cache when not in Play mode so next entry emits a full frame.
        if !cache.states.is_empty() {
            cache.states.clear();
        }
        return;
    }

    // Build current frame state
    let current_frame: HashMap<String, CachedEntityState> = query.iter()
        .map(|(eid, transform, ename, etype)| {
            let pos = transform.translation;
            let rot = transform.rotation.to_euler(bevy::math::EulerRot::XYZ);
            let scale = transform.scale;
            let type_str = etype.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "unknown".to_string());
            let collider_r = scale.x.max(scale.y).max(scale.z) * 0.5;
            (eid.0.clone(), CachedEntityState {
                position: [pos.x, pos.y, pos.z],
                rotation: [rot.0, rot.1, rot.2],
                scale: [scale.x, scale.y, scale.z],
                name: ename.0.clone(),
                entity_type: type_str,
                collider_radius: collider_r,
            })
        })
        .collect();

    // Compute delta: entities that are new or changed
    let mut changed: Vec<(String, [f32; 3], [f32; 3], [f32; 3], String, String, f32)> = Vec::new();
    for (id, state) in &current_frame {
        let is_changed = cache.states.get(id.as_str()).map_or(true, |prev| prev != state);
        if is_changed {
            changed.push((
                id.clone(),
                state.position,
                state.rotation,
                state.scale,
                state.name.clone(),
                state.entity_type.clone(),
                state.collider_radius,
            ));
        }
    }

    // Compute removed entities (were in cache, not in current frame)
    let removed: Vec<String> = cache.states.keys()
        .filter(|id| !current_frame.contains_key(id.as_str()))
        .cloned()
        .collect();

    // Update cache for next frame
    cache.states = current_frame;

    // Always emit (script runtime needs input state every frame even if no entity changed)
    events::emit_play_tick_delta(&changed, &removed, &input_state);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state(x: f32) -> CachedEntityState {
        CachedEntityState {
            position: [x, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0],
            scale: [1.0, 1.0, 1.0],
            name: "Cube".to_string(),
            entity_type: "cube".to_string(),
            collider_radius: 0.5,
        }
    }

    // === PlayTickCache struct tests (PF-623) ===

    #[test]
    fn play_tick_cache_starts_empty() {
        let cache = PlayTickCache::default();
        assert!(cache.states.is_empty());
    }

    #[test]
    fn cached_entity_state_equality_detects_position_change() {
        let a = make_state(0.0);
        let b = make_state(1.0);
        assert_ne!(a, b);
    }

    #[test]
    fn cached_entity_state_equality_same_state_is_equal() {
        let a = make_state(5.0);
        let b = make_state(5.0);
        assert_eq!(a, b);
    }

    #[test]
    fn play_tick_cache_stores_and_retrieves_state() {
        let mut cache = PlayTickCache::default();
        cache.states.insert("entity-1".to_string(), make_state(3.0));
        let retrieved = cache.states.get("entity-1").unwrap();
        assert_eq!(retrieved.position[0], 3.0);
    }

    #[test]
    fn play_tick_cache_clear_removes_all_entries() {
        let mut cache = PlayTickCache::default();
        cache.states.insert("entity-1".to_string(), make_state(0.0));
        cache.states.insert("entity-2".to_string(), make_state(1.0));
        cache.states.clear();
        assert!(cache.states.is_empty());
    }

    #[test]
    fn delta_detection_identifies_new_entity() {
        let cache_states: HashMap<String, CachedEntityState> = HashMap::new();
        let current = HashMap::from([("entity-1".to_string(), make_state(0.0))]);
        // entity-1 is in current but not cache → should be emitted as changed
        let changed: Vec<_> = current.iter()
            .filter(|(id, state)| cache_states.get(id.as_str()).map_or(true, |prev| prev != *state))
            .collect();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].0, "entity-1");
    }

    #[test]
    fn delta_detection_identifies_removed_entity() {
        let mut cache_states: HashMap<String, CachedEntityState> = HashMap::new();
        cache_states.insert("entity-old".to_string(), make_state(0.0));
        let current: HashMap<String, CachedEntityState> = HashMap::new();
        // entity-old is in cache but not current → removed
        let removed: Vec<_> = cache_states.keys()
            .filter(|id| !current.contains_key(id.as_str()))
            .collect();
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0], "entity-old");
    }

    #[test]
    fn delta_detection_skips_unchanged_entity() {
        let state = make_state(2.5);
        let mut cache_states: HashMap<String, CachedEntityState> = HashMap::new();
        cache_states.insert("entity-1".to_string(), state.clone());
        let current = HashMap::from([("entity-1".to_string(), state)]);
        let changed: Vec<_> = current.iter()
            .filter(|(id, st)| cache_states.get(id.as_str()).map_or(true, |prev| prev != *st))
            .collect();
        assert!(changed.is_empty(), "unchanged entity should not appear in delta");
    }
}

/// Emit script changed events on selection changes and script data changes.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_script_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ScriptData), Changed<ScriptData>>,
    selection_query: Query<(&EntityId, Option<&ScriptData>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
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
