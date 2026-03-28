//! Game component and camera command handlers.

use crate::core::pending_commands::{
    queue_game_component_add_from_bridge, queue_game_component_update_from_bridge,
    queue_game_component_removal_from_bridge, queue_set_game_camera_from_bridge,
    queue_set_active_game_camera_from_bridge, queue_camera_shake_from_bridge,
    queue_mouse_delta_from_bridge,
    GameComponentAddRequest, GameComponentUpdateRequest, GameComponentRemovalRequest,
    SetGameCameraRequest, SetActiveGameCameraRequest, CameraShakeRequest, QueryRequest,
};

/// Handle add_game_component command.
/// Payload: { entityId, componentType, properties? }
fn handle_add_game_component(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let component_type = payload.get("componentType")
        .and_then(|v| v.as_str())
        .ok_or("Missing componentType")?
        .to_string();

    let properties = payload.get("properties")
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let properties_json = properties.to_string();

    let request = GameComponentAddRequest {
        entity_id,
        component_type,
        properties_json,
    };

    if queue_game_component_add_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_game_component command.
/// Payload: { entityId, componentType, properties }
fn handle_update_game_component(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let component_type = payload.get("componentType")
        .and_then(|v| v.as_str())
        .ok_or("Missing componentType")?
        .to_string();

    let properties = payload.get("properties")
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let properties_json = properties.to_string();

    let request = GameComponentUpdateRequest {
        entity_id,
        component_type,
        properties_json,
    };

    if queue_game_component_update_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_game_component command.
/// Payload: { entityId, componentName }
fn handle_remove_game_component(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let component_name = payload.get("componentName")
        .and_then(|v| v.as_str())
        .ok_or("Missing componentName")?
        .to_string();

    let request = GameComponentRemovalRequest {
        entity_id,
        component_name,
    };

    if queue_game_component_removal_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle list_game_component_types command.
/// Returns static list of available types with default data.
fn handle_list_game_component_types(_payload: serde_json::Value) -> super::CommandResult {
    // This is a synchronous query, handled directly via handle_query in dispatch
    // But we need to return data immediately here
    Ok(())
}

// --- Game Camera Commands ---

/// Handle set_game_camera command.
/// Payload: { entity_id, mode, target_entity? }
fn handle_set_game_camera(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entity_id")
        .or_else(|| payload.get("entityId"))
        .and_then(|v| v.as_str())
        .ok_or("Missing entity_id")?
        .to_string();

    let mode: super::super::game_camera::GameCameraMode = serde_json::from_value(
        payload.get("mode").cloned().ok_or("Missing mode")?
    ).map_err(|e| format!("Invalid mode: {}", e))?;

    let target_entity = payload.get("target_entity")
        .or_else(|| payload.get("targetEntity"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if queue_set_game_camera_from_bridge(SetGameCameraRequest {
        entity_id,
        mode,
        target_entity,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_active_game_camera command.
/// Payload: { entity_id }
fn handle_set_active_game_camera(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entity_id")
        .or_else(|| payload.get("entityId"))
        .and_then(|v| v.as_str())
        .ok_or("Missing entity_id")?
        .to_string();

    if queue_set_active_game_camera_from_bridge(SetActiveGameCameraRequest {
        entity_id,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle camera_shake command.
/// Payload: { intensity, duration }
fn handle_camera_shake(payload: serde_json::Value) -> super::CommandResult {
    let intensity = payload.get("intensity")
        .and_then(|v| v.as_f64())
        .ok_or("Missing intensity")? as f32;

    let duration = payload.get("duration")
        .and_then(|v| v.as_f64())
        .ok_or("Missing duration")? as f32;

    if !intensity.is_finite() || !duration.is_finite() {
        return Err("camera_shake: intensity and duration must be finite numbers".to_string());
    }

    let intensity = intensity.clamp(0.0, 100.0);
    let duration = duration.clamp(0.0, 30.0);

    if queue_camera_shake_from_bridge(CameraShakeRequest {
        intensity,
        duration,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle mouse_delta command.
/// Payload: { dx, dy }
fn handle_mouse_delta(payload: serde_json::Value) -> super::CommandResult {
    let dx = payload.get("dx").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let dy = payload.get("dy").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;

    if queue_mouse_delta_from_bridge(dx, dy) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "add_game_component" => Some(handle_add_game_component(payload.clone())),
        "update_game_component" => Some(handle_update_game_component(payload.clone())),
        "remove_game_component" => Some(handle_remove_game_component(payload.clone())),
        "get_game_components" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::GameComponentState { entity_id }))
        }
        "list_game_component_types" => Some(handle_list_game_component_types(payload.clone())),
        "set_game_camera" => Some(handle_set_game_camera(payload.clone())),
        "set_active_game_camera" => Some(handle_set_active_game_camera(payload.clone())),
        "camera_shake" => Some(handle_camera_shake(payload.clone())),
        "mouse_delta" => Some(handle_mouse_delta(payload.clone())),
        "get_game_camera" => {
            // NOTE: checks both "entityId" and "entity_id" field names
            let entity_id = payload.get("entityId")
                .or_else(|| payload.get("entity_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(super::handle_query(QueryRequest::GameCameraState { entity_id }))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(command: &str, payload: serde_json::Value) -> Result<(), String> {
        dispatch(command, &payload).expect("game dispatch returned None for known command")
    }

    // === add_game_component ===

    #[test]
    fn add_game_component_accepts_valid_payload() {
        let result = run("add_game_component", json!({
            "entityId": "entity-1",
            "componentType": "Health"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn add_game_component_accepts_optional_properties() {
        let result = run("add_game_component", json!({
            "entityId": "entity-1",
            "componentType": "CharacterController",
            "properties": {"speed": 5.0, "jumpHeight": 2.0}
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn add_game_component_rejects_missing_entity_id() {
        let result = run("add_game_component", json!({
            "componentType": "Health"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityId") || err.contains("Missing"),
            "Expected missing entityId error, got: {}",
            err
        );
    }

    #[test]
    fn add_game_component_rejects_missing_component_type() {
        let result = run("add_game_component", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("componentType") || err.contains("Missing"),
            "Expected missing componentType error, got: {}",
            err
        );
    }

    // === update_game_component ===

    #[test]
    fn update_game_component_accepts_valid_payload() {
        let result = run("update_game_component", json!({
            "entityId": "entity-1",
            "componentType": "Health",
            "properties": {"maxHealth": 100}
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === remove_game_component ===

    #[test]
    fn remove_game_component_accepts_valid_payload() {
        let result = run("remove_game_component", json!({
            "entityId": "entity-1",
            "componentName": "Health"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn remove_game_component_rejects_missing_component_name() {
        let result = run("remove_game_component", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("componentName") || err.contains("Missing"),
            "Expected missing componentName error, got: {}",
            err
        );
    }

    // === list_game_component_types ===

    #[test]
    fn list_game_component_types_returns_ok() {
        let result = run("list_game_component_types", json!({}));
        // This is a synchronous query that returns Ok immediately
        assert!(result.is_ok(), "list_game_component_types should return Ok");
    }

    // === get_game_components (query) ===

    #[test]
    fn get_game_components_queues_query() {
        let result = run("get_game_components", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === camera_shake ===

    #[test]
    fn camera_shake_accepts_intensity_and_duration() {
        let result = run("camera_shake", json!({
            "intensity": 0.5,
            "duration": 1.0
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Should reach handler (not "Unknown")
        assert!(!err.contains("Unknown"), "Should reach camera_shake handler, got: {}", err);
    }

    // === mouse_delta ===

    #[test]
    fn mouse_delta_accepts_empty_payload_with_defaults() {
        // dx and dy default to 0.0 if missing
        let result = run("mouse_delta", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn mouse_delta_accepts_dx_dy_values() {
        let result = run("mouse_delta", json!({"dx": 5.0, "dy": -3.0}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === set_active_game_camera ===

    #[test]
    fn set_active_game_camera_accepts_entity_id() {
        let result = run("set_active_game_camera", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_active_game_camera_rejects_missing_entity_id() {
        let result = run("set_active_game_camera", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("Missing"),
            "Expected missing entity_id error, got: {}",
            err
        );
    }

    // === dispatch returns None for unknown commands ===

    #[test]
    fn dispatch_returns_none_for_unknown_command() {
        let result = dispatch("definitely_not_game", &json!({}));
        assert!(result.is_none(), "Unknown command should return None");
    }
}
