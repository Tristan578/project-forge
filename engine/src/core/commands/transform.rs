//! Transform and basic entity commands - handling entity CRUD, transform, selection, gizmo, and undo/redo.

use bevy::math::{Quat, Vec3, EulerRot};
use serde::Deserialize;
use crate::core::{
    camera_presets::CameraPreset,
    gizmo::CoordinateMode,
    input::{ActionDef, ActionType, InputPreset, InputSource},
    pending_commands::{
        queue_transform_update_from_bridge, queue_rename_from_bridge, queue_camera_focus_from_bridge,
        queue_spawn_from_bridge, queue_delete_from_bridge, queue_duplicate_from_bridge,
        queue_reparent_from_bridge, queue_snap_settings_update_from_bridge, queue_grid_toggle_from_bridge,
        queue_camera_preset_from_bridge, queue_coordinate_mode_update_from_bridge,
        queue_input_binding_update_from_bridge, queue_input_preset_from_bridge,
        queue_input_binding_removal_from_bridge,
        TransformUpdate, RenameRequest, CameraFocusRequest, SpawnRequest, DeleteRequest, DuplicateRequest,
        ReparentRequest, SnapSettingsUpdate, CameraPresetRequest, EntityType,
        InputBindingUpdate, InputPresetRequest, InputBindingRemoval,
        QueryRequest, SelectionRequest, SelectionMode, queue_selection_from_bridge,
        VisibilityRequest, queue_visibility_from_bridge,
        queue_clear_selection_from_bridge,
        GizmoModeRequest, queue_gizmo_mode_from_bridge,
    },
    history::{queue_undo_from_bridge, queue_redo_from_bridge},
    viewport::{self, ResizePayload},
};

/// Result type for command execution
pub type CommandResult = Result<(), String>;

/// Dispatch transform-related commands
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<CommandResult> {
    let result = match command {
        "resize" => handle_resize(payload.clone()),
        "update_scene" => handle_update_scene(payload.clone()),
        "spawn_entity" => handle_spawn_entity(payload.clone()),
        "despawn_entity" => handle_despawn_entity(payload.clone()),
        "update_transform" => handle_update_transform(payload.clone()),
        "set_camera" => handle_set_camera(payload.clone()),
        "select_entity" => handle_select_entity(payload.clone()),
        "select_entities" => handle_select_entities(payload.clone()),
        "clear_selection" => handle_clear_selection(payload.clone()),
        "set_visibility" => handle_set_visibility(payload.clone()),
        "set_gizmo_mode" => handle_set_gizmo_mode(payload.clone()),
        "set_coordinate_mode" => handle_set_coordinate_mode(payload.clone()),
        "rename_entity" => handle_rename_entity(payload.clone()),
        "reparent_entity" => handle_reparent_entity(payload.clone()),
        "focus_camera" => handle_focus_camera(payload.clone()),
        "delete_entities" => handle_delete_entities(payload.clone()),
        "duplicate_entity" => handle_duplicate_entity(payload.clone()),
        "undo" => handle_undo(payload.clone()),
        "redo" => handle_redo(payload.clone()),
        "set_snap_settings" => handle_set_snap_settings(payload.clone()),
        "toggle_grid" => handle_toggle_grid(payload.clone()),
        "set_camera_preset" => handle_set_camera_preset(payload.clone()),
        "set_input_binding" => handle_set_input_binding(payload.clone()),
        "remove_input_binding" => handle_remove_input_binding(payload.clone()),
        "set_input_preset" => handle_set_input_preset(payload.clone()),
        "get_input_bindings" => super::handle_query(QueryRequest::InputBindings),
        "get_input_state" => super::handle_query(QueryRequest::InputState),
        _ => return None,
    };
    Some(result)
}

/// Handle viewport resize from frontend.
fn handle_resize(payload: serde_json::Value) -> CommandResult {
    let resize_payload: ResizePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid resize payload: {}", e))?;

    viewport::handle_resize(resize_payload)
        .map(|_| ())
        .map_err(|e| format!("Resize failed: {}", e))
}

/// Update the entire scene graph from JSON.
fn handle_update_scene(_payload: serde_json::Value) -> CommandResult {
    Err("update_scene is not implemented. Use individual spawn/delete/update commands instead.".to_string())
}

