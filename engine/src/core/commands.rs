//! Command handling - pure Rust logic for processing commands from the frontend.

use bevy::math::{Quat, Vec3, EulerRot};
use serde::{Deserialize, Serialize};
use super::camera_presets::CameraPreset;
use super::gizmo::CoordinateMode;
use super::lighting::LightData;
use super::material::MaterialData;
use super::input::{ActionDef, ActionType, InputPreset, InputSource};
use super::particles::ParticleData as CoreParticleData;
use super::physics::{JointData, JointLimits, JointMotor, JointType, PhysicsData};
use super::physics_2d::{Physics2dData, PhysicsJoint2d, BodyType2d, ColliderShape2d};
use super::post_processing::{
    BloomSettings, ChromaticAberrationSettings, ColorGradingSettings, SharpeningSettings,
    SsaoSettings, DepthOfFieldSettings, MotionBlurSettings,
};
use super::shader_effects::ShaderEffectData;
use super::csg::CsgOperation;
use super::terrain::{TerrainData, NoiseType};
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
    queue_create_joint_from_bridge, queue_update_joint_from_bridge, queue_remove_joint_from_bridge,
    queue_physics2d_update_from_bridge, queue_physics2d_toggle_from_bridge,
    queue_create_joint2d_from_bridge, queue_remove_joint2d_from_bridge,
    queue_force_application2d_from_bridge, queue_impulse_application2d_from_bridge,
    queue_raycast2d_from_bridge, queue_gravity2d_update_from_bridge, queue_debug_physics2d_toggle_from_bridge,
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
    queue_shader_update_from_bridge, queue_shader_removal_from_bridge,
    queue_csg_from_bridge,
    queue_terrain_spawn_from_bridge, queue_terrain_update_from_bridge, queue_terrain_sculpt_from_bridge,
    queue_extrude_from_bridge, queue_lathe_from_bridge, queue_array_from_bridge, queue_combine_from_bridge,
    queue_quality_preset_from_bridge, queue_instantiate_prefab_from_bridge,
    queue_set_skybox_from_bridge, queue_remove_skybox_from_bridge, queue_update_skybox_from_bridge,
    queue_custom_skybox_from_bridge,
    queue_game_component_add_from_bridge, queue_game_component_update_from_bridge, queue_game_component_removal_from_bridge,
    queue_set_game_camera_from_bridge, queue_set_active_game_camera_from_bridge, queue_camera_shake_from_bridge,
    queue_set_project_type_from_bridge, queue_sprite_data_update_from_bridge, queue_sprite_removal_from_bridge,
    queue_camera_2d_data_update_from_bridge,
    queue_create_skeleton2d_from_bridge, queue_add_bone2d_from_bridge, queue_remove_bone2d_from_bridge,
    queue_update_bone2d_from_bridge, queue_create_skeletal_animation2d_from_bridge, queue_add_keyframe2d_from_bridge,
    queue_play_skeletal_animation2d_from_bridge, queue_set_skeleton2d_skin_from_bridge, queue_create_ik_chain2d_from_bridge,
    queue_auto_weight_skeleton2d_from_bridge,
    SetProjectTypeRequest, SpriteDataUpdate, SpriteRemoval, Camera2dDataUpdate, Camera2dBounds,
    CreateSkeleton2dRequest, AddBone2dRequest, RemoveBone2dRequest, UpdateBone2dRequest,
    CreateSkeletalAnimation2dRequest, AddKeyframe2dRequest, PlaySkeletalAnimation2dRequest,
    SetSkeleton2dSkinRequest, CreateIkChain2dRequest, AutoWeightSkeleton2dRequest,
    SetGameCameraRequest, SetActiveGameCameraRequest, CameraShakeRequest,
    QualityPresetRequest, InstantiatePrefabRequest,
    SetSkyboxRequest, RemoveSkyboxRequest, UpdateSkyboxRequest, SetCustomSkyboxRequest,
    AnimationRequest, AnimationAction,
    ShaderUpdate, ShaderRemoval,
    CsgRequest,
    TransformUpdate, RenameRequest, CameraFocusRequest, SpawnRequest, DeleteRequest, DuplicateRequest,
    ReparentRequest, SnapSettingsUpdate, CameraPresetRequest, MaterialUpdate, LightUpdate,
    AmbientLightUpdate, EnvironmentUpdate, PostProcessingUpdate, EntityType, SceneLoadRequest,
    InputBindingUpdate, InputPresetRequest, InputBindingRemoval,
    PhysicsUpdate, PhysicsToggle, ForceApplication,
    CreateJointRequest, UpdateJointRequest, RemoveJointRequest,
    Physics2dUpdate, Physics2dToggle, CreateJoint2dRequest, RemoveJoint2dRequest,
    ForceApplication2d, ImpulseApplication2d, Raycast2dRequest, Gravity2dUpdate, DebugPhysics2dToggle,
    GltfImportRequest, TextureLoadRequest, PlaceAssetRequest, DeleteAssetRequest, RemoveTextureRequest,
    ScriptUpdate, ScriptRemoval,
    AudioUpdate, AudioRemoval, AudioPlayback,
    AudioBusUpdate, AudioBusCreate, AudioBusDelete, AudioBusEffectsUpdate,
    ParticleUpdate, ParticleToggle, ParticleRemoval, ParticlePresetRequest, ParticlePlayback,
    TerrainSpawnRequest, TerrainUpdate, TerrainSculpt,
    ExtrudeRequest, LatheRequest, ArrayRequest, CombineRequest,
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
        "set_custom_shader" => handle_set_custom_shader(payload),
        "remove_custom_shader" => handle_remove_custom_shader(payload),
        "get_shader" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::ShaderData { entity_id })
        },
        "list_shaders" => handle_list_shaders(payload),
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
        "raycast_query" => handle_raycast_query(payload),
        // Joint commands
        "create_joint" => handle_create_joint(payload),
        "update_joint" => handle_update_joint(payload),
        "remove_joint" => handle_remove_joint(payload),
        "list_joints" => handle_query(QueryRequest::ListJoints),
        // 2D Physics commands
        "set_physics2d" => handle_set_physics2d(payload),
        "remove_physics2d" => handle_remove_physics2d(payload),
        "set_2d_collider_shape" => handle_set_2d_collider_shape(payload),
        "set_2d_body_type" => handle_set_2d_body_type(payload),
        "create_2d_joint" => handle_create_2d_joint(payload),
        "remove_2d_joint" => handle_remove_2d_joint(payload),
        "apply_force2d" => handle_apply_force2d(payload),
        "apply_impulse2d" => handle_apply_impulse2d(payload),
        "raycast2d" => handle_raycast2d(payload),
        "set_gravity2d" => handle_set_gravity2d(payload),
        "set_debug_physics2d" => handle_set_debug_physics2d(payload),
        "get_physics2d" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::Physics2dState { entity_id })
        },
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
        "set_animation_blend_weight" => handle_set_blend_weight(payload),
        "set_clip_speed" => handle_set_clip_speed(payload),
        "get_animation_state" | "list_animations" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::AnimationState { entity_id })
        },
        "get_animation_graph" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::AnimationGraph { entity_id })
        },
        // CSG commands
        "csg_union" => handle_csg(payload, CsgOperation::Union),
        "csg_subtract" => handle_csg(payload, CsgOperation::Subtract),
        "csg_intersect" => handle_csg(payload, CsgOperation::Intersect),
        // Terrain commands
        "spawn_terrain" => handle_spawn_terrain(payload),
        "update_terrain" => handle_update_terrain(payload),
        "sculpt_terrain" => handle_sculpt_terrain(payload),
        "get_terrain" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::TerrainState { entity_id })
        },
        // Procedural mesh commands
        "extrude_shape" => handle_extrude_shape(payload),
        "lathe_shape" => handle_lathe_shape(payload),
        "array_entity" => handle_array_entity(payload),
        "combine_meshes" => handle_combine_meshes(payload),
        // Prefab commands
        "instantiate_prefab" => handle_instantiate_prefab(payload),
        // Quality preset commands
        "set_quality_preset" => handle_set_quality_preset(payload),
        "get_quality_settings" => handle_query(QueryRequest::QualitySettings),
        // Skybox commands
        "set_skybox" => handle_set_skybox(payload),
        "remove_skybox" => handle_remove_skybox(payload),
        "update_skybox" => handle_update_skybox(payload),
        "set_custom_skybox" => handle_set_custom_skybox(payload),
        // Game component commands
        "add_game_component" => handle_add_game_component(payload),
        "update_game_component" => handle_update_game_component(payload),
        "remove_game_component" => handle_remove_game_component(payload),
        "get_game_components" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::GameComponentState { entity_id })
        },
        "list_game_component_types" => handle_list_game_component_types(payload),
        // Game camera commands
        "set_game_camera" => handle_set_game_camera(payload),
        "set_active_game_camera" => handle_set_active_game_camera(payload),
        "camera_shake" => handle_camera_shake(payload),
        "get_game_camera" => {
            let entity_id = payload.get("entityId")
                .or_else(|| payload.get("entity_id"))
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::GameCameraState { entity_id })
        },
        // 2D/Sprite commands
        "set_project_type" => handle_set_project_type(payload),
        "get_project_type" => handle_query(QueryRequest::ProjectType),
        "set_sprite_data" => handle_set_sprite_data(payload),
        "remove_sprite" => handle_remove_sprite(payload),
        "get_sprite" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::SpriteState { entity_id })
        },
        "update_camera_2d" => handle_update_camera_2d(payload),
        "get_camera_2d" => handle_query(QueryRequest::Camera2dState),
        // Skeleton 2D commands
        "create_skeleton2d" => handle_create_skeleton2d(payload),
        "add_bone2d" => handle_add_bone2d(payload),
        "remove_bone2d" => handle_remove_bone2d(payload),
        "update_bone2d" => handle_update_bone2d(payload),
        "create_skeletal_animation2d" => handle_create_skeletal_animation2d(payload),
        "add_keyframe2d" => handle_add_keyframe2d(payload),
        "play_skeletal_animation2d" => handle_play_skeletal_animation2d(payload),
        "set_skeleton2d_skin" => handle_set_skeleton2d_skin(payload),
        "create_ik_chain2d" => handle_create_ik_chain2d(payload),
        "get_skeleton2d" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId")?
                .to_string();
            handle_query(QueryRequest::Skeleton2dState { entity_id })
        },
        "auto_weight_skeleton2d" => handle_auto_weight_skeleton2d(payload),
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
    // UV Transform (E-1a)
    uv_offset: Option<[f32; 2]>,
    uv_scale: Option<[f32; 2]>,
    uv_rotation: Option<f32>,
    // Parallax (E-1b)
    parallax_depth_scale: Option<f32>,
    parallax_mapping_method: Option<String>,
    max_parallax_layer_count: Option<f32>,
    parallax_relief_max_steps: Option<u32>,
    // Clearcoat (E-1c)
    clearcoat: Option<f32>,
    clearcoat_perceptual_roughness: Option<f32>,
    // Transmission (E-1d)
    specular_transmission: Option<f32>,
    diffuse_transmission: Option<f32>,
    ior: Option<f32>,
    thickness: Option<f32>,
    attenuation_distance: Option<f32>,
    attenuation_color: Option<[f32; 3]>,
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
    // UV Transform (E-1a)
    if let Some(v) = data.uv_offset { mat.uv_offset = v; }
    if let Some(v) = data.uv_scale { mat.uv_scale = v; }
    if let Some(v) = data.uv_rotation { mat.uv_rotation = v; }
    // Parallax (E-1b)
    if let Some(v) = data.parallax_depth_scale { mat.parallax_depth_scale = v; }
    if let Some(ref v) = data.parallax_mapping_method {
        mat.parallax_mapping_method = match v.as_str() {
            "relief" => super::material::ParallaxMethod::Relief,
            _ => super::material::ParallaxMethod::Occlusion,
        };
    }
    if let Some(v) = data.max_parallax_layer_count { mat.max_parallax_layer_count = v; }
    if let Some(v) = data.parallax_relief_max_steps { mat.parallax_relief_max_steps = v; }
    // Clearcoat (E-1c)
    if let Some(v) = data.clearcoat { mat.clearcoat = v; }
    if let Some(v) = data.clearcoat_perceptual_roughness { mat.clearcoat_perceptual_roughness = v; }
    // Transmission (E-1d)
    if let Some(v) = data.specular_transmission { mat.specular_transmission = v; }
    if let Some(v) = data.diffuse_transmission { mat.diffuse_transmission = v; }
    if let Some(v) = data.ior { mat.ior = v; }
    if let Some(v) = data.thickness { mat.thickness = v; }
    if let Some(v) = data.attenuation_distance { mat.attenuation_distance = v; }
    if let Some(v) = data.attenuation_color { mat.attenuation_color = v; }

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
    ssao: Option<Option<SsaoSettings>>,
    depth_of_field: Option<Option<DepthOfFieldSettings>>,
    motion_blur: Option<Option<MotionBlurSettings>>,
}

