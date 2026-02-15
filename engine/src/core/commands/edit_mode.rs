//! Edit mode command handlers

use serde::Deserialize;
use crate::core::pending_commands::{
    queue_enter_edit_mode_from_bridge,
    queue_exit_edit_mode_from_bridge,
    queue_set_selection_mode_from_bridge,
    queue_select_elements_from_bridge,
    queue_mesh_operation_from_bridge,
    queue_recalc_normals_from_bridge,
    EnterEditModeRequest,
    ExitEditModeRequest,
    SetSelectionModeRequest,
    SelectElementsRequest,
    MeshOperationRequest,
    RecalcNormalsRequest,
};

/// Dispatch edit mode commands
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "enter_edit_mode" => Some(handle_enter_edit_mode(payload.clone())),
        "exit_edit_mode" => Some(handle_exit_edit_mode(payload.clone())),
        "set_selection_mode" => Some(handle_set_selection_mode(payload.clone())),
        "select_elements" => Some(handle_select_elements(payload.clone())),
        "mesh_operation" => Some(handle_mesh_operation(payload.clone())),
        "recalc_normals" => Some(handle_recalc_normals(payload.clone())),
        _ => None,
    }
}

/// Payload for enter_edit_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnterEditModePayload {
    entity_id: String,
}

/// Handle enter_edit_mode command.
fn handle_enter_edit_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: EnterEditModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid enter_edit_mode payload: {}", e))?;

    let request = EnterEditModeRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_enter_edit_mode_from_bridge(request) {
        tracing::info!("Queued enter_edit_mode for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for exit_edit_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExitEditModePayload {
    entity_id: String,
}

/// Handle exit_edit_mode command.
fn handle_exit_edit_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: ExitEditModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid exit_edit_mode payload: {}", e))?;

    let request = ExitEditModeRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_exit_edit_mode_from_bridge(request) {
        tracing::info!("Queued exit_edit_mode for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_selection_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSelectionModePayload {
    entity_id: String,
    mode: String,
}

/// Handle set_selection_mode command.
fn handle_set_selection_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: SetSelectionModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_selection_mode payload: {}", e))?;

    let request = SetSelectionModeRequest {
        entity_id: data.entity_id.clone(),
        mode: data.mode.clone(),
    };

    if queue_set_selection_mode_from_bridge(request) {
        tracing::info!("Queued set_selection_mode: {} -> {}", data.entity_id, data.mode);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for select_elements command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectElementsPayload {
    entity_id: String,
    indices: Vec<u32>,
}

/// Handle select_elements command.
fn handle_select_elements(payload: serde_json::Value) -> super::CommandResult {
    let data: SelectElementsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid select_elements payload: {}", e))?;

    let request = SelectElementsRequest {
        entity_id: data.entity_id.clone(),
        indices: data.indices.clone(),
    };

    if queue_select_elements_from_bridge(request) {
        tracing::info!("Queued select_elements for entity: {} ({} indices)", data.entity_id, data.indices.len());
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for mesh_operation command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeshOperationPayload {
    entity_id: String,
    operation: String,
    params: String,
}

/// Handle mesh_operation command.
fn handle_mesh_operation(payload: serde_json::Value) -> super::CommandResult {
    let data: MeshOperationPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid mesh_operation payload: {}", e))?;

    let request = MeshOperationRequest {
        entity_id: data.entity_id.clone(),
        operation: data.operation.clone(),
        params: data.params.clone(),
    };

    if queue_mesh_operation_from_bridge(request) {
        tracing::info!("Queued mesh_operation: {} ({})", data.entity_id, data.operation);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for recalc_normals command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecalcNormalsPayload {
    entity_id: String,
    smooth: bool,
}

/// Handle recalc_normals command.
fn handle_recalc_normals(payload: serde_json::Value) -> super::CommandResult {
    let data: RecalcNormalsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid recalc_normals payload: {}", e))?;

    let request = RecalcNormalsRequest {
        entity_id: data.entity_id.clone(),
        smooth: data.smooth,
    };

    if queue_recalc_normals_from_bridge(request) {
        tracing::info!("Queued recalc_normals for entity: {} (smooth: {})", data.entity_id, data.smooth);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
