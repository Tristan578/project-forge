//! Scene, asset, and script command handlers.

use bevy::math::Vec3;
use serde::Deserialize;
use crate::core::pending::scene::{
    queue_scene_export_from_bridge, queue_scene_load_from_bridge, queue_new_scene_from_bridge,
    queue_gltf_import_from_bridge, queue_texture_load_from_bridge, queue_place_asset_from_bridge,
    queue_delete_asset_from_bridge, queue_remove_texture_from_bridge,
    SceneLoadRequest, GltfImportRequest, TextureLoadRequest, RemoveTextureRequest,
    PlaceAssetRequest, DeleteAssetRequest,
};
use crate::core::pending::audio::{
    queue_script_update_from_bridge, queue_script_removal_from_bridge,
    ScriptUpdate, ScriptRemoval,
};
use crate::core::pending_commands::QueryRequest;

/// Dispatch scene and asset commands.
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "export_scene" => Some(handle_export_scene(payload.clone())),
        "load_scene" => Some(handle_load_scene(payload.clone())),
        "new_scene" => Some(handle_new_scene(payload.clone())),
        "import_gltf" => Some(handle_import_gltf(payload.clone())),
        "load_texture" => Some(handle_load_texture(payload.clone())),
        "remove_texture" => Some(handle_remove_texture(payload.clone())),
        "place_asset" => Some(handle_place_asset(payload.clone())),
        "delete_asset" => Some(handle_delete_asset(payload.clone())),
        "list_assets" => Some(super::handle_query(QueryRequest::AssetList)),
        "set_script" => Some(handle_set_script(payload.clone())),
        "remove_script" => Some(handle_remove_script(payload.clone())),
        "get_script" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(super::handle_query(QueryRequest::ScriptData { entity_id }))
        }
        "list_script_templates" => Some(super::handle_query(QueryRequest::ScriptTemplates)),
        "apply_script_template" => Some(handle_apply_script_template(payload.clone())),
        _ => None,
    }
}

// ===== Handler Functions =====

/// Handle export_scene command — triggers scene serialization + event.
fn handle_export_scene(_payload: serde_json::Value) -> super::CommandResult {
    if queue_scene_export_from_bridge() {
        tracing::info!("Queued scene export");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle load_scene command — receives JSON, queues full scene load.
fn handle_load_scene(payload: serde_json::Value) -> super::CommandResult {
    let json = payload.get("json")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'json' field in load_scene payload")?
        .to_string();

    if queue_scene_load_from_bridge(SceneLoadRequest { json }) {
        tracing::info!("Queued scene load");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle new_scene command — clears everything to defaults.
fn handle_new_scene(_payload: serde_json::Value) -> super::CommandResult {
    if queue_new_scene_from_bridge() {
        tracing::info!("Queued new scene");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for import_gltf command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportGltfPayload {
    data: String,
    name: String,
    position: Option<[f32; 3]>,
}

/// Handle import_gltf command.
fn handle_import_gltf(payload: serde_json::Value) -> super::CommandResult {
    let data: ImportGltfPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid import_gltf payload: {}", e))?;

    let request = GltfImportRequest {
        data_base64: data.data,
        name: data.name.clone(),
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_gltf_import_from_bridge(request) {
        tracing::info!("Queued glTF import: {}", data.name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for load_texture command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTexturePayload {
    data: String,
    name: String,
    entity_id: String,
    slot: String,
}

/// Handle load_texture command.
fn handle_load_texture(payload: serde_json::Value) -> super::CommandResult {
    let data: LoadTexturePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid load_texture payload: {}", e))?;

    let request = TextureLoadRequest {
        data_base64: data.data,
        name: data.name.clone(),
        entity_id: data.entity_id.clone(),
        slot: data.slot,
    };

    if queue_texture_load_from_bridge(request) {
        tracing::info!("Queued texture load for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for remove_texture command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveTexturePayload {
    entity_id: String,
    slot: String,
}

/// Handle remove_texture command.
fn handle_remove_texture(payload: serde_json::Value) -> super::CommandResult {
    let data: RemoveTexturePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid remove_texture payload: {}", e))?;

    let request = RemoveTextureRequest {
        entity_id: data.entity_id.clone(),
        slot: data.slot,
    };

    if queue_remove_texture_from_bridge(request) {
        tracing::info!("Queued texture removal for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for place_asset command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceAssetPayload {
    asset_id: String,
    position: Option<[f32; 3]>,
}

/// Handle place_asset command.
fn handle_place_asset(payload: serde_json::Value) -> super::CommandResult {
    let data: PlaceAssetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid place_asset payload: {}", e))?;

    let request = PlaceAssetRequest {
        asset_id: data.asset_id.clone(),
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_place_asset_from_bridge(request) {
        tracing::info!("Queued place asset: {}", data.asset_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for delete_asset command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteAssetPayload {
    asset_id: String,
}

/// Handle delete_asset command.
fn handle_delete_asset(payload: serde_json::Value) -> super::CommandResult {
    let data: DeleteAssetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid delete_asset payload: {}", e))?;

    let request = DeleteAssetRequest {
        asset_id: data.asset_id.clone(),
    };

    if queue_delete_asset_from_bridge(request) {
        tracing::info!("Queued asset deletion: {}", data.asset_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_script command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetScriptPayload {
    entity_id: String,
    source: String,
    #[serde(default = "super::default_true")]
    enabled: bool,
    template: Option<String>,
}

/// Handle set_script command.
fn handle_set_script(payload: serde_json::Value) -> super::CommandResult {
    let data: SetScriptPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_script payload: {}", e))?;

    let update = ScriptUpdate {
        entity_id: data.entity_id.clone(),
        source: data.source,
        enabled: data.enabled,
        template: data.template,
    };

    if queue_script_update_from_bridge(update) {
        tracing::info!("Queued script update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_script command.
fn handle_remove_script(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = ScriptRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_script_removal_from_bridge(removal) {
        tracing::info!("Queued script removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_script_template command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyScriptTemplatePayload {
    entity_id: String,
    template: String,
    #[serde(default)]
    source: String,
}

/// Handle apply_script_template command.
fn handle_apply_script_template(payload: serde_json::Value) -> super::CommandResult {
    let data: ApplyScriptTemplatePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_script_template payload: {}", e))?;

    let update = ScriptUpdate {
        entity_id: data.entity_id.clone(),
        source: data.source,
        enabled: true,
        template: Some(data.template.clone()),
    };

    if queue_script_update_from_bridge(update) {
        tracing::info!("Queued script template '{}' for entity: {}", data.template, data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