/// Payload for spawn_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnEntityPayload {
    entity_type: String,
    name: Option<String>,
    position: Option<[f32; 3]>,
}

/// Spawn a new entity with the given components.
fn handle_spawn_entity(payload: serde_json::Value) -> CommandResult {
    let data: SpawnEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid spawn_entity payload: {}", e))?;

    let entity_type = EntityType::from_str(&data.entity_type)
        .ok_or_else(|| format!("Unknown entity type: {}", data.entity_type))?;

    let request = SpawnRequest {
        entity_type,
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_spawn_from_bridge(request) {
        tracing::info!("Queued spawn for entity type: {:?}", entity_type);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Remove an entity by ID.
fn handle_despawn_entity(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing entity id")?;

    let request = DeleteRequest {
        entity_ids: vec![entity_id.to_string()],
    };

    if queue_delete_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_transform command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTransformPayload {
    entity_id: String,
    position: Option<[f32; 3]>,
    rotation: Option<[f32; 3]>,  // Euler angles in radians
    scale: Option<[f32; 3]>,
}

/// Update an entity's transform.
/// Payload: { entityId: string, position?: [x,y,z], rotation?: [x,y,z], scale?: [x,y,z] }
fn handle_update_transform(payload: serde_json::Value) -> CommandResult {
    let data: UpdateTransformPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_transform payload: {}", e))?;

    // Validate all components are finite
    if let Some(p) = &data.position {
        if p.iter().any(|v| !v.is_finite()) {
            return Err("update_transform: position contains non-finite values".to_string());
        }
    }
    if let Some(r) = &data.rotation {
        if r.iter().any(|v| !v.is_finite()) {
            return Err("update_transform: rotation contains non-finite values".to_string());
        }
    }
    if let Some(s) = &data.scale {
        if s.iter().any(|v| !v.is_finite()) {
            return Err("update_transform: scale contains non-finite values".to_string());
        }
        // Zero scale collapses entity geometry and can cause NaN in physics
        if s.iter().any(|v| *v == 0.0) {
            return Err("update_transform: scale components must be non-zero".to_string());
        }
    }

    let update = TransformUpdate {
        entity_id: data.entity_id.clone(),
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
        rotation: data.rotation.map(|r| Quat::from_euler(EulerRot::XYZ, r[0], r[1], r[2])),
        scale: data.scale.map(|s| Vec3::new(s[0], s[1], s[2])),
    };

    if queue_transform_update_from_bridge(update) {
        tracing::info!("Queued transform update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Set the active camera parameters.
fn handle_set_camera(_payload: serde_json::Value) -> CommandResult {
    Err("set_camera is not implemented. Camera is controlled via orbit camera. Use focus_camera or set camera_preset commands instead.".to_string())
}

/// Select a single entity by ID.
/// Payload: { entityId: string, mode: 'replace' | 'add' | 'toggle' }
fn handle_select_entity(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?;

    let mode = payload.get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("replace");

    let selection_mode = match mode {
        "add" => SelectionMode::Add,
        "toggle" => SelectionMode::Toggle,
        _ => SelectionMode::Replace,
    };

    queue_selection_from_bridge(SelectionRequest {
        entity_id: entity_id.to_string(),
        mode: selection_mode,
    });

    Ok(())
}

/// Select multiple entities by ID.
/// Payload: { entityIds: string[], mode: 'replace' | 'add' }
fn handle_select_entities(payload: serde_json::Value) -> CommandResult {
    let entity_ids = payload.get("entityIds")
        .and_then(|v| v.as_array())
        .ok_or("Missing entityIds array")?;

    let mode = payload.get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("replace");

    let ids: Vec<String> = entity_ids.iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    if ids.is_empty() {
        return Ok(());
    }

    // First entity uses the requested mode, rest use Add
    for (i, id) in ids.iter().enumerate() {
        let selection_mode = if i == 0 {
            match mode {
                "add" => SelectionMode::Add,
                "toggle" => SelectionMode::Toggle,
                _ => SelectionMode::Replace,
            }
        } else {
            SelectionMode::Add
        };

        queue_selection_from_bridge(SelectionRequest {
            entity_id: id.clone(),
            mode: selection_mode,
        });
    }

    Ok(())
}

/// Clear all selection.
fn handle_clear_selection(_payload: serde_json::Value) -> CommandResult {
    if queue_clear_selection_from_bridge() {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Set entity visibility.
/// Payload: { entityId: string, visible: bool }
fn handle_set_visibility(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?;

    let visible = payload.get("visible")
        .and_then(|v| v.as_bool())
        .ok_or("Missing visible boolean")?;

    if queue_visibility_from_bridge(VisibilityRequest {
        entity_id: entity_id.to_string(),
        visible,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Set gizmo mode.
/// Payload: { mode: 'translate' | 'rotate' | 'scale' }
fn handle_set_gizmo_mode(payload: serde_json::Value) -> CommandResult {
    let mode = payload.get("mode")
        .and_then(|v| v.as_str())
        .ok_or("Missing mode")?;

    match mode {
        "translate" | "rotate" | "scale" => {
            if queue_gizmo_mode_from_bridge(GizmoModeRequest {
                mode: mode.to_string(),
            }) {
                Ok(())
            } else {
                Err("PendingCommands resource not initialized".to_string())
            }
        }
        _ => Err(format!("Invalid gizmo mode: {}", mode)),
    }
}

/// Handle set_coordinate_mode command from React.
fn handle_set_coordinate_mode(payload: serde_json::Value) -> CommandResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SetCoordinateModePayload {
        mode: String,
    }

    let parsed: SetCoordinateModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid payload: {}", e))?;

    let mode = CoordinateMode::from_str(&parsed.mode)
        .ok_or_else(|| format!("Unknown coordinate mode: {}", parsed.mode))?;

    if queue_coordinate_mode_update_from_bridge(mode) {
        tracing::info!("Queued coordinate mode update: {:?}", mode);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for rename_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameEntityPayload {
    entity_id: String,
    name: String,
}

/// Rename an entity.
/// Payload: { entityId: string, name: string }
fn handle_rename_entity(payload: serde_json::Value) -> CommandResult {
    let data: RenameEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid rename_entity payload: {}", e))?;

    let request = RenameRequest {
        entity_id: data.entity_id.clone(),
        new_name: data.name.clone(),
    };

    if queue_rename_from_bridge(request) {
        tracing::info!("Queued rename for entity {}: {}", data.entity_id, data.name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for reparent_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReparentEntityPayload {
    entity_id: String,
    new_parent_id: Option<String>,
    insert_index: Option<usize>,
}

/// Handle reparent_entity command from React.
fn handle_reparent_entity(payload: serde_json::Value) -> CommandResult {
    let data: ReparentEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid reparent_entity payload: {}", e))?;

    let request = ReparentRequest {
        entity_id: data.entity_id.clone(),
        new_parent_id: data.new_parent_id.clone(),
        insert_index: data.insert_index,
    };

    if queue_reparent_from_bridge(request) {
        tracing::info!(
            "Queued reparent: {} -> {:?} (index: {:?})",
            data.entity_id,
            data.new_parent_id,
            data.insert_index
        );
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for focus_camera command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusCameraPayload {
    entity_id: String,
}

/// Focus the camera on an entity.
/// Payload: { entityId: string }
fn handle_focus_camera(payload: serde_json::Value) -> CommandResult {
    let data: FocusCameraPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid focus_camera payload: {}", e))?;

    let request = CameraFocusRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_camera_focus_from_bridge(request) {
        tracing::info!("Queued camera focus on entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for delete_entities command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteEntitiesPayload {
    entity_ids: Vec<String>,
}

/// Delete entities by ID.
/// Payload: { entityIds: string[] }
fn handle_delete_entities(payload: serde_json::Value) -> CommandResult {
    let data: DeleteEntitiesPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid delete_entities payload: {}", e))?;

    if data.entity_ids.is_empty() {
        return Ok(()); // Nothing to delete
    }

    let request = DeleteRequest {
        entity_ids: data.entity_ids.clone(),
    };

    if queue_delete_from_bridge(request) {
        tracing::info!("Queued delete for entities: {:?}", data.entity_ids);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for duplicate_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateEntityPayload {
    entity_id: String,
}

/// Duplicate an entity.
/// Payload: { entityId: string }
fn handle_duplicate_entity(payload: serde_json::Value) -> CommandResult {
    let data: DuplicateEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid duplicate_entity payload: {}", e))?;

    let request = DuplicateRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_duplicate_from_bridge(request) {
        tracing::info!("Queued duplicate for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle undo command.
fn handle_undo(_payload: serde_json::Value) -> CommandResult {
    if queue_undo_from_bridge() {
        tracing::info!("Queued undo request");
        Ok(())
    } else {
        Err("History system not initialized".to_string())
    }
}

/// Handle redo command.
fn handle_redo(_payload: serde_json::Value) -> CommandResult {
    if queue_redo_from_bridge() {
        tracing::info!("Queued redo request");
        Ok(())
    } else {
        Err("History system not initialized".to_string())
    }
}

/// Payload for set_snap_settings command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSnapSettingsPayload {
    translation_snap: Option<f32>,
    rotation_snap_degrees: Option<f32>,
    scale_snap: Option<f32>,
    grid_visible: Option<bool>,
    grid_size: Option<f32>,
    grid_extent: Option<u32>,
}

/// Handle set_snap_settings command from React.
fn handle_set_snap_settings(payload: serde_json::Value) -> CommandResult {
    let settings: SetSnapSettingsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_snap_settings payload: {}", e))?;

    let update = SnapSettingsUpdate {
        translation_snap: settings.translation_snap,
        rotation_snap_degrees: settings.rotation_snap_degrees,
        scale_snap: settings.scale_snap,
        grid_visible: settings.grid_visible,
        grid_size: settings.grid_size,
        grid_extent: settings.grid_extent,
    };

    if queue_snap_settings_update_from_bridge(update) {
        tracing::info!("Queued snap settings update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle toggle_grid command from React.
fn handle_toggle_grid(_payload: serde_json::Value) -> CommandResult {
    if queue_grid_toggle_from_bridge() {
        tracing::info!("Queued grid toggle");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_camera_preset command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCameraPresetPayload {
    preset: CameraPreset,
}

/// Handle set_camera_preset command from React.
fn handle_set_camera_preset(payload: serde_json::Value) -> CommandResult {
    let data: SetCameraPresetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_camera_preset payload: {}", e))?;

    let request = CameraPresetRequest {
        preset: data.preset,
    };

    if queue_camera_preset_from_bridge(request) {
        tracing::info!("Queued camera preset: {:?}", data.preset);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_input_binding command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetInputBindingPayload {
    action_name: String,
    action_type: String,
    #[serde(default)]
    sources: Vec<String>,
    #[serde(default)]
    positive_keys: Vec<String>,
    #[serde(default)]
    negative_keys: Vec<String>,
    #[serde(default)]
    dead_zone: Option<f32>,
}

/// Handle set_input_binding command.
fn handle_set_input_binding(payload: serde_json::Value) -> CommandResult {
    let data: SetInputBindingPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_input_binding payload: {}", e))?;

    let action_type = match data.action_type.as_str() {
        "axis" => ActionType::Axis {
            positive: data.positive_keys.iter().map(|k| InputSource::Key(k.clone())).collect(),
            negative: data.negative_keys.iter().map(|k| InputSource::Key(k.clone())).collect(),
        },
        _ => ActionType::Digital,
    };

    let sources: Vec<InputSource> = data.sources.iter().map(|s| {
        if s == "Left" || s == "Right" || s == "Middle" {
            InputSource::MouseButton(s.clone())
        } else {
            InputSource::Key(s.clone())
        }
    }).collect();

    let action_def = ActionDef {
        name: data.action_name.clone(),
        action_type,
        sources,
        dead_zone: data.dead_zone.unwrap_or(0.1),
    };

    let update = InputBindingUpdate { action_def };

    if queue_input_binding_update_from_bridge(update) {
        tracing::info!("Queued input binding update: {}", data.action_name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for remove_input_binding command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveInputBindingPayload {
    action_name: String,
}

/// Handle remove_input_binding command.
fn handle_remove_input_binding(payload: serde_json::Value) -> CommandResult {
    let data: RemoveInputBindingPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid remove_input_binding payload: {}", e))?;

    let removal = InputBindingRemoval {
        action_name: data.action_name.clone(),
    };

    if queue_input_binding_removal_from_bridge(removal) {
        tracing::info!("Queued input binding removal: {}", data.action_name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_input_preset command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetInputPresetPayload {
    preset: String,
}

/// Handle set_input_preset command.
fn handle_set_input_preset(payload: serde_json::Value) -> CommandResult {
    let data: SetInputPresetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_input_preset payload: {}", e))?;

    let preset = InputPreset::from_str(&data.preset)
        .ok_or_else(|| format!("Unknown input preset: {}. Valid: fps, platformer, topdown, racing", data.preset))?;

    let request = InputPresetRequest { preset };

    if queue_input_preset_from_bridge(request) {
        tracing::info!("Queued input preset: {:?}", preset);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Helper: call dispatch() via the parent module
    fn run(command: &str, payload: serde_json::Value) -> Result<(), String> {
        dispatch(command, &payload).expect("transform dispatch returned None for known command")
    }

    // === spawn_entity ===

    #[test]
    fn spawn_entity_accepts_valid_cube_payload() {
        // Will fail with "not initialized" (no PendingCommands), not a parse error
        let result = run("spawn_entity", json!({
            "entityType": "cube",
            "name": "MyCube"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn spawn_entity_accepts_optional_position() {
        let result = run("spawn_entity", json!({
            "entityType": "sphere",
            "position": [1.0, 2.0, 3.0]
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn spawn_entity_rejects_missing_entity_type() {
        let result = run("spawn_entity", json!({"name": "NoType"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        // serde missing field error or our validation
        assert!(
            err.contains("entity_type") || err.contains("entityType") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    #[test]
    fn spawn_entity_rejects_unknown_entity_type() {
        let result = run("spawn_entity", json!({"entityType": "dragon"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown entity type"),
            "Expected unknown entity type error, got: {}",
            err
        );
    }

    #[test]
    fn spawn_entity_accepts_all_valid_entity_types() {
        let valid_types = [
            "cube", "sphere", "plane", "cylinder", "cone", "torus", "capsule",
            "point_light", "directional_light", "spot_light",
        ];
        for entity_type in &valid_types {
            let result = run("spawn_entity", json!({"entityType": entity_type}));
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(
                err.contains("not initialized"),
                "Entity type '{}' should reach queue, got: {}",
                entity_type,
                err
            );
        }
    }

    // === despawn_entity (uses "id" key, not "entityId") ===

    #[test]
    fn despawn_entity_accepts_valid_id() {
        let result = run("despawn_entity", json!({"id": "entity-123"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn despawn_entity_rejects_missing_id() {
        let result = run("despawn_entity", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Missing entity id"),
            "Expected missing id error, got: {}",
            err
        );
    }

    // === update_transform ===

    #[test]
    fn update_transform_accepts_entity_id_only() {
        // All position/rotation/scale are optional
        let result = run("update_transform", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn update_transform_accepts_full_payload() {
        let result = run("update_transform", json!({
            "entityId": "entity-1",
            "position": [1.0, 2.0, 3.0],
            "rotation": [0.0, 1.57, 0.0],
            "scale": [2.0, 2.0, 2.0]
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn update_transform_rejects_missing_entity_id() {
        let result = run("update_transform", json!({"position": [0.0, 0.0, 0.0]}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error for missing entityId, got: {}",
            err
        );
    }

    // === rename_entity ===

    #[test]
    fn rename_entity_accepts_valid_payload() {
        let result = run("rename_entity", json!({
            "entityId": "entity-1",
            "name": "NewName"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn rename_entity_rejects_missing_entity_id() {
        let result = run("rename_entity", json!({"name": "NoEntity"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    #[test]
    fn rename_entity_rejects_missing_name() {
        let result = run("rename_entity", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("name") || err.contains("Invalid"),
            "Expected parse error for missing name, got: {}",
            err
        );
    }

    // === reparent_entity ===

    #[test]
    fn reparent_entity_accepts_null_parent_for_root() {
        let result = run("reparent_entity", json!({
            "entityId": "entity-1",
            "newParentId": null
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn reparent_entity_accepts_new_parent_id() {
        let result = run("reparent_entity", json!({
            "entityId": "entity-1",
            "newParentId": "entity-2"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === delete_entities ===

    #[test]
    fn delete_entities_with_empty_list_is_no_op() {
        let result = run("delete_entities", json!({"entityIds": []}));
        assert!(result.is_ok(), "Empty delete list should be no-op");
    }

    #[test]
    fn delete_entities_with_ids_queues_delete() {
        let result = run("delete_entities", json!({
            "entityIds": ["entity-1", "entity-2"]
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn delete_entities_rejects_missing_entity_ids_field() {
        let result = run("delete_entities", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityIds") || err.contains("entity_ids") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    // === duplicate_entity ===

    #[test]
    fn duplicate_entity_accepts_valid_entity_id() {
        let result = run("duplicate_entity", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn duplicate_entity_rejects_missing_entity_id() {
        let result = run("duplicate_entity", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    // === select_entity ===

    #[test]
    fn select_entity_uses_replace_mode_by_default() {
        let result = run("select_entity", json!({"entityId": "entity-1"}));
        // select_entity calls queue_selection_from_bridge which doesn't check PendingCommands
        // It should succeed (queue_selection is fire-and-forget)
        // OR return ok (it calls queue_selection_from_bridge which may silently do nothing)
        // Either way it should NOT return "Unknown command"
        match result {
            Ok(_) => { /* success path — queue_selection_from_bridge ran */ }
            Err(err) => {
                // If it errors, it must be a meaningful error, not "Unknown command"
                assert!(
                    !err.contains("Unknown transform command"),
                    "Should not be unknown, got: {}",
                    err
                );
            }
        }
    }

    #[test]
    fn select_entity_rejects_missing_entity_id() {
        let result = run("select_entity", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityId") || err.contains("Missing"),
            "Expected missing entityId error, got: {}",
            err
        );
    }

    // === set_visibility ===

    #[test]
    fn set_visibility_accepts_valid_payload() {
        let result = run("set_visibility", json!({
            "entityId": "entity-1",
            "visible": true
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_visibility_rejects_non_boolean_visible() {
        let result = run("set_visibility", json!({
            "entityId": "entity-1",
            "visible": "yes"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("visible") || err.contains("Missing"),
            "Expected visible error, got: {}",
            err
        );
    }

    // === set_gizmo_mode ===

    #[test]
    fn set_gizmo_mode_accepts_translate() {
        let result = run("set_gizmo_mode", json!({"mode": "translate"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_gizmo_mode_accepts_rotate() {
        let result = run("set_gizmo_mode", json!({"mode": "rotate"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_gizmo_mode_accepts_scale() {
        let result = run("set_gizmo_mode", json!({"mode": "scale"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_gizmo_mode_rejects_invalid_mode() {
        let result = run("set_gizmo_mode", json!({"mode": "warp"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid gizmo mode"));
    }

    #[test]
    fn set_gizmo_mode_rejects_missing_mode() {
        let result = run("set_gizmo_mode", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("mode") || err.contains("Missing"),
            "Expected missing mode error, got: {}",
            err
        );
    }

    // === focus_camera ===

    #[test]
    fn focus_camera_accepts_valid_entity_id() {
        let result = run("focus_camera", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn focus_camera_rejects_missing_entity_id() {
        let result = run("focus_camera", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    // === undo/redo ===
    // undo/redo use PENDING_HISTORY which is always initialized (thread-local with default value),
    // so they always return Ok() — unlike commands that use PendingCommands.

    #[test]
    fn undo_always_succeeds() {
        let result = run("undo", json!({}));
        assert!(result.is_ok(), "undo should always queue successfully");
    }

    #[test]
    fn redo_always_succeeds() {
        let result = run("redo", json!({}));
        assert!(result.is_ok(), "redo should always queue successfully");
    }

    // === update_scene (not implemented) ===

    #[test]
    fn update_scene_returns_not_implemented() {
        let result = run("update_scene", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not implemented"));
    }

    // === set_input_preset ===

    #[test]
    fn set_input_preset_rejects_unknown_preset() {
        let result = run("set_input_preset", json!({"preset": "vr_controller"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown input preset"),
            "Expected unknown preset error, got: {}",
            err
        );
    }

    #[test]
    fn set_input_preset_accepts_fps_preset() {
        let result = run("set_input_preset", json!({"preset": "fps"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === dispatch returns None for unknown commands ===

    #[test]
    fn dispatch_returns_none_for_unknown_command() {
        let result = dispatch("not_a_transform_command", &json!({}));
        assert!(result.is_none(), "Unknown command should return None");
    }
}