fn handle_update_post_processing(payload: serde_json::Value) -> CommandResult {
    let data: UpdatePostProcessingPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_post_processing payload: {}", e))?;

    let update = PostProcessingUpdate {
        bloom: data.bloom,
        chromatic_aberration: data.chromatic_aberration,
        color_grading: data.color_grading,
        sharpening: data.sharpening,
        ssao: data.ssao,
        depth_of_field: data.depth_of_field,
        motion_blur: data.motion_blur,
    };

    if queue_post_processing_update_from_bridge(update) {
        tracing::info!("Queued post-processing update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSkyboxPayload {
    preset: Option<String>,
    asset_id: Option<String>,
    brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    rotation: Option<f32>,
}

/// Handle set_skybox command.
fn handle_set_skybox(payload: serde_json::Value) -> CommandResult {
    let data: SetSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_skybox payload: {}", e))?;

    let request = SetSkyboxRequest {
        preset: data.preset,
        asset_id: data.asset_id,
        brightness: data.brightness,
        ibl_intensity: data.ibl_intensity,
        rotation: data.rotation,
    };

    if queue_set_skybox_from_bridge(request) {
        tracing::info!("Queued set skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_skybox command.
fn handle_remove_skybox(_payload: serde_json::Value) -> CommandResult {
    let request = RemoveSkyboxRequest;

    if queue_remove_skybox_from_bridge(request) {
        tracing::info!("Queued remove skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSkyboxPayload {
    brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    rotation: Option<f32>,
}

/// Handle update_skybox command.
fn handle_update_skybox(payload: serde_json::Value) -> CommandResult {
    let data: UpdateSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_skybox payload: {}", e))?;

    let request = UpdateSkyboxRequest {
        brightness: data.brightness,
        ibl_intensity: data.ibl_intensity,
        rotation: data.rotation,
    };

    if queue_update_skybox_from_bridge(request) {
        tracing::info!("Queued update skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_custom_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCustomSkyboxPayload {
    asset_id: String,
    data_base64: String,
}

/// Handle set_custom_skybox command.
fn handle_set_custom_skybox(payload: serde_json::Value) -> CommandResult {
    let data: SetCustomSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_custom_skybox payload: {}", e))?;

    let request = SetCustomSkyboxRequest {
        asset_id: data.asset_id,
        data_base64: data.data_base64,
    };

    if queue_custom_skybox_from_bridge(request) {
        tracing::info!("Queued custom skybox request");
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RaycastPayload {
    request_id: Option<String>,
    origin: [f32; 3],
    direction: [f32; 3],
    max_distance: Option<f32>,
}

/// Handle raycast_query command.
fn handle_raycast_query(payload: serde_json::Value) -> CommandResult {
    use super::pending_commands::{RaycastRequest, queue_raycast_from_bridge};

    let data: RaycastPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid raycast_query payload: {}", e))?;

    let request_id = data.request_id.unwrap_or_else(|| format!("ray_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()));
    let max_distance = data.max_distance.unwrap_or(100.0);

    let request = RaycastRequest {
        request_id: request_id.clone(),
        origin: data.origin,
        direction: data.direction,
        max_distance,
    };

    if queue_raycast_from_bridge(request) {
        tracing::info!("Queued raycast query: {}", request_id);
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
// Shader effect handlers
// ---------------------------------------------------------------------------

/// Payload for set_custom_shader command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCustomShaderPayload {
    entity_id: String,
    #[serde(flatten)]
    shader_data: ShaderEffectData,
}

/// Handle set_custom_shader command.
fn handle_set_custom_shader(payload: serde_json::Value) -> CommandResult {
    let data: SetCustomShaderPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_custom_shader payload: {}", e))?;

    let update = ShaderUpdate {
        entity_id: data.entity_id.clone(),
        shader_data: data.shader_data,
    };

    if queue_shader_update_from_bridge(update) {
        tracing::info!("Queued shader update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_custom_shader command.
fn handle_remove_custom_shader(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = ShaderRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_shader_removal_from_bridge(removal) {
        tracing::info!("Queued shader removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle list_shaders command — returns hardcoded shader list.
fn handle_list_shaders(_payload: serde_json::Value) -> CommandResult {
    // This is a simple query that doesn't need queuing — return immediately via emit_event
    // For now, just return Ok(). The query system will handle emitting the result.
    Ok(())
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

/// Handle set_animation_blend_weight command.
fn handle_set_blend_weight(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let clip_name = payload.get("clipName")
        .and_then(|v| v.as_str())
        .ok_or("Missing clipName")?
        .to_string();
    let weight = payload.get("weight")
        .and_then(|v| v.as_f64())
        .ok_or("Missing weight")? as f32;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::SetBlendWeight { clip_name, weight: weight.clamp(0.0, 1.0) },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued set_animation_blend_weight for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_clip_speed command.
fn handle_set_clip_speed(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let clip_name = payload.get("clipName")
        .and_then(|v| v.as_str())
        .ok_or("Missing clipName")?
        .to_string();
    let speed = payload.get("speed")
        .and_then(|v| v.as_f64())
        .ok_or("Missing speed")? as f32;

    let request = AnimationRequest {
        entity_id: entity_id.clone(),
        action: AnimationAction::SetClipSpeed { clip_name, speed: speed.max(0.01) },
    };

    if queue_animation_request_from_bridge(request) {
        tracing::info!("Queued set_clip_speed for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle CSG boolean operation commands.
fn handle_csg(payload: serde_json::Value, operation: CsgOperation) -> CommandResult {
    let entity_id_a = payload.get("entityIdA")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityIdA")?
        .to_string();
    let entity_id_b = payload.get("entityIdB")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityIdB")?
        .to_string();
    let delete_sources = payload.get("deleteSources")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let result_name = payload.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let request = CsgRequest {
        entity_id_a,
        entity_id_b,
        operation,
        delete_sources,
        result_name,
    };

    if queue_csg_from_bridge(request) {
        tracing::info!("Queued CSG {:?} operation", operation);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for spawn_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnTerrainPayload {
    name: Option<String>,
    position: Option<[f32; 3]>,
    noise_type: Option<String>,
    octaves: Option<u32>,
    frequency: Option<f64>,
    amplitude: Option<f64>,
    height_scale: Option<f32>,
    seed: Option<u32>,
    resolution: Option<u32>,
    size: Option<f32>,
}

fn handle_spawn_terrain(payload: serde_json::Value) -> CommandResult {
    let data: SpawnTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid spawn_terrain payload: {}", e))?;

    let mut td = TerrainData::default();
    if let Some(ref nt) = data.noise_type {
        td.noise_type = match nt.as_str() {
            "simplex" => NoiseType::Simplex,
            "value" => NoiseType::Value,
            _ => NoiseType::Perlin,
        };
    }
    if let Some(v) = data.octaves {
        td.octaves = v.clamp(1, 8);
    }
    if let Some(v) = data.frequency {
        td.frequency = v;
    }
    if let Some(v) = data.amplitude {
        td.amplitude = v;
    }
    if let Some(v) = data.height_scale {
        td.height_scale = v;
    }
    if let Some(v) = data.seed {
        td.seed = v;
    }
    if let Some(v) = data.resolution {
        td.resolution = match v {
            0..=48 => 32,
            49..=96 => 64,
            97..=192 => 128,
            _ => 256,
        };
    }
    if let Some(v) = data.size {
        td.size = v.max(1.0);
    }

    let request = TerrainSpawnRequest {
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
        terrain_data: td,
    };

    if queue_terrain_spawn_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTerrainPayload {
    entity_id: String,
    noise_type: Option<String>,
    octaves: Option<u32>,
    frequency: Option<f64>,
    amplitude: Option<f64>,
    height_scale: Option<f32>,
    seed: Option<u32>,
    resolution: Option<u32>,
    size: Option<f32>,
}

fn handle_update_terrain(payload: serde_json::Value) -> CommandResult {
    let data: UpdateTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_terrain payload: {}", e))?;

    // Build a full TerrainData from partial payload with defaults.
    // The apply system will merge with existing component data.
    let mut td = TerrainData::default();
    if let Some(ref nt) = data.noise_type {
        td.noise_type = match nt.as_str() {
            "simplex" => NoiseType::Simplex,
            "value" => NoiseType::Value,
            _ => NoiseType::Perlin,
        };
    }
    if let Some(v) = data.octaves {
        td.octaves = v.clamp(1, 8);
    }
    if let Some(v) = data.frequency {
        td.frequency = v;
    }
    if let Some(v) = data.amplitude {
        td.amplitude = v;
    }
    if let Some(v) = data.height_scale {
        td.height_scale = v;
    }
    if let Some(v) = data.seed {
        td.seed = v;
    }
    if let Some(v) = data.resolution {
        td.resolution = match v {
            0..=48 => 32,
            49..=96 => 64,
            97..=192 => 128,
            _ => 256,
        };
    }
    if let Some(v) = data.size {
        td.size = v.max(1.0);
    }

    let update = TerrainUpdate {
        entity_id: data.entity_id,
        terrain_data: td,
    };

    if queue_terrain_update_from_bridge(update) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for sculpt_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SculptTerrainPayload {
    entity_id: String,
    position: [f32; 2], // x, z in world space
    radius: f32,
    strength: f32,
}

fn handle_sculpt_terrain(payload: serde_json::Value) -> CommandResult {
    let data: SculptTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid sculpt_terrain payload: {}", e))?;

    let sculpt = TerrainSculpt {
        entity_id: data.entity_id,
        position: data.position,
        radius: data.radius.max(0.1),
        strength: data.strength,
    };

    if queue_terrain_sculpt_from_bridge(sculpt) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for extrude_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtrudeShapePayload {
    shape: String,
    radius: f32,
    length: f32,
    segments: u32,
    inner_radius: Option<f32>,
    star_points: Option<u32>,
    size: Option<f32>,
    name: Option<String>,
    position: Option<[f32; 3]>,
}

fn handle_extrude_shape(payload: serde_json::Value) -> CommandResult {
    let data: ExtrudeShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid extrude_shape payload: {}", e))?;

    let request = ExtrudeRequest {
        shape: data.shape,
        radius: data.radius.max(0.01),
        length: data.length.max(0.01),
        segments: data.segments.clamp(3, 64),
        inner_radius: data.inner_radius.map(|r| r.max(0.01)),
        star_points: data.star_points.map(|p| p.clamp(3, 16)),
        size: data.size.map(|s| s.max(0.01)),
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_extrude_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for lathe_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatheShapePayload {
    profile: Vec<[f32; 2]>,
    segments: u32,
    name: Option<String>,
    position: Option<[f32; 3]>,
}

fn handle_lathe_shape(payload: serde_json::Value) -> CommandResult {
    let data: LatheShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid lathe_shape payload: {}", e))?;

    if data.profile.len() < 2 {
        return Err("Profile must have at least 2 points".to_string());
    }

    let request = LatheRequest {
        profile: data.profile,
        segments: data.segments.clamp(8, 64),
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_lathe_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for array_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrayEntityPayload {
    entity_id: String,
    pattern: String,
    count_x: Option<u32>,
    count_y: Option<u32>,
    count_z: Option<u32>,
    spacing_x: Option<f32>,
    spacing_y: Option<f32>,
    spacing_z: Option<f32>,
    circle_count: Option<u32>,
    circle_radius: Option<f32>,
}

fn handle_array_entity(payload: serde_json::Value) -> CommandResult {
    let data: ArrayEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid array_entity payload: {}", e))?;

    let request = ArrayRequest {
        entity_id: data.entity_id,
        pattern: data.pattern,
        count_x: data.count_x.map(|c| c.clamp(1, 20)),
        count_y: data.count_y.map(|c| c.clamp(1, 20)),
        count_z: data.count_z.map(|c| c.clamp(1, 20)),
        spacing_x: data.spacing_x,
        spacing_y: data.spacing_y,
        spacing_z: data.spacing_z,
        circle_count: data.circle_count.map(|c| c.clamp(2, 32)),
        circle_radius: data.circle_radius,
    };

    if queue_array_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for combine_meshes command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CombineMeshesPayload {
    entity_ids: Vec<String>,
    delete_sources: bool,
    name: Option<String>,
}

fn handle_combine_meshes(payload: serde_json::Value) -> CommandResult {
    let data: CombineMeshesPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid combine_meshes payload: {}", e))?;

    if data.entity_ids.len() < 2 {
        return Err("Must provide at least 2 entities to combine".to_string());
    }

    let request = CombineRequest {
        entity_ids: data.entity_ids,
        delete_sources: data.delete_sources,
        name: data.name,
    };

    if queue_combine_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle instantiate_prefab command.
/// Payload: { snapshot_json: string, position?: [x, y, z], name?: string }
fn handle_instantiate_prefab(payload: serde_json::Value) -> CommandResult {
    let snapshot_json = payload.get("snapshot_json")
        .and_then(|v| v.as_str())
        .ok_or("Missing snapshot_json")?
        .to_string();

    let position = payload.get("position").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let name = payload.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());

    let request = InstantiatePrefabRequest {
        snapshot_json,
        position,
        name,
    };

    if queue_instantiate_prefab_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_quality_preset command.
/// Payload: { preset: "low" | "medium" | "high" | "ultra" }
fn handle_set_quality_preset(payload: serde_json::Value) -> CommandResult {
    let preset = payload.get("preset")
        .and_then(|v| v.as_str())
        .ok_or("Missing preset")?
        .to_string();

    // Validate preset name
    if !matches!(preset.as_str(), "low" | "medium" | "high" | "ultra") {
        return Err(format!("Invalid quality preset: {}. Must be low, medium, high, or ultra", preset));
    }

    if queue_quality_preset_from_bridge(QualityPresetRequest { preset }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_joint command.
/// Payload: { entityId, jointType, connectedEntityId, anchorSelf?, anchorOther?, axis?, limits?, motor? }
fn handle_create_joint(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let joint_type_str = payload.get("jointType")
        .and_then(|v| v.as_str())
        .ok_or("Missing jointType")?;

    let joint_type = match joint_type_str {
        "fixed" => JointType::Fixed,
        "revolute" => JointType::Revolute,
        "spherical" => JointType::Spherical,
        "prismatic" => JointType::Prismatic,
        "rope" => JointType::Rope,
        "spring" => JointType::Spring,
        _ => return Err(format!("Invalid joint type: {}", joint_type_str)),
    };

    let connected_entity_id = payload.get("connectedEntityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing connectedEntityId")?
        .to_string();

    let anchor_self = payload.get("anchorSelf")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 0.0, 0.0]);

    let anchor_other = payload.get("anchorOther")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 0.0, 0.0]);

    let axis = payload.get("axis")
        .and_then(|v| {
            let arr = v.as_array()?;
            if arr.len() == 3 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                ])
            } else { None }
        })
        .unwrap_or([0.0, 1.0, 0.0]);

    let limits = payload.get("limits").and_then(|v| {
        let obj = v.as_object()?;
        Some(JointLimits {
            min: obj.get("min")?.as_f64()? as f32,
            max: obj.get("max")?.as_f64()? as f32,
        })
    });

    let motor = payload.get("motor").and_then(|v| {
        let obj = v.as_object()?;
        Some(JointMotor {
            target_velocity: obj.get("targetVelocity")?.as_f64()? as f32,
            max_force: obj.get("maxForce")?.as_f64()? as f32,
        })
    });

    let joint_data = JointData {
        joint_type,
        connected_entity_id,
        anchor_self,
        anchor_other,
        axis,
        limits,
        motor,
    };

    let request = CreateJointRequest {
        entity_id,
        joint_data,
    };

    if queue_create_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_joint command.
/// Payload: { entityId, jointType?, connectedEntityId?, anchorSelf?, anchorOther?, axis?, limits?, motor? }
fn handle_update_joint(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let joint_type = payload.get("jointType").and_then(|v| {
        let type_str = v.as_str()?;
        match type_str {
            "fixed" => Some(JointType::Fixed),
            "revolute" => Some(JointType::Revolute),
            "spherical" => Some(JointType::Spherical),
            "prismatic" => Some(JointType::Prismatic),
            "rope" => Some(JointType::Rope),
            "spring" => Some(JointType::Spring),
            _ => None,
        }
    });

    let connected_entity_id = payload.get("connectedEntityId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let anchor_self = payload.get("anchorSelf").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let anchor_other = payload.get("anchorOther").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let axis = payload.get("axis").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    // Limits: None means "no update", Some(None) means "clear limits", Some(Some(limits)) means "set limits"
    let limits = if payload.get("limits").is_some() {
        Some(payload.get("limits").and_then(|v| {
            let obj = v.as_object()?;
            Some(JointLimits {
                min: obj.get("min")?.as_f64()? as f32,
                max: obj.get("max")?.as_f64()? as f32,
            })
        }))
    } else {
        None
    };

    // Motor: None means "no update", Some(None) means "clear motor", Some(Some(motor)) means "set motor"
    let motor = if payload.get("motor").is_some() {
        Some(payload.get("motor").and_then(|v| {
            let obj = v.as_object()?;
            Some(JointMotor {
                target_velocity: obj.get("targetVelocity")?.as_f64()? as f32,
                max_force: obj.get("maxForce")?.as_f64()? as f32,
            })
        }))
    } else {
        None
    };

    let request = UpdateJointRequest {
        entity_id,
        joint_type,
        connected_entity_id,
        anchor_self,
        anchor_other,
        axis,
        limits,
        motor,
    };

    if queue_update_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_joint command.
/// Payload: { entityId }
fn handle_remove_joint(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = RemoveJointRequest {
        entity_id,
    };

    if queue_remove_joint_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

// ============================================================================
// 2D Physics Handlers
// ============================================================================

/// Payload for set_physics2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPhysics2dPayload {
    entity_id: String,
    physics_data: Physics2dData,
}

/// Handle set_physics2d command.
fn handle_set_physics2d(payload: serde_json::Value) -> CommandResult {
    let data: SetPhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_physics2d payload: {}", e))?;

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data: data.physics_data,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D physics update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_physics2d command.
fn handle_remove_physics2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let toggle = Physics2dToggle {
        entity_id: entity_id.clone(),
        enabled: false,
    };

    if queue_physics2d_toggle_from_bridge(toggle) {
        tracing::info!("Queued 2D physics removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_2d_collider_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Set2dColliderShapePayload {
    entity_id: String,
    collider_shape: ColliderShape2d,
    size: Option<[f32; 2]>,
    radius: Option<f32>,
    vertices: Option<Vec<[f32; 2]>>,
}

/// Handle set_2d_collider_shape command.
fn handle_set_2d_collider_shape(payload: serde_json::Value) -> CommandResult {
    let data: Set2dColliderShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_2d_collider_shape payload: {}", e))?;

    // Build minimal physics data with just the shape change
    let mut physics_data = Physics2dData::default();
    physics_data.collider_shape = data.collider_shape;
    if let Some(size) = data.size {
        physics_data.size = size;
    }
    if let Some(radius) = data.radius {
        physics_data.radius = radius;
    }
    if let Some(vertices) = data.vertices {
        physics_data.vertices = vertices;
    }

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D collider shape update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_2d_body_type command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Set2dBodyTypePayload {
    entity_id: String,
    body_type: BodyType2d,
}

/// Handle set_2d_body_type command.
fn handle_set_2d_body_type(payload: serde_json::Value) -> CommandResult {
    let data: Set2dBodyTypePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_2d_body_type payload: {}", e))?;

    let mut physics_data = Physics2dData::default();
    physics_data.body_type = data.body_type;

    let update = Physics2dUpdate {
        entity_id: data.entity_id.clone(),
        physics_data,
    };

    if queue_physics2d_update_from_bridge(update) {
        tracing::info!("Queued 2D body type update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for create_2d_joint command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Create2dJointPayload {
    entity_id: String,
    joint_data: PhysicsJoint2d,
}

/// Handle create_2d_joint command.
fn handle_create_2d_joint(payload: serde_json::Value) -> CommandResult {
    let data: Create2dJointPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid create_2d_joint payload: {}", e))?;

    let request = CreateJoint2dRequest {
        entity_id: data.entity_id.clone(),
        joint_data: data.joint_data,
    };

    if queue_create_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint creation for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_2d_joint command.
fn handle_remove_2d_joint(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let request = RemoveJoint2dRequest {
        entity_id: entity_id.clone(),
    };

    if queue_remove_joint2d_from_bridge(request) {
        tracing::info!("Queued 2D joint removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_force2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyForce2dPayload {
    entity_id: String,
    force_x: f32,
    force_y: f32,
}

/// Handle apply_force2d command.
fn handle_apply_force2d(payload: serde_json::Value) -> CommandResult {
    let data: ApplyForce2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_force2d payload: {}", e))?;

    let application = ForceApplication2d {
        entity_id: data.entity_id.clone(),
        force_x: data.force_x,
        force_y: data.force_y,
    };

    if queue_force_application2d_from_bridge(application) {
        tracing::info!("Queued 2D force application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for apply_impulse2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyImpulse2dPayload {
    entity_id: String,
    impulse_x: f32,
    impulse_y: f32,
}

/// Handle apply_impulse2d command.
fn handle_apply_impulse2d(payload: serde_json::Value) -> CommandResult {
    let data: ApplyImpulse2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid apply_impulse2d payload: {}", e))?;

    let application = ImpulseApplication2d {
        entity_id: data.entity_id.clone(),
        impulse_x: data.impulse_x,
        impulse_y: data.impulse_y,
    };

    if queue_impulse_application2d_from_bridge(application) {
        tracing::info!("Queued 2D impulse application for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for raycast2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raycast2dPayload {
    origin_x: f32,
    origin_y: f32,
    dir_x: f32,
    dir_y: f32,
    max_distance: f32,
}

/// Handle raycast2d command.
fn handle_raycast2d(payload: serde_json::Value) -> CommandResult {
    let data: Raycast2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid raycast2d payload: {}", e))?;

    let request = Raycast2dRequest {
        origin_x: data.origin_x,
        origin_y: data.origin_y,
        dir_x: data.dir_x,
        dir_y: data.dir_y,
        max_distance: data.max_distance,
    };

    if queue_raycast2d_from_bridge(request) {
        tracing::info!("Queued 2D raycast");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_gravity2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetGravity2dPayload {
    gravity_x: f32,
    gravity_y: f32,
}

/// Handle set_gravity2d command.
fn handle_set_gravity2d(payload: serde_json::Value) -> CommandResult {
    let data: SetGravity2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_gravity2d payload: {}", e))?;

    let update = Gravity2dUpdate {
        gravity_x: data.gravity_x,
        gravity_y: data.gravity_y,
    };

    if queue_gravity2d_update_from_bridge(update) {
        tracing::info!("Queued 2D gravity update: ({}, {})", data.gravity_x, data.gravity_y);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_debug_physics2d command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDebugPhysics2dPayload {
    enabled: bool,
}

/// Handle set_debug_physics2d command.
fn handle_set_debug_physics2d(payload: serde_json::Value) -> CommandResult {
    let data: SetDebugPhysics2dPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_debug_physics2d payload: {}", e))?;

    let toggle = DebugPhysics2dToggle {
        enabled: data.enabled,
    };

    if queue_debug_physics2d_toggle_from_bridge(toggle) {
        tracing::info!("Queued 2D debug physics toggle: {}", data.enabled);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_game_component command.
/// Payload: { entityId, componentType, properties? }
fn handle_add_game_component(payload: serde_json::Value) -> CommandResult {
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

    if queue_game_component_add_from_bridge(entity_id, component_type, properties_json) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_game_component command.
/// Payload: { entityId, componentType, properties }
fn handle_update_game_component(payload: serde_json::Value) -> CommandResult {
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

    if queue_game_component_update_from_bridge(entity_id, component_type, properties_json) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_game_component command.
/// Payload: { entityId, componentName }
fn handle_remove_game_component(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let component_name = payload.get("componentName")
        .and_then(|v| v.as_str())
        .ok_or("Missing componentName")?
        .to_string();

    if queue_game_component_removal_from_bridge(entity_id, component_name) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle list_game_component_types command.
/// Returns static list of available types with default data.
fn handle_list_game_component_types(_payload: serde_json::Value) -> CommandResult {
    // This is a synchronous query, handled directly via handle_query in dispatch
    // But we need to return data immediately here
    Ok(())
}

// --- Game Camera Commands ---

/// Handle set_game_camera command.
/// Payload: { entity_id, mode, target_entity? }
fn handle_set_game_camera(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entity_id")
        .or_else(|| payload.get("entityId"))
        .and_then(|v| v.as_str())
        .ok_or("Missing entity_id")?
        .to_string();

    let mode: super::game_camera::GameCameraMode = serde_json::from_value(
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
fn handle_set_active_game_camera(payload: serde_json::Value) -> CommandResult {
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
fn handle_camera_shake(payload: serde_json::Value) -> CommandResult {
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

/// Handle set_project_type command.
/// Payload: { projectType: "2d" | "3d" }
fn handle_set_project_type(payload: serde_json::Value) -> CommandResult {
    let project_type = payload.get("projectType")
        .and_then(|v| v.as_str())
        .ok_or("Missing projectType")?
        .to_string();

    if queue_set_project_type_from_bridge(SetProjectTypeRequest { project_type }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_sprite_data command.
/// Payload: { entityId, textureAssetId?, colorTint?, flipX?, flipY?, customSize?, sortingLayer?, sortingOrder?, anchor? }
fn handle_set_sprite_data(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let texture_asset_id = payload.get("textureAssetId")
        .map(|v| v.as_str().map(|s| s.to_string()));

    let color_tint = payload.get("colorTint")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        });

    let flip_x = payload.get("flipX").and_then(|v| v.as_bool());
    let flip_y = payload.get("flipY").and_then(|v| v.as_bool());

    let custom_size = payload.get("customSize")
        .map(|v| {
            v.as_array().and_then(|arr| {
                if arr.len() == 2 {
                    Some([
                        arr[0].as_f64()? as f32,
                        arr[1].as_f64()? as f32,
                    ])
                } else {
                    None
                }
            })
        });

    let sorting_layer = payload.get("sortingLayer")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let sorting_order = payload.get("sortingOrder")
        .and_then(|v| v.as_i64())
        .map(|i| i as i32);

    let anchor = payload.get("anchor")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if queue_sprite_data_update_from_bridge(SpriteDataUpdate {
        entity_id,
        texture_asset_id,
        color_tint,
        flip_x,
        flip_y,
        custom_size,
        sorting_layer,
        sorting_order,
        anchor,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_sprite command.
/// Payload: { entityId }
fn handle_remove_sprite(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_sprite_removal_from_bridge(SpriteRemoval { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_camera_2d command.
/// Payload: { zoom?, pixelPerfect?, bounds? }
fn handle_update_camera_2d(payload: serde_json::Value) -> CommandResult {
    let zoom = payload.get("zoom").and_then(|v| v.as_f64()).map(|f| f as f32);
    let pixel_perfect = payload.get("pixelPerfect").and_then(|v| v.as_bool());

    let bounds = payload.get("bounds")
        .map(|v| {
            if v.is_null() {
                None
            } else {
                v.as_object().and_then(|obj| {
                    Some(Camera2dBounds {
                        min_x: obj.get("minX")?.as_f64()? as f32,
                        max_x: obj.get("maxX")?.as_f64()? as f32,
                        min_y: obj.get("minY")?.as_f64()? as f32,
                        max_y: obj.get("maxY")?.as_f64()? as f32,
                    })
                })
            }
        });

    if queue_camera_2d_data_update_from_bridge(Camera2dDataUpdate {
        zoom,
        pixel_perfect,
        bounds,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_skeleton2d command.
/// Payload: { entityId, skeletonData? }
fn handle_create_skeleton2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let skeleton_data = payload.get("skeletonData")
        .map(|v| serde_json::from_value(v.clone()))
        .transpose()
        .map_err(|e| format!("Invalid skeletonData: {}", e))?
        .unwrap_or_default();

    if queue_create_skeleton2d_from_bridge(CreateSkeleton2dRequest {
        entity_id,
        skeleton_data,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_bone2d command.
/// Payload: { entityId, boneName, parentBone?, positionX, positionY, rotation, length, order? }
fn handle_add_bone2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let parent_bone = payload.get("parentBone")
        .and_then(|v| if v.is_null() { None } else { v.as_str() })
        .map(|s| s.to_string());

    let position_x = payload.get("positionX")
        .and_then(|v| v.as_f64())
        .ok_or("Missing positionX")? as f32;

    let position_y = payload.get("positionY")
        .and_then(|v| v.as_f64())
        .ok_or("Missing positionY")? as f32;

    let rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .ok_or("Missing rotation")? as f32;

    let length = payload.get("length")
        .and_then(|v| v.as_f64())
        .ok_or("Missing length")? as f32;

    let color = payload.get("color")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        })
        .unwrap_or([1.0, 1.0, 1.0, 1.0]);

    let bone = super::skeleton2d::Bone2dDef {
        name: bone_name,
        parent_bone,
        local_position: [position_x, position_y],
        local_rotation: rotation,
        local_scale: [1.0, 1.0],
        length,
        color,
    };

    if queue_add_bone2d_from_bridge(AddBone2dRequest { entity_id, bone }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_bone2d command.
/// Payload: { entityId, boneName }
fn handle_remove_bone2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    if queue_remove_bone2d_from_bridge(RemoveBone2dRequest {
        entity_id,
        bone_name,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle update_bone2d command.
/// Payload: { entityId, boneName, positionX?, positionY?, rotation?, length? }
fn handle_update_bone2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let local_position = match (
        payload.get("positionX").and_then(|v| v.as_f64()),
        payload.get("positionY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let local_rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32);

    let length = payload.get("length")
        .and_then(|v| v.as_f64())
        .map(|l| l as f32);

    let color = payload.get("color")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            if arr.len() == 4 {
                Some([
                    arr[0].as_f64()? as f32,
                    arr[1].as_f64()? as f32,
                    arr[2].as_f64()? as f32,
                    arr[3].as_f64()? as f32,
                ])
            } else {
                None
            }
        });

    if queue_update_bone2d_from_bridge(UpdateBone2dRequest {
        entity_id,
        bone_name,
        local_position,
        local_rotation,
        local_scale: None,
        length,
        color,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_skeletal_animation2d command.
/// Payload: { entityId, animationName, duration, looping }
fn handle_create_skeletal_animation2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let duration = payload.get("duration")
        .and_then(|v| v.as_f64())
        .ok_or("Missing duration")? as f32;

    let looping = payload.get("looping")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let animation = super::skeletal_animation2d::SkeletalAnimation2d {
        name: animation_name,
        duration,
        looping,
        tracks: Default::default(),
    };

    if queue_create_skeletal_animation2d_from_bridge(CreateSkeletalAnimation2dRequest {
        entity_id,
        animation,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle add_keyframe2d command.
/// Payload: { entityId, animationName, boneName, time, positionX?, positionY?, rotation?, scaleX?, scaleY?, easing? }
fn handle_add_keyframe2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let bone_name = payload.get("boneName")
        .and_then(|v| v.as_str())
        .ok_or("Missing boneName")?
        .to_string();

    let time = payload.get("time")
        .and_then(|v| v.as_f64())
        .ok_or("Missing time")? as f32;

    let position = match (
        payload.get("positionX").and_then(|v| v.as_f64()),
        payload.get("positionY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let rotation = payload.get("rotation")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32);

    let scale = match (
        payload.get("scaleX").and_then(|v| v.as_f64()),
        payload.get("scaleY").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some([x as f32, y as f32]),
        _ => None,
    };

    let easing_str = payload.get("easing")
        .and_then(|v| v.as_str())
        .unwrap_or("linear");

    let easing = match easing_str {
        "easeIn" => super::skeletal_animation2d::EasingType2d::EaseIn,
        "easeOut" => super::skeletal_animation2d::EasingType2d::EaseOut,
        "easeInOut" => super::skeletal_animation2d::EasingType2d::EaseInOut,
        "step" => super::skeletal_animation2d::EasingType2d::Step,
        _ => super::skeletal_animation2d::EasingType2d::Linear,
    };

    let keyframe = super::skeletal_animation2d::BoneKeyframe {
        time,
        position,
        rotation,
        scale,
        easing,
    };

    if queue_add_keyframe2d_from_bridge(AddKeyframe2dRequest {
        entity_id,
        animation_name,
        bone_name,
        keyframe,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle play_skeletal_animation2d command.
/// Payload: { entityId, animationName, loop?, speed? }
fn handle_play_skeletal_animation2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let animation_name = payload.get("animationName")
        .and_then(|v| v.as_str())
        .ok_or("Missing animationName")?
        .to_string();

    let loop_animation = payload.get("loop")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let speed = payload.get("speed")
        .and_then(|v| v.as_f64())
        .map(|s| s as f32)
        .unwrap_or(1.0);

    if queue_play_skeletal_animation2d_from_bridge(PlaySkeletalAnimation2dRequest {
        entity_id,
        animation_name,
        loop_animation,
        speed,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_skeleton2d_skin command.
/// Payload: { entityId, skinName }
fn handle_set_skeleton2d_skin(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let skin_name = payload.get("skinName")
        .and_then(|v| v.as_str())
        .ok_or("Missing skinName")?
        .to_string();

    if queue_set_skeleton2d_skin_from_bridge(SetSkeleton2dSkinRequest {
        entity_id,
        skin_name,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle create_ik_chain2d command.
/// Payload: { entityId, chainName, targetBone, chainLength, bendPositive }
fn handle_create_ik_chain2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let chain_name = payload.get("chainName")
        .and_then(|v| v.as_str())
        .ok_or("Missing chainName")?
        .to_string();

    let target_bone = payload.get("targetBone")
        .and_then(|v| v.as_str())
        .ok_or("Missing targetBone")?
        .to_string();

    let chain_length = payload.get("chainLength")
        .and_then(|v| v.as_u64())
        .ok_or("Missing chainLength")? as usize;

    let bend_positive = payload.get("bendPositive")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    // For now, create a placeholder constraint
    let constraint = super::skeleton2d::IkConstraint2d {
        name: chain_name,
        bone_chain: vec![target_bone],
        target_entity_id: 0, // Placeholder
        bend_direction: if bend_positive { 1.0 } else { -1.0 },
        mix: 1.0,
    };

    if queue_create_ik_chain2d_from_bridge(CreateIkChain2dRequest {
        entity_id,
        constraint,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle auto_weight_skeleton2d command.
/// Payload: { entityId, method?, iterations? }
fn handle_auto_weight_skeleton2d(payload: serde_json::Value) -> CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let method = payload.get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("heat")
        .to_string();

    let iterations = payload.get("iterations")
        .and_then(|v| v.as_u64())
        .map(|i| i as u32)
        .unwrap_or(10);

    if queue_auto_weight_skeleton2d_from_bridge(AutoWeightSkeleton2dRequest {
        entity_id,
        method,
        iterations,
    }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
