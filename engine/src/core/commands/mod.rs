//! Command handling - pure Rust logic for processing commands from the frontend.
//! Split into domain modules for maintainability.
//!
//! ## Validation Pattern (recommended for future handlers)
//!
//! The TypeScript side has a shared validation framework at `web/src/lib/validation/`
//! with `ValidationResult<T>` types and composable validators. For Rust command
//! handlers, a similar pattern is recommended:
//!
//! ```ignore
//! enum ValidationResult<T> {
//!     Ok(T),
//!     Err { field: String, error: String },
//! }
//!
//! fn validate_entity_id(value: &serde_json::Value) -> ValidationResult<String> { ... }
//! fn validate_positive_f32(value: &serde_json::Value, field: &str) -> ValidationResult<f32> { ... }
//! fn validate_enum<T: FromStr>(value: &serde_json::Value, field: &str) -> ValidationResult<T> { ... }
//! ```
//!
//! Each domain handler would validate fields using these helpers before queuing
//! commands, returning `Err(field_error)` to propagate clear error messages back
//! to the frontend via `CommandResponse`. This prevents 15+ classes of validation
//! bugs identified in the audit (PF-499).

mod transform;
mod material;
mod physics;
mod audio;
mod animation;
mod particles;
mod performance;
mod procedural;
mod scene;
mod game;
mod sprites;
mod edit_mode;

use serde::Serialize;
use super::pending_commands::{QueryRequest, queue_query_from_bridge, queue_mode_change_from_bridge};
use super::engine_mode::ModeChangeRequest;

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

