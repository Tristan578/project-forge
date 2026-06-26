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
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(super::handle_query(QueryRequest::ScriptData { entity_id }))
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
    /// Optional existing entity to replace in-place. When present (and valid),
    /// the glTF model is attached to that entity instead of spawning a new root,
    /// preserving its EntityId / Transform / name / selection. The rest of the
    /// codebase (textures, audio, job records) keys this as `targetEntityId`, so
    /// the JSON key is pinned explicitly rather than relying on camelCase mapping.
    #[serde(rename = "targetEntityId")]
    target_entity_id: Option<String>,
}

/// Handle import_gltf command.
fn handle_import_gltf(payload: serde_json::Value) -> super::CommandResult {
    let data: ImportGltfPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid import_gltf payload: {}", e))?;

    let request = GltfImportRequest {
        data_base64: data.data_base64,
        name: data.name.clone(),
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
        target_entity_id: data.target_entity_id,
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

    /// Initialize a real `PendingCommands`, register it for bridge access, run
    /// `command`, and return the populated queue so a test can inspect exactly
    /// what was enqueued. Unlike `run` (which deliberately leaves the queue
    /// uninitialized and only proves parsing via the "not initialized" error),
    /// this drives the request all the way into the queue and asserts the
    /// dispatch reported success.
    fn run_with_queue(
        command: &str,
        payload: serde_json::Value,
    ) -> crate::core::pending::PendingCommands {
        let mut pending = crate::core::pending::PendingCommands::default();
        crate::core::pending::register_pending_commands(&mut pending as *mut _);
        let result = dispatch(command, &payload)
            .expect("scene dispatch returned None for known command");
        // With the queue registered, the command must succeed (no "not initialized").
        assert!(
            result.is_ok(),
            "expected {} to queue successfully, got: {:?}",
            command,
            result
        );
        pending
    }

    #[test]
    fn import_gltf_queues_target_entity_id() {
        // The replace-in-place contract: a payload carrying targetEntityId must
        // queue a GltfImportRequest whose target_entity_id == Some(<provided id>).
        // Pre-fix code dropped this field on the floor, so this assertion FAILS
        // pre-fix (target_entity_id would be None) and passes post-fix.
        let pending = run_with_queue("import_gltf", json!({
            "dataBase64": "SGVsbG8=",
            "name": "my_model.glb",
            "targetEntityId": "entity-42"
        }));

        assert_eq!(
            pending.gltf_import_requests.len(),
            1,
            "exactly one glTF import should be queued"
        );
        let request = &pending.gltf_import_requests[0];
        assert_eq!(
            request.target_entity_id.as_deref(),
            Some("entity-42"),
            "targetEntityId must be carried through to the queued request"
        );
        // Sanity-check the rest of the payload survived too.
        assert_eq!(request.name, "my_model.glb");
        assert_eq!(request.data_base64, "SGVsbG8=");
    }

    #[test]
    fn import_gltf_target_entity_id_defaults_to_none() {
        // Negative/normalization case: an absent targetEntityId yields
        // target_entity_id == None (engine-generated fallback — a new root entity
        // is spawned rather than replacing an existing one).
        let pending = run_with_queue("import_gltf", json!({
            "dataBase64": "SGVsbG8=",
            "name": "my_model.glb"
        }));

        assert_eq!(pending.gltf_import_requests.len(), 1);
        assert_eq!(
            pending.gltf_import_requests[0].target_entity_id, None,
            "absent targetEntityId must normalize to None (new-root fallback)"
        );
    }

    #[test]
    fn import_gltf_null_target_entity_id_normalizes_to_none() {
        // A malformed/explicit-null targetEntityId must also fall back to None
        // rather than failing the parse, so the replace-in-place validation path
        // degrades to spawning a new root entity.
        let pending = run_with_queue("import_gltf", json!({
            "dataBase64": "SGVsbG8=",
            "name": "my_model.glb",
            "targetEntityId": serde_json::Value::Null
        }));

        assert_eq!(pending.gltf_import_requests.len(), 1);
        assert_eq!(
            pending.gltf_import_requests[0].target_entity_id, None,
            "null targetEntityId must normalize to None, not fail the parse"
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
