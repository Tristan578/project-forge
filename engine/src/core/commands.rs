//! Command handling - pure Rust logic for processing commands from the frontend.

use bevy::math::{Quat, Vec3, EulerRot};
use serde::{Deserialize, Serialize};
use super::camera_presets::CameraPreset;
use super::gizmo::CoordinateMode;
use super::lighting::LightData;
use super::material::MaterialData;
use super::input::{ActionDef, ActionType, InputPreset, InputSource};
use super::particles::ParticleData as CoreParticleData;
use super::physics::PhysicsData;
use super::post_processing::{
    BloomSettings, ChromaticAberrationSettings, ColorGradingSettings, SharpeningSettings,
};
use super::pending_commands::{
    queue_transform_update_from_bridge, queue_rename_from_bridge, queue_camera_focus_from_bridge,
    queue_spawn_from_bridge, queue_delete_from_bridge, queue_duplicate_from_bridge,
    queue_reparent_from_bridge, queue_snap_settings_update_from_bridge, queue_grid_toggle_from_bridge,
    queue_camera_preset_from_bridge, queue_coordinate_mode_update_from_bridge,
    queue_material_update_from_bridge, queue_light_update_from_bridge,
    queue_ambient_light_update_from_bridge, queue_environment_update_from_bridge,
    queue_input_binding_update_from_bridge, queue_input_preset_from_bridge,
    queue_input_binding_removal_from_bridge,
    queue_physics_update_from_bridge, queue_physics_toggle_from_bridge,
    queue_debug_physics_toggle_from_bridge, queue_force_application_from_bridge,
    queue_scene_export_from_bridge, queue_scene_load_from_bridge, queue_new_scene_from_bridge,
    queue_gltf_import_from_bridge, queue_texture_load_from_bridge,
    queue_place_asset_from_bridge, queue_delete_asset_from_bridge,
    queue_remove_texture_from_bridge,
    queue_script_update_from_bridge, queue_script_removal_from_bridge,
    queue_audio_update_from_bridge, queue_audio_removal_from_bridge, queue_audio_playback_from_bridge,
    queue_audio_bus_update_from_bridge, queue_audio_bus_create_from_bridge,
    queue_audio_bus_delete_from_bridge, queue_audio_bus_effects_update_from_bridge,
    queue_post_processing_update_from_bridge,
    queue_particle_update_from_bridge, queue_particle_toggle_from_bridge,
    queue_particle_removal_from_bridge, queue_particle_preset_from_bridge,
    queue_particle_playback_from_bridge,
    queue_animation_request_from_bridge,
    AnimationRequest, AnimationAction,
    TransformUpdate, RenameRequest, CameraFocusRequest, SpawnRequest, DeleteRequest, DuplicateRequest,
    ReparentRequest, SnapSettingsUpdate, CameraPresetRequest, MaterialUpdate, LightUpdate,
    AmbientLightUpdate, EnvironmentUpdate, PostProcessingUpdate, EntityType, SceneLoadRequest,
    InputBindingUpdate, InputPresetRequest, InputBindingRemoval,
    PhysicsUpdate, PhysicsToggle, ForceApplication,
    GltfImportRequest, TextureLoadRequest, PlaceAssetRequest, DeleteAssetRequest, RemoveTextureRequest,
    ScriptUpdate, ScriptRemoval,
    AudioUpdate, AudioRemoval, AudioPlayback,
    AudioBusUpdate, AudioBusCreate, AudioBusDelete, AudioBusEffectsUpdate,
    ParticleUpdate, ParticleToggle, ParticleRemoval, ParticlePresetRequest, ParticlePlayback,
};
use super::engine_mode::ModeChangeRequest;
use super::history::{queue_undo_from_bridge, queue_redo_from_bridge};
use super::pending_commands::{QueryRequest, queue_query_from_bridge, queue_mode_change_from_bridge};
use super::viewport::{self, ResizePayload};

