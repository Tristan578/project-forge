//! Scene, asset, and script command handlers.

use bevy::math::Vec3;
use serde::Deserialize;
use crate::core::pending::scene::{
    queue_scene_export_from_bridge, queue_scene_load_from_bridge, queue_new_scene_from_bridge,
    queue_gltf_import_from_bridge, queue_texture_load_from_bridge, queue_place_asset_from_bridge,
    queue_delete_asset_from_bridge, queue_remove_texture_from_bridge, queue_audio_import_from_bridge,
    SceneLoadRequest, GltfImportRequest, TextureLoadRequest, RemoveTextureRequest,
    PlaceAssetRequest, DeleteAssetRequest, AudioImportRequest,
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
        "import_audio" => Some(handle_import_audio(payload.clone())),
        "list_assets" => Some(super::handle_query(QueryRequest::AssetList)),
        "set_script" => Some(handle_set_script(payload.clone())),
        "remove_script" => Some(handle_remove_script(payload.clone())),
        "get_script" => {
            let result = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|id| super::handle_query(QueryRequest::ScriptData { entity_id: id.to_string() }))
                .unwrap_or_else(|| Err("Missing entityId".to_string()));
            Some(result)
        }
        "list_script_templates" => Some(super::handle_query(QueryRequest::ScriptTemplates)),
        "apply_script_template" => Some(handle_apply_script_template(payload.clone())),
        "query_play_state" => Some(super::handle_query(QueryRequest::PlayState)),
        // Multi-scene management stubs (scene management handled JS-side)
        "list_scenes" => Some(Err("Not yet implemented: list_scenes".to_string())),
        "create_scene" => Some(Err("Not yet implemented: create_scene".to_string())),
        "switch_scene" => Some(Err("Not yet implemented: switch_scene".to_string())),
        "delete_scene" => Some(Err("Not yet implemented: delete_scene".to_string())),
        "duplicate_scene" => Some(Err("Not yet implemented: duplicate_scene".to_string())),
        "rename_scene" => Some(Err("Not yet implemented: rename_scene".to_string())),
        "export_scene_json" => Some(handle_export_scene(payload.clone())),
        "import_scene_json" => Some(handle_load_scene(payload.clone())),
        "save_scene" => Some(Err("Not yet implemented: save_scene".to_string())),
        "get_scene_info" => Some(Err("Not yet implemented: get_scene_info".to_string())),
        "list_scene_assets" => Some(super::handle_query(QueryRequest::AssetList)),

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
    data_base64: String,
    name: String,
    position: Option<[f32; 3]>,
}

/// Handle import_gltf command.
fn handle_import_gltf(payload: serde_json::Value) -> super::CommandResult {
    let data: ImportGltfPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid import_gltf payload: {}", e))?;

    let request = GltfImportRequest {
        data_base64: data.data_base64,
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

/// Payload for import_audio command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAudioPayload {
    name: String,
}

/// Handle import_audio command — registers audio asset in the AssetRegistry.
/// Audio playback is handled JS-side (Web Audio API); the engine tracks metadata only.
fn handle_import_audio(payload: serde_json::Value) -> super::CommandResult {
    let data: ImportAudioPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid import_audio payload: {}", e))?;

    let request = AudioImportRequest {
        data_base64: String::new(), // Audio data stays JS-side; engine only tracks metadata
        name: data.name.clone(),
    };

    if queue_audio_import_from_bridge(request) {
        tracing::info!("Queued audio import: {}", data.name);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(command: &str, payload: serde_json::Value) -> Result<(), String> {
        dispatch(command, &payload).expect("scene dispatch returned None for known command")
    }

    // === export_scene ===

    #[test]
    fn export_scene_accepts_any_payload() {
        let result = run("export_scene", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === load_scene ===

    #[test]
    fn load_scene_accepts_valid_json_field() {
        let result = run("load_scene", json!({
            "json": "{\"entities\":[]}"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn load_scene_rejects_missing_json_field() {
        let result = run("load_scene", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("json") || err.contains("Missing"),
            "Expected missing json field error, got: {}",
            err
        );
    }

    #[test]
    fn load_scene_accepts_complex_scene_json() {
        let result = run("load_scene", json!({
            "json": "{\"entities\":[{\"id\":\"e1\",\"name\":\"Cube\",\"type\":\"cube\"}]}"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === new_scene ===

    #[test]
    fn new_scene_accepts_any_payload() {
        let result = run("new_scene", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === import_gltf ===

    #[test]
    fn import_gltf_accepts_valid_payload() {
        let result = run("import_gltf", json!({
            "dataBase64": "SGVsbG8=",
            "name": "my_model.glb"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn import_gltf_rejects_missing_name() {
        let result = run("import_gltf", json!({
            "dataBase64": "SGVsbG8="
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("name") || err.contains("Invalid"),
            "Expected parse error for missing name, got: {}",
            err
        );
    }

    #[test]
    fn import_gltf_rejects_missing_data_base64() {
        let result = run("import_gltf", json!({"name": "model.glb"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("data_base64") || err.contains("dataBase64") || err.contains("Invalid"),
            "Expected parse error for missing dataBase64, got: {}",
            err
        );
    }

    // === set_script ===

    #[test]
    fn set_script_accepts_valid_payload() {
        let result = run("set_script", json!({
            "entityId": "entity-1",
            "source": "console.log('hello');"
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_script_enabled_defaults_to_true() {
        // enabled has default = true, so it's optional
        let result = run("set_script", json!({
            "entityId": "entity-1",
            "source": ""
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn set_script_rejects_missing_entity_id() {
        let result = run("set_script", json!({"source": "code"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entity_id") || err.contains("entityId") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    #[test]
    fn set_script_rejects_missing_source() {
        let result = run("set_script", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("source") || err.contains("Invalid"),
            "Expected parse error for missing source, got: {}",
            err
        );
    }

    // === remove_script ===

    #[test]
    fn remove_script_accepts_valid_entity_id() {
        let result = run("remove_script", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn remove_script_rejects_missing_entity_id() {
        let result = run("remove_script", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityId") || err.contains("Missing"),
            "Expected missing entityId error, got: {}",
            err
        );
    }

    // === place_asset ===

    #[test]
    fn place_asset_accepts_asset_id_without_position() {
        let result = run("place_asset", json!({"assetId": "asset-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[test]
    fn place_asset_accepts_position() {
        let result = run("place_asset", json!({
            "assetId": "asset-1",
            "position": [1.0, 0.0, 2.0]
        }));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === delete_asset ===

    #[test]
    fn delete_asset_accepts_valid_asset_id() {
        let result = run("delete_asset", json!({"assetId": "asset-1"}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === list_assets (query) ===

    #[test]
    fn list_assets_queues_query() {
        let result = run("list_assets", json!({}));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    // === dispatch returns None for unknown commands ===

    #[test]
    fn dispatch_returns_none_for_unknown_command() {
        let result = dispatch("definitely_not_scene", &json!({}));
        assert!(result.is_none(), "Unknown command should return None");
    }
}
