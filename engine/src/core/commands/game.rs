//! Game component and camera command handlers.

use crate::core::pending_commands::{
    queue_game_component_add_from_bridge, queue_game_component_update_from_bridge,
    queue_game_component_removal_from_bridge, queue_set_game_camera_from_bridge,
    queue_set_active_game_camera_from_bridge, queue_camera_shake_from_bridge,
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

    if queue_camera_shake_from_bridge(CameraShakeRequest {
        intensity,
        duration,
    }) {
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