/// Identify which domain handles a command, enabling O(1) routing.
///
/// Returns a domain index:
///   0 = transform, 1 = material, 2 = physics, 3 = audio, 4 = animation,
///   5 = particles, 6 = performance, 7 = procedural, 8 = scene, 9 = game,
///   10 = sprites, 11 = edit_mode, 12 = engine-mode/query (handled inline)
///   255 = unknown
fn route_domain(command: &str) -> u8 {
    match command {
        // --- transform domain ---
        "resize" | "update_scene" | "spawn_entity" | "despawn_entity"
        | "update_transform" | "set_camera" | "select_entity" | "select_entities"
        | "clear_selection" | "set_visibility" | "set_gizmo_mode"
        | "set_coordinate_mode" | "rename_entity" | "reparent_entity"
        | "focus_camera" | "delete_entities" | "duplicate_entity"
        | "undo" | "redo" | "set_snap_settings" | "toggle_grid"
        | "set_camera_preset" | "set_input_binding" | "remove_input_binding"
        | "set_input_preset" | "get_input_bindings" | "get_input_state" => 0,

        // --- material domain ---
        "update_material" | "set_custom_shader" | "remove_custom_shader"
        | "get_shader" | "list_shaders" | "update_light" | "update_ambient_light"
        | "update_environment" | "update_post_processing" | "get_post_processing"
        | "set_skybox" | "remove_skybox" | "update_skybox" | "set_custom_skybox"
        | "set_custom_wgsl_source" | "validate_wgsl" | "register_custom_shader"
        | "apply_custom_shader" | "remove_custom_shader_slot" => 1,

        // --- physics domain ---
        "set_physics" | "remove_physics" | "set_physics_enabled"
        | "get_physics" | "enable_physics_debug" | "disable_physics_debug"
        | "apply_force" | "apply_impulse" | "set_linear_velocity"
        | "set_angular_velocity" | "get_velocity" | "raycast"
        | "set_joint" | "remove_joint" | "get_joint" | "list_joints"
        | "set_physics_2d" | "remove_physics_2d" | "set_physics_2d_enabled"
        | "get_physics_2d" | "set_joint_2d" | "remove_joint_2d" | "get_joint_2d"
        | "list_joints_2d" | "apply_force_2d" | "apply_impulse_2d"
        | "set_linear_velocity_2d" | "set_angular_velocity_2d"
        | "get_velocity_2d" | "raycast_2d" | "get_collisions"
        | "get_collisions_2d" => 2,

        // --- audio domain ---
        "set_audio" | "remove_audio" | "play_audio" | "stop_audio"
        | "pause_audio" | "get_audio" | "update_audio_bus" | "create_audio_bus"
        | "delete_audio_bus" | "get_audio_buses" | "set_bus_effects"
        | "set_reverb_zone" | "toggle_reverb_zone" | "remove_reverb_zone"
        | "get_reverb_zone" | "get_all_reverb_zones" => 3,

        // --- animation domain ---
        "play_animation" | "pause_animation" | "resume_animation"
        | "stop_animation" | "seek_animation" | "set_animation_speed"
        | "set_animation_loop" | "set_animation_blend_weight"
        | "set_clip_speed" | "get_animation_state" | "list_animations"
        | "get_animation_graph" | "create_animation_clip" | "add_keyframe"
        | "remove_keyframe" | "update_keyframe" | "get_animation_clips"
        | "play_animation_clip" | "stop_animation_clip"
        | "set_animation_state_machine" | "remove_animation_state_machine" => 4,

        // --- particles domain ---
        "set_particle" | "remove_particle" | "toggle_particle"
        | "set_particle_preset" | "play_particle" | "stop_particle"
        | "burst_particle" | "get_particle" | "list_particle_presets" => 5,

        // --- performance / LOD domain ---
        "set_lod" | "generate_lods" | "set_performance_budget"
        | "get_performance_stats" | "optimize_scene" | "set_lod_distances"
        | "set_simplification_backend" => 6,

        // --- procedural domain ---
        "csg_union" | "csg_subtract" | "csg_intersect"
        | "spawn_terrain" | "update_terrain" | "sculpt_terrain" | "get_terrain"
        | "extrude_shape" | "lathe_shape" | "array_entity" | "combine_meshes"
        | "instantiate_prefab" | "set_quality_preset" | "get_quality_settings" => 7,

        // --- scene domain ---
        "export_scene" | "load_scene" | "new_scene" | "import_gltf"
        | "load_texture" | "remove_texture" | "place_asset" | "delete_asset"
        | "import_audio" | "list_assets" | "set_script" | "remove_script"
        | "get_script" | "list_script_templates" | "apply_script_template"
        | "query_play_state" | "list_scenes" | "create_scene" | "switch_scene"
        | "delete_scene" | "duplicate_scene" | "rename_scene" | "export_scene_json"
        | "import_scene_json" => 8,

        // --- game domain ---
        "add_game_component" | "update_game_component" | "remove_game_component"
        | "get_game_components" | "list_game_component_types" | "set_game_camera"
        | "set_active_game_camera" | "camera_shake" | "mouse_delta"
        | "get_game_camera" => 9,

        // --- sprites / 2D domain ---
        "spawn_sprite" | "set_project_type" | "get_project_type"
        | "set_sprite_data" | "remove_sprite" | "get_sprite"
        | "update_camera_2d" | "get_camera_2d" | "set_sprite_sheet"
        | "remove_sprite_sheet" | "set_sprite_animator" | "remove_sprite_animator"
        | "create_skeleton2d" | "add_bone2d" | "remove_bone2d" | "update_bone2d"
        | "create_skeletal_animation2d" | "remove_skeletal_animation2d"
        | "add_skeletal_keyframe2d" | "set_skeleton_skin2d" | "solve_ik2d"
        | "set_blend_tree2d" | "remove_blend_tree2d" | "list_tilesets"
        | "create_tileset" | "update_tileset" | "delete_tileset"
        | "create_tilemap" | "update_tilemap" | "delete_tilemap"
        | "get_tilemap" | "set_tile" | "clear_tilemap" | "fill_tiles"
        | "get_sorting_layers" | "set_sorting_layers" => 10,

        // --- edit_mode domain ---
        "enter_edit_mode" | "exit_edit_mode" | "set_selection_mode"
        | "select_elements" | "mesh_operation" | "recalc_normals"
        | "extrude_faces" => 11,

        // --- engine-mode and query commands handled inline ---
        "play" | "stop" | "pause" | "resume" | "get_mode"
        | "get_scene_graph" | "get_selection" | "get_entity_details"
        | "get_camera_state" => 12,

        _ => 255,
    }
}

/// Dispatch a command to the appropriate handler.
/// Uses a routing table for O(1) domain selection before the domain-level match.
pub fn dispatch(command: &str, payload: serde_json::Value) -> CommandResult {
    match route_domain(command) {
        0 => transform::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown transform command: {}", command))),
        1 => material::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown material command: {}", command))),
        2 => physics::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown physics command: {}", command))),
        3 => audio::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown audio command: {}", command))),
        4 => animation::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown animation command: {}", command))),
        5 => particles::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown particles command: {}", command))),
        6 => performance::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown performance command: {}", command))),
        7 => procedural::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown procedural command: {}", command))),
        8 => scene::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown scene command: {}", command))),
        9 => game::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown game command: {}", command))),
        10 => sprites::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown sprites command: {}", command))),
        11 => edit_mode::dispatch(command, &payload)
                .unwrap_or_else(|| Err(format!("Unknown edit_mode command: {}", command))),
        12 => match command {
            "play" => handle_mode_change(ModeChangeRequest::Play),
            "stop" => handle_mode_change(ModeChangeRequest::Stop),
            "pause" => handle_mode_change(ModeChangeRequest::Pause),
            "resume" => handle_mode_change(ModeChangeRequest::Resume),
            "get_mode" => handle_query(QueryRequest::EngineMode),
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
        },
        _ => Err(format!("Unknown command: {}", command)),
    }
}