/// Result type for command execution
pub type CommandResult = Result<(), String>;

/// Response structure sent back to JavaScript.
#[derive(Debug, Serialize)]
pub struct CommandResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CommandResponse {
    pub fn ok() -> Self {
        Self { success: true, error: None }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self { success: false, error: Some(message.into()) }
    }
}

/// Dispatch a command to the appropriate handler
pub fn dispatch(command: &str, payload: serde_json::Value) -> CommandResult {
    match command {
        "resize" => handle_resize(payload),
        "update_scene" => handle_update_scene(payload),
        "spawn_entity" => handle_spawn_entity(payload),
        "despawn_entity" => handle_despawn_entity(payload),
        "update_transform" => handle_update_transform(payload),
        "set_camera" => handle_set_camera(payload),
        "select_entity" => handle_select_entity(payload),
        "select_entities" => handle_select_entities(payload),
        "clear_selection" => handle_clear_selection(payload),
        "set_visibility" => handle_set_visibility(payload),
        "set_gizmo_mode" => handle_set_gizmo_mode(payload),
        "set_coordinate_mode" => handle_set_coordinate_mode(payload),
        "rename_entity" => handle_rename_entity(payload),
        "reparent_entity" => handle_reparent_entity(payload),
        "focus_camera" => handle_focus_camera(payload),
        "delete_entities" => handle_delete_entities(payload),
        "duplicate_entity" => handle_duplicate_entity(payload),
        "undo" => handle_undo(payload),
        "redo" => handle_redo(payload),
        "set_snap_settings" => handle_set_snap_settings(payload),
        "toggle_grid" => handle_toggle_grid(payload),
        "set_camera_preset" => handle_set_camera_preset(payload),
        "update_material" => handle_update_material(payload),
        "update_light" => handle_update_light(payload),
        "update_ambient_light" => handle_update_ambient_light(payload),
        "update_environment" => handle_update_environment(payload),
        "update_post_processing" => handle_update_post_processing(payload),
        "get_post_processing" => handle_query(QueryRequest::PostProcessingState),
        // Mode commands (play/stop/pause/resume)
        "play" => handle_mode_change(ModeChangeRequest::Play),
        "stop" => handle_mode_change(ModeChangeRequest::Stop),
        "pause" => handle_mode_change(ModeChangeRequest::Pause),
        "resume" => handle_mode_change(ModeChangeRequest::Resume),
        "get_mode" => handle_query(QueryRequest::EngineMode),
        // Input binding commands
        "set_input_binding" => handle_set_input_binding(payload),
        "remove_input_binding" => handle_remove_input_binding(payload),
        "set_input_preset" => handle_set_input_preset(payload),
        "get_input_bindings" => handle_query(QueryRequest::InputBindings),
        "get_input_state" => handle_query(QueryRequest::InputState),
        // Physics commands
        "update_physics" => handle_update_physics(payload),
        "toggle_physics" => handle_toggle_physics(payload),
        "toggle_debug_physics" => handle_toggle_debug_physics(payload),
        "get_physics" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::PhysicsState { entity_id })
        },
        "apply_force" => handle_apply_force(payload),
        // Scene save/load commands
        "export_scene" => handle_export_scene(payload),
        "load_scene" => handle_load_scene(payload),
        "new_scene" => handle_new_scene(payload),
        // Asset commands
        "import_gltf" => handle_import_gltf(payload),
        "load_texture" => handle_load_texture(payload),
        "remove_texture" => handle_remove_texture(payload),
        "place_asset" => handle_place_asset(payload),
        "delete_asset" => handle_delete_asset(payload),
        "list_assets" => handle_query(QueryRequest::AssetList),
        // Script commands
        "set_script" => handle_set_script(payload),
        "remove_script" => handle_remove_script(payload),
        "get_script" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::ScriptData { entity_id })
        },
        "list_script_templates" => handle_query(QueryRequest::ScriptTemplates),
        "apply_script_template" => handle_apply_script_template(payload),
        // Audio commands
        "set_audio" => handle_set_audio(payload),
        "remove_audio" => handle_remove_audio(payload),
        "play_audio" => handle_play_audio(payload),
        "stop_audio" => handle_stop_audio(payload),
        "pause_audio" => handle_pause_audio(payload),
        "get_audio" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::AudioData { entity_id })
        },
        // Audio bus commands
        "update_audio_bus" => handle_update_audio_bus(payload),
        "create_audio_bus" => handle_create_audio_bus(payload),
        "delete_audio_bus" => handle_delete_audio_bus(payload),
        "get_audio_buses" => handle_query(QueryRequest::AudioBuses),
        "set_bus_effects" => handle_set_bus_effects(payload),
        // Particle commands
        "set_particle" => handle_set_particle(payload),
        "remove_particle" => handle_remove_particle(payload),
        "toggle_particle" => handle_toggle_particle(payload),
        "set_particle_preset" => handle_set_particle_preset(payload),
        "play_particle" => handle_play_particle(payload),
        "stop_particle" => handle_stop_particle(payload),
        "burst_particle" => handle_burst_particle(payload),
        "get_particle" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::ParticleState { entity_id })
        },
        // Animation commands
        "play_animation" => handle_play_animation(payload),
        "pause_animation" => handle_pause_animation(payload),
        "resume_animation" => handle_resume_animation(payload),
        "stop_animation" => handle_stop_animation(payload),
        "seek_animation" => handle_seek_animation(payload),
        "set_animation_speed" => handle_set_animation_speed(payload),
        "set_animation_loop" => handle_set_animation_loop(payload),
        "get_animation_state" | "list_animations" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::AnimationState { entity_id })
        },
        // Query commands (MCP resources)
        "get_scene_graph" => handle_query(QueryRequest::SceneGraph),
        "get_selection" => handle_query(QueryRequest::Selection),
        "get_entity_details" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::EntityDetails { entity_id })
        },
        "get_camera_state" => handle_query(QueryRequest::CameraState),
        _ => Err(format!("Unknown command: {}", command)),
    }
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
fn handle_update_scene(payload: serde_json::Value) -> CommandResult {
    // TODO: Parse scene graph and update Bevy world
    tracing::info!("Updating scene: {:?}", payload);
    Ok(())
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

    // TODO: Remove entity from Bevy ECS
    tracing::info!("Despawning entity: {}", entity_id);
    Ok(())
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
fn handle_set_camera(payload: serde_json::Value) -> CommandResult {
    // TODO: Update camera in Bevy ECS
    tracing::info!("Setting camera: {:?}", payload);
    Ok(())
}

/// Select a single entity by ID.
/// Payload: { entityId: string, mode: 'replace' | 'add' | 'toggle' }
fn handle_select_entity(payload: serde_json::Value) -> CommandResult {
    use super::pending_commands::{SelectionRequest, SelectionMode, queue_selection_from_bridge};

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

    tracing::info!("Select entities: {:?} (mode: {})", entity_ids, mode);

    // TODO: Queue a batch selection command event
    Ok(())
}

/// Clear all selection.
fn handle_clear_selection(_payload: serde_json::Value) -> CommandResult {
    tracing::info!("Clear selection");

    // TODO: Queue a clear selection command event
    Ok(())
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

    tracing::info!("Set visibility: {} = {}", entity_id, visible);

    // TODO: Queue a visibility command event for the visibility system to process
    Ok(())
}

/// Set gizmo mode.
/// Payload: { mode: 'translate' | 'rotate' | 'scale' }
fn handle_set_gizmo_mode(payload: serde_json::Value) -> CommandResult {
    let mode = payload.get("mode")
        .and_then(|v| v.as_str())
        .ok_or("Missing mode")?;

    tracing::info!("Set gizmo mode: {}", mode);

    // Note: The actual mode change is handled via a queued event
    // that the gizmo system will process in the next frame.
    // For now, we just validate the mode string.
    match mode {
        "translate" | "rotate" | "scale" => Ok(()),
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

/// Payload for update_material command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMaterialPayload {
    entity_id: String,
    base_color: Option<[f32; 4]>,
    metallic: Option<f32>,
    perceptual_roughness: Option<f32>,
    reflectance: Option<f32>,
    emissive: Option<[f32; 4]>,
    emissive_exposure_weight: Option<f32>,
    alpha_mode: Option<String>,
    alpha_cutoff: Option<f32>,
    double_sided: Option<bool>,
    unlit: Option<bool>,
}

/// Handle update_material command from React.
/// Accepts partial updates — only provided fields are changed.
fn handle_update_material(payload: serde_json::Value) -> CommandResult {
    let data: UpdateMaterialPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_material payload: {}", e))?;

    // Build a MaterialData with defaults, then overlay provided fields.
    // The apply system will merge this with the existing component.
    let mut mat = MaterialData::default();
    if let Some(v) = data.base_color { mat.base_color = v; }
    if let Some(v) = data.metallic { mat.metallic = v; }
    if let Some(v) = data.perceptual_roughness { mat.perceptual_roughness = v; }
    if let Some(v) = data.reflectance { mat.reflectance = v; }
    if let Some(v) = data.emissive { mat.emissive = v; }
    if let Some(v) = data.emissive_exposure_weight { mat.emissive_exposure_weight = v; }
    if let Some(ref v) = data.alpha_mode {
        mat.alpha_mode = match v.as_str() {
            "blend" => super::material::MaterialAlphaMode::Blend,
            "mask" => super::material::MaterialAlphaMode::Mask,
            _ => super::material::MaterialAlphaMode::Opaque,
        };
    }
    if let Some(v) = data.alpha_cutoff { mat.alpha_cutoff = v; }
    if let Some(v) = data.double_sided { mat.double_sided = v; }
    if let Some(v) = data.unlit { mat.unlit = v; }

    let update = MaterialUpdate {
        entity_id: data.entity_id.clone(),
        material_data: mat,
    };

    if queue_material_update_from_bridge(update) {
        tracing::info!("Queued material update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_light command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateLightPayload {
    entity_id: String,
    color: Option<[f32; 3]>,
    intensity: Option<f32>,
    shadows_enabled: Option<bool>,
    shadow_depth_bias: Option<f32>,
    shadow_normal_bias: Option<f32>,
    range: Option<f32>,
    radius: Option<f32>,
    inner_angle: Option<f32>,
    outer_angle: Option<f32>,
}

/// Handle update_light command from React.
/// Accepts partial updates — the apply system merges with existing LightData.
fn handle_update_light(payload: serde_json::Value) -> CommandResult {
    let data: UpdateLightPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_light payload: {}", e))?;

    // Build a LightData with point defaults, then overlay provided fields.
    // The actual light_type will be read from the entity's existing LightData.
    let mut light = LightData::point();
    if let Some(v) = data.color { light.color = v; }
    if let Some(v) = data.intensity { light.intensity = v; }
    if let Some(v) = data.shadows_enabled { light.shadows_enabled = v; }
    if let Some(v) = data.shadow_depth_bias { light.shadow_depth_bias = v; }
    if let Some(v) = data.shadow_normal_bias { light.shadow_normal_bias = v; }
    if let Some(v) = data.range { light.range = v; }
    if let Some(v) = data.radius { light.radius = v; }
    if let Some(v) = data.inner_angle { light.inner_angle = v; }
    if let Some(v) = data.outer_angle { light.outer_angle = v; }

    let update = LightUpdate {
        entity_id: data.entity_id.clone(),
        light_data: light,
    };

    if queue_light_update_from_bridge(update) {
        tracing::info!("Queued light update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_ambient_light command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAmbientLightPayload {
    color: Option<[f32; 3]>,
    brightness: Option<f32>,
}

/// Handle update_ambient_light command from React.
fn handle_update_ambient_light(payload: serde_json::Value) -> CommandResult {
    let data: UpdateAmbientLightPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_ambient_light payload: {}", e))?;

    let update = AmbientLightUpdate {
        color: data.color,
        brightness: data.brightness,
    };

    if queue_ambient_light_update_from_bridge(update) {
        tracing::info!("Queued ambient light update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_environment command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateEnvironmentPayload {
    skybox_brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    ibl_rotation_degrees: Option<f32>,
    clear_color: Option<[f32; 3]>,
    fog_enabled: Option<bool>,
    fog_color: Option<[f32; 3]>,
    fog_start: Option<f32>,
    fog_end: Option<f32>,
}

/// Handle update_environment command from React.
fn handle_update_environment(payload: serde_json::Value) -> CommandResult {
    let data: UpdateEnvironmentPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_environment payload: {}", e))?;

    let update = EnvironmentUpdate {
        skybox_brightness: data.skybox_brightness,
        ibl_intensity: data.ibl_intensity,
        ibl_rotation_degrees: data.ibl_rotation_degrees,
        clear_color: data.clear_color,
        fog_enabled: data.fog_enabled,
        fog_color: data.fog_color,
        fog_start: data.fog_start,
        fog_end: data.fog_end,
    };

    if queue_environment_update_from_bridge(update) {
        tracing::info!("Queued environment update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostProcessingPayload {
    bloom: Option<BloomSettings>,
    chromatic_aberration: Option<ChromaticAberrationSettings>,
    color_grading: Option<ColorGradingSettings>,
    sharpening: Option<SharpeningSettings>,
}

fn handle_update_post_processing(payload: serde_json::Value) -> CommandResult {
    let data: UpdatePostProcessingPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_post_processing payload: {}", e))?;

    let update = PostProcessingUpdate {
        bloom: data.bloom,
        chromatic_aberration: data.chromatic_aberration,
        color_grading: data.color_grading,
        sharpening: data.sharpening,
    };

    if queue_post_processing_update_from_bridge(update) {
        tracing::info!("Queued post-processing update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle a query command by queuing it for the next frame's Bevy system to process.
fn handle_query(request: QueryRequest) -> CommandResult {
    if queue_query_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle a mode change command (play/stop/pause/resume).
fn handle_mode_change(request: ModeChangeRequest) -> CommandResult {
    if queue_mode_change_from_bridge(request) {
        tracing::info!("Queued mode change: {:?}", request);
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

/// Payload for update_physics command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePhysicsPayload {
    entity_id: String,
    #[serde(flatten)]
    physics_data: PhysicsData,
}

/// Handle update_physics command.
fn handle_update_physics(payload: serde_json::Value) -> CommandResult {
    let data: UpdatePhysicsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_physics payload: {}", e))?;

    let update = PhysicsUpdate {
        entity_id: data.entity_id.clone(),
        physics_data: data.physics_data,
    };

    if queue_physics_update_from_bridge(update) {
        tracing::info!("Queued physics update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for toggle_physics command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TogglePhysicsPayload {
    entity_id: String,
    enabled: bool,
}

/// Handle toggle_physics command.
fn handle_toggle_physics(payload: serde_json::Value) -> CommandResult {
    let data: TogglePhysicsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid toggle_physics payload: {}", e))?;

    let toggle = PhysicsToggle {
        entity_id: data.entity_id.clone(),
        enabled: data.enabled,
    };

    if queue_physics_toggle_from_bridge(toggle) {
        tracing::info!("Queued physics toggle for entity: {} -> {}", data.entity_id, data.enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle toggle_debug_physics command.
fn handle_toggle_debug_physics(_payload: serde_json::Value) -> CommandResult {
    if queue_debug_physics_toggle_from_bridge() {
        tracing::info!("Queued debug physics toggle");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_force command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyForcePayload {
    entity_id: String,
    #[serde(default)]
    force: [f32; 3],
    #[serde(default)]
    torque: [f32; 3],
    #[serde(default)]
    is_impulse: bool,
}

/// Handle apply_force command (Play mode only).
fn handle_apply_force(payload: serde_json::Value) -> CommandResult {
    let data: ApplyForcePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_force payload: {}", e))?;

    let application = ForceApplication {
        entity_id: data.entity_id.clone(),
        force: data.force,
        torque: data.torque,
        is_impulse: data.is_impulse,
    };

    if queue_force_application_from_bridge(application) {
        tracing::info!("Queued force application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle export_scene command — triggers scene serialization + event.
fn handle_export_scene(_payload: serde_json::Value) -> CommandResult {
    if queue_scene_export_from_bridge() {
        tracing::info!("Queued scene export");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle load_scene command — receives JSON, queues full scene load.
fn handle_load_scene(payload: serde_json::Value) -> CommandResult {
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
fn handle_new_scene(_payload: serde_json::Value) -> CommandResult {
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
fn handle_import_gltf(payload: serde_json::Value) -> CommandResult {
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
fn handle_load_texture(payload: serde_json::Value) -> CommandResult {
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
fn handle_remove_texture(payload: serde_json::Value) -> CommandResult {
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
fn handle_place_asset(payload: serde_json::Value) -> CommandResult {
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
fn handle_delete_asset(payload: serde_json::Value) -> CommandResult {
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
    #[serde(default = "default_true")]
    enabled: bool,
    template: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Handle set_script command.
fn handle_set_script(payload: serde_json::Value) -> CommandResult {
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
fn handle_remove_script(payload: serde_json::Value) -> CommandResult {
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
fn handle_apply_script_template(payload: serde_json::Value) -> CommandResult {
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

// ---------------------------------------------------------------------------
// Audio handlers
// ---------------------------------------------------------------------------

/// Payload for set_audio command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetAudioPayload {
    entity_id: String,
    asset_id: Option<String>,
    volume: Option<f32>,
    pitch: Option<f32>,
    loop_audio: Option<bool>,
    spatial: Option<bool>,
    max_distance: Option<f32>,
    ref_distance: Option<f32>,
    rolloff_factor: Option<f32>,
    autoplay: Option<bool>,
}

/// Handle set_audio command.
fn handle_set_audio(payload: serde_json::Value) -> CommandResult {
    let data: SetAudioPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_audio payload: {}", e))?;

    let update = AudioUpdate {
        entity_id: data.entity_id.clone(),
        asset_id: data.asset_id,
        volume: data.volume,
        pitch: data.pitch,
        loop_audio: data.loop_audio,
        spatial: data.spatial,
        max_distance: data.max_distance,
        ref_distance: data.ref_distance,
        rolloff_factor: data.rolloff_factor,
        autoplay: data.autoplay,
    };

    if queue_audio_update_from_bridge(update) {
        tracing::info!("Queued audio update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_audio command.
fn handle_remove_audio(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = AudioRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_audio_removal_from_bridge(removal) {
        tracing::info!("Queued audio removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle play_audio command.
fn handle_play_audio(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let playback = AudioPlayback {
        entity_id: entity_id.clone(),
        action: "play".to_string(),
    };

    if queue_audio_playback_from_bridge(playback) {
        tracing::info!("Queued audio play for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle stop_audio command.
fn handle_stop_audio(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let playback = AudioPlayback {
        entity_id: entity_id.clone(),
        action: "stop".to_string(),
    };

    if queue_audio_playback_from_bridge(playback) {
        tracing::info!("Queued audio stop for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle pause_audio command.
fn handle_pause_audio(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let playback = AudioPlayback {
        entity_id: entity_id.clone(),
        action: "pause".to_string(),
    };

    if queue_audio_playback_from_bridge(playback) {
        tracing::info!("Queued audio pause for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ---------------------------------------------------------------------------
// Audio bus handlers
// ---------------------------------------------------------------------------

/// Payload for update_audio_bus command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAudioBusPayload {
    bus_name: String,
    volume: Option<f32>,
    muted: Option<bool>,
    soloed: Option<bool>,
}

/// Handle update_audio_bus command.
fn handle_update_audio_bus(payload: serde_json::Value) -> CommandResult {
    let data: UpdateAudioBusPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_audio_bus payload: {}", e))?;

    let update = AudioBusUpdate {
        bus_name: data.bus_name.clone(),
        volume: data.volume,
        muted: data.muted,
        soloed: data.soloed,
    };

    if queue_audio_bus_update_from_bridge(update) {
        tracing::info!("Queued audio bus update: {}", data.bus_name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for create_audio_bus command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAudioBusPayload {
    name: String,
    #[serde(default = "default_volume")]
    volume: f32,
}

fn default_volume() -> f32 {
    1.0
}

/// Handle create_audio_bus command.
fn handle_create_audio_bus(payload: serde_json::Value) -> CommandResult {
    let data: CreateAudioBusPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid create_audio_bus payload: {}", e))?;

    // Reject "master" name
    if data.name == "master" {
        return Err("Cannot create a bus named 'master' (reserved)".to_string());
    }

    if data.name.is_empty() {
        return Err("Bus name cannot be empty".to_string());
    }

    let create = AudioBusCreate {
        name: data.name.clone(),
        volume: data.volume.clamp(0.0, 1.0),
        muted: false,
        soloed: false,
    };

    if queue_audio_bus_create_from_bridge(create) {
        tracing::info!("Queued audio bus creation: {}", data.name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for delete_audio_bus command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteAudioBusPayload {
    bus_name: String,
}

/// Handle delete_audio_bus command.
fn handle_delete_audio_bus(payload: serde_json::Value) -> CommandResult {
    let data: DeleteAudioBusPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid delete_audio_bus payload: {}", e))?;

    // Reject deletion of "master"
    if data.bus_name == "master" {
        return Err("Cannot delete the 'master' bus".to_string());
    }

    let delete = AudioBusDelete {
        bus_name: data.bus_name.clone(),
    };

    if queue_audio_bus_delete_from_bridge(delete) {
        tracing::info!("Queued audio bus deletion: {}", data.bus_name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_bus_effects command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetBusEffectsPayload {
    bus_name: String,
    effects: Vec<super::audio::AudioEffectDef>,
}

/// Handle set_bus_effects command (A-2).
fn handle_set_bus_effects(payload: serde_json::Value) -> CommandResult {
    let data: SetBusEffectsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_bus_effects payload: {}", e))?;

    let update = AudioBusEffectsUpdate {
        bus_name: data.bus_name.clone(),
        effects: data.effects,
    };

    if queue_audio_bus_effects_update_from_bridge(update) {
        tracing::info!("Queued audio bus effects update: {}", data.bus_name);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ---------------------------------------------------------------------------
// Particle handlers
// ---------------------------------------------------------------------------

/// Payload for set_particle command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetParticlePayload {
    entity_id: String,
    #[serde(flatten)]
    particle_data: CoreParticleData,
}

/// Handle set_particle command.
fn handle_set_particle(payload: serde_json::Value) -> CommandResult {
    let data: SetParticlePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_particle payload: {}", e))?;

    let update = ParticleUpdate {
        entity_id: data.entity_id.clone(),
        particle_data: data.particle_data,
    };

    if queue_particle_update_from_bridge(update) {
        tracing::info!("Queued particle update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_particle command.
fn handle_remove_particle(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = ParticleRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_particle_removal_from_bridge(removal) {
        tracing::info!("Queued particle removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for toggle_particle command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleParticlePayload {
    entity_id: String,
    enabled: bool,
}

/// Handle toggle_particle command.
fn handle_toggle_particle(payload: serde_json::Value) -> CommandResult {
    let data: ToggleParticlePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid toggle_particle payload: {}", e))?;

    let toggle = ParticleToggle {
        entity_id: data.entity_id.clone(),
        enabled: data.enabled,
    };

    if queue_particle_toggle_from_bridge(toggle) {
        tracing::info!(
            "Queued particle toggle: {} -> {}",
            data.entity_id,
            data.enabled
        );
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_particle_preset command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetParticlePresetPayload {
    entity_id: String,
    preset: String,
}

/// Handle set_particle_preset command.
fn handle_set_particle_preset(payload: serde_json::Value) -> CommandResult {
    let data: SetParticlePresetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_particle_preset payload: {}", e))?;

    // Validate preset name
    use super::particles::ParticlePreset as PP;
    PP::from_str(&data.preset).ok_or_else(|| {
        format!(
            "Unknown particle preset: {}. Valid: fire, smoke, sparks, rain, snow, explosion, magic_sparkle, dust, trail, custom",
            data.preset
        )
    })?;

    let preset_name = data.preset.clone();
    let request = ParticlePresetRequest {
        entity_id: data.entity_id.clone(),
        preset: data.preset,
    };

    if queue_particle_preset_from_bridge(request) {
        tracing::info!(
            "Queued particle preset '{}' for entity: {}",
            preset_name,
            data.entity_id
        );
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle play_particle command.
fn handle_play_particle(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let playback = ParticlePlayback {
        entity_id: entity_id.clone(),
        action: "play".to_string(),
        burst_count: None,
    };

    if queue_particle_playback_from_bridge(playback) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle stop_particle command.
fn handle_stop_particle(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let playback = ParticlePlayback {
        entity_id: entity_id.clone(),
        action: "stop".to_string(),
        burst_count: None,
    };

    if queue_particle_playback_from_bridge(playback) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for burst_particle command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BurstParticlePayload {
    entity_id: String,
    count: Option<u32>,
}

/// Handle burst_particle command.
fn handle_burst_particle(payload: serde_json::Value) -> CommandResult {
    let data: BurstParticlePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid burst_particle payload: {}", e))?;

    let playback = ParticlePlayback {
        entity_id: data.entity_id.clone(),
        action: "burst".to_string(),
        burst_count: data.count,
    };

    if queue_particle_playback_from_bridge(playback) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ---------------------------------------------------------------------------
// Animation handlers
// ---------------------------------------------------------------------------

/// Handle play_animation command.
/// Payload: { entityId: string, clipName: string, crossfadeSecs?: number }
fn handle_play_animation(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let clip_name = payload.get("clipName")
        .and_then(|v| v.as_str())
        .ok_or("Missing clipName")?
        .to_string();
    let crossfade_secs = payload.get("crossfadeSecs")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.3) as f32;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::Play { clip_name, crossfade_secs },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued play_animation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle pause_animation command.
fn handle_pause_animation(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::Pause,
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued pause_animation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle resume_animation command.
fn handle_resume_animation(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::Resume,
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued resume_animation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle stop_animation command.
fn handle_stop_animation(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::Stop,
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued stop_animation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle seek_animation command.
fn handle_seek_animation(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let time_secs = payload.get("timeSecs")
        .and_then(|v| v.as_f64())
        .ok_or("Missing timeSecs")? as f32;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::Seek { time_secs },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued seek_animation for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_animation_speed command.
fn handle_set_animation_speed(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let speed = payload.get("speed")
        .and_then(|v| v.as_f64())
        .ok_or("Missing speed")? as f32;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::SetSpeed { speed: speed.max(0.01) },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued set_animation_speed for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_animation_loop command.
fn handle_set_animation_loop(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let looping = payload.get("looping")
        .and_then(|v| v.as_bool())
        .ok_or("Missing looping")?;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::SetLoop { looping },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued set_animation_loop for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