/// Handle a query command by queuing it for the next frame's Bevy system to process.
pub(crate) fn handle_query(request: QueryRequest) -> CommandResult {
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

/// Helper for default `true` in serde.
pub(crate) fn default_true() -> bool {
    true
}

/// Helper for default volume in serde.
pub(crate) fn default_volume() -> f32 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // === CommandResponse tests ===

    #[test]
    fn command_response_ok_has_success_true_and_no_error() {
        let resp = CommandResponse::ok();
        assert!(resp.success);
        assert!(resp.error.is_none());
    }

    #[test]
    fn command_response_err_has_success_false_and_message() {
        let resp = CommandResponse::err("something went wrong");
        assert!(!resp.success);
        assert_eq!(resp.error.as_deref(), Some("something went wrong"));
    }

    #[test]
    fn command_response_err_accepts_string_and_str() {
        let from_string = CommandResponse::err(String::from("owned"));
        let from_str = CommandResponse::err("borrowed");
        assert_eq!(from_string.error.as_deref(), Some("owned"));
        assert_eq!(from_str.error.as_deref(), Some("borrowed"));
    }

    #[test]
    fn command_response_ok_serializes_without_error_field() {
        let resp = CommandResponse::ok();
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        // skip_serializing_if = Option::is_none means "error" field absent
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn command_response_err_serializes_with_error_field() {
        let resp = CommandResponse::err("bad input");
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("\"error\":\"bad input\""));
    }

    // === dispatch routing — unknown command ===

    #[test]
    fn dispatch_returns_error_for_completely_unknown_command() {
        let result = dispatch("nonexistent_command_xyz", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown command") || err.contains("nonexistent_command_xyz"),
            "Expected error about unknown command, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_returns_error_for_empty_command_string() {
        let result = dispatch("", json!({}));
        assert!(result.is_err());
    }

    // === dispatch routing — commands reach correct domain ===
    // When PendingCommands is not initialized, the bridge functions return false.
    // All commands that queue to PendingCommands return Err("PendingCommands resource not initialized").
    // This proves the command was routed to the right handler (not "Unknown command").

    #[test]
    fn dispatch_spawn_entity_reaches_transform_domain() {
        let result = dispatch("spawn_entity", json!({
            "entityType": "cube",
            "name": "TestCube"
        }));
        // Should fail with "not initialized", not "Unknown command"
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("not initialized"),
            "Expected pending not initialized, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_update_transform_reaches_transform_domain() {
        let result = dispatch("update_transform", json!({
            "entityId": "entity-1",
            "position": [1.0, 2.0, 3.0]
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_rename_entity_reaches_transform_domain() {
        let result = dispatch("rename_entity", json!({
            "entityId": "entity-1",
            "name": "NewName"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_delete_entities_reaches_transform_domain() {
        let result = dispatch("delete_entities", json!({
            "entityIds": ["entity-1", "entity-2"]
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_update_material_reaches_material_domain() {
        let result = dispatch("update_material", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_export_scene_reaches_scene_domain() {
        let result = dispatch("export_scene", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_load_scene_reaches_scene_domain() {
        let result = dispatch("load_scene", json!({
            "json": "{\"entities\":[]}"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_new_scene_reaches_scene_domain() {
        let result = dispatch("new_scene", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_add_game_component_reaches_game_domain() {
        let result = dispatch("add_game_component", json!({
            "entityId": "entity-1",
            "componentType": "Health"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_apply_force_reaches_physics_domain() {
        // "apply_force" is a known physics command that maps to domain 2
        let result = dispatch("apply_force", json!({
            "entityId": "entity-1",
            "force": [0.0, 10.0, 0.0]
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Must reach the physics handler, not "Unknown command"
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_set_audio_reaches_audio_domain() {
        let result = dispatch("set_audio", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        // Must reach audio domain (not "Unknown command")
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_toggle_particle_reaches_particles_domain() {
        // toggle_particle has simpler payload requirements
        let result = dispatch("toggle_particle", json!({
            "entityId": "entity-1",
            "enabled": true
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_play_animation_reaches_animation_domain() {
        let result = dispatch("play_animation", json!({
            "entityId": "entity-1",
            "clipName": "Walk"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    // === dispatch — engine mode commands ===
    // play/stop/pause/resume all require PendingCommands too

    #[test]
    fn dispatch_play_reaches_mode_handler() {
        let result = dispatch("play", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_stop_reaches_mode_handler() {
        let result = dispatch("stop", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    #[test]
    fn dispatch_get_entity_details_requires_entity_id() {
        let result = dispatch("get_entity_details", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityId") || err.contains("Missing"),
            "Expected missing entityId error, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_get_entity_details_with_entity_id_reaches_query() {
        let result = dispatch("get_entity_details", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not initialized"), "got: {}", err);
    }

    // === dispatch — invalid payload parsing ===

    #[test]
    fn dispatch_spawn_entity_rejects_missing_entity_type() {
        let result = dispatch("spawn_entity", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityType") || err.contains("entity_type") || err.contains("Invalid"),
            "Expected parse error about entityType, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_spawn_entity_rejects_unknown_entity_type() {
        let result = dispatch("spawn_entity", json!({
            "entityType": "totally_not_a_real_type"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown entity type") || err.contains("totally_not_a_real_type"),
            "Expected unknown entity type error, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_rename_entity_rejects_missing_entity_id() {
        let result = dispatch("rename_entity", json!({"name": "NewName"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("entityId") || err.contains("entity_id") || err.contains("Invalid"),
            "Expected parse error, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_load_scene_rejects_missing_json_field() {
        let result = dispatch("load_scene", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("json") || err.contains("Missing"),
            "Expected missing json field error, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_set_visibility_rejects_missing_visible() {
        let result = dispatch("set_visibility", json!({"entityId": "entity-1"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("visible") || err.contains("Missing"),
            "Expected missing visible error, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_set_gizmo_mode_rejects_invalid_mode() {
        let result = dispatch("set_gizmo_mode", json!({"mode": "warp"}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Invalid gizmo mode") || err.contains("warp"),
            "Expected invalid gizmo mode error, got: {}",
            err
        );
    }

    // === dispatch — update_scene returns explicit "not implemented" ===

    #[test]
    fn dispatch_update_scene_returns_not_implemented() {
        let result = dispatch("update_scene", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("not implemented"),
            "Expected not implemented error, got: {}",
            err
        );
    }

    // === dispatch — set_camera returns explicit "not implemented" ===

    #[test]
    fn dispatch_set_camera_returns_not_implemented() {
        let result = dispatch("set_camera", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("not implemented"),
            "Expected not implemented error, got: {}",
            err
        );
    }

    // === dispatch — empty entityIds list returns Ok (nothing to do) ===

    #[test]
    fn dispatch_delete_entities_with_empty_list_returns_ok() {
        let result = dispatch("delete_entities", json!({"entityIds": []}));
        // Empty list is a no-op that returns Ok
        assert!(result.is_ok());
    }

    #[test]
    fn dispatch_select_entities_with_empty_list_returns_ok() {
        let result = dispatch("select_entities", json!({"entityIds": []}));
        assert!(result.is_ok());
    }

    // === route_domain coverage via dispatch — all 12 domains + 1 unknown ===
    // We verify each domain is reachable by confirming known commands aren't "Unknown command"

    #[test]
    fn dispatch_csg_union_reaches_procedural_domain() {
        let result = dispatch("csg_union", json!({
            "entityId": "entity-1",
            "targetId": "entity-2"
        }));
        assert!(result.is_err());
        // Must NOT say "Unknown command" — it reached the handler
        let err = result.unwrap_err();
        assert!(
            !err.contains("Unknown command"),
            "csg_union should reach procedural domain, got: {}",
            err
        );
    }

    #[test]
    fn dispatch_spawn_terrain_reaches_procedural_domain() {
        let result = dispatch("spawn_terrain", json!({}));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_set_lod_reaches_performance_domain() {
        let result = dispatch("set_lod", json!({
            "entityId": "entity-1",
            "lodLevel": 0
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_enter_edit_mode_reaches_edit_mode_domain() {
        let result = dispatch("enter_edit_mode", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }

    #[test]
    fn dispatch_set_sprite_data_reaches_sprites_domain() {
        let result = dispatch("set_sprite_data", json!({
            "entityId": "entity-1"
        }));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.contains("Unknown command"), "got: {}", err);
    }
}
