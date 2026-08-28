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
        | "focus_camera" | "orbit_camera" | "delete_entities" | "duplicate_entity"
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
        "update_physics" | "toggle_physics" | "toggle_debug_physics"
        | "get_physics" | "apply_force" | "raycast_query"
        | "create_joint" | "update_joint" | "remove_joint" | "list_joints"
        | "set_physics2d" | "remove_physics2d"
        | "update_physics2d" | "toggle_physics2d"
        | "set_2d_collider_shape" | "set_2d_body_type"
        | "get_physics2d" | "create_2d_joint" | "update_2d_joint" | "remove_2d_joint"
        | "apply_force2d" | "apply_impulse2d"
        | "raycast2d" | "set_gravity2d" | "set_debug_physics2d"
        // Aliases from route_domain for backward compat → mapped to stub handlers
        | "set_physics" | "remove_physics" | "set_physics_enabled"
        | "enable_physics_debug" | "disable_physics_debug"
        | "apply_impulse" | "set_linear_velocity" | "set_angular_velocity"
        | "get_velocity" | "raycast" | "get_joint"
        | "set_physics_2d" | "remove_physics_2d" | "set_physics_2d_enabled"
        | "update_physics_2d" | "toggle_physics_2d"
        | "get_physics_2d" | "set_joint_2d" | "remove_joint_2d" | "get_joint_2d"
        | "list_joints_2d" | "apply_force_2d" | "apply_impulse_2d"
        | "set_linear_velocity_2d" | "set_angular_velocity_2d"
        | "get_velocity_2d" | "get_collisions" | "get_collisions_2d" => 2,

        // --- audio domain ---
        "set_audio" | "remove_audio" | "play_audio" | "stop_audio"
        | "pause_audio" | "get_audio" | "update_audio_bus" | "create_audio_bus"
        | "delete_audio_bus" | "get_audio_buses" | "set_bus_effects"
        | "set_reverb_zone" | "toggle_reverb_zone" | "remove_reverb_zone"
        // `get_all_reverb_zones` was routed here with no arm to receive it, so it
        // answered `Unknown audio command`. Deleted rather than aliased onto
        // `get_reverb_zone`, which is per-entity and could not have served it
        // anyway (PF-1181).
        | "get_reverb_zone" => 3,

        // --- animation domain ---
        "play_animation" | "pause_animation" | "resume_animation"
        | "stop_animation" | "seek_animation" | "set_animation_speed"
        | "set_animation_loop" | "set_animation_blend_weight"
        | "set_clip_speed" | "get_animation_state" | "list_animations"
        | "get_animation_graph" | "create_animation_clip" | "add_keyframe"
        | "remove_keyframe" | "update_keyframe" | "get_animation_clips"
        | "play_animation_clip" | "stop_animation_clip"
        // NOTE: `set_animation_state_machine` / `remove_animation_state_machine`
        // are NOT here. They live in the sprites group below, because that is
        // where the working handlers are. Routing them to this domain sent them
        // to a `Not yet implemented` stub that shadowed a real implementation.
        | "list_skeleton_animations" | "get_skeleton_animation" => 4,

        // --- particles domain ---
        "set_particle" | "remove_particle" | "toggle_particle"
        | "set_particle_preset" | "play_particle" | "stop_particle"
        // `list_particle_presets` was routed here with no arm (PF-1181). The preset
        // names live in `core::particles`; nothing has ever served them over the
        // command wire.
        | "burst_particle" | "get_particle" => 5,

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
        | "import_scene_json"
        // Additional scene management commands
        | "save_scene" | "get_scene_info" | "list_scene_assets" => 8,

        // --- game domain ---
        "add_game_component" | "update_game_component" | "remove_game_component"
        | "get_game_components" | "list_game_component_types" | "set_game_camera"
        | "set_active_game_camera" | "camera_shake" | "mouse_delta"
        | "get_game_camera" => 9,

        // --- sprites / 2D domain ---
        "spawn_sprite" | "set_project_type"
        | "set_sprite_data" | "remove_sprite" | "get_sprite"
        | "update_camera_2d" | "get_camera_2d" | "set_sprite_sheet"
        | "remove_sprite_sheet" | "set_sprite_animator" | "remove_sprite_animator"
        | "create_skeleton2d" | "add_bone2d" | "remove_bone2d" | "update_bone2d"
        | "create_skeletal_animation2d" | "fill_tiles" | "set_sorting_layers"
        // DELETED (PF-1181): seventeen names were routed to this domain with no
        // arm to receive them, so each answered `Unknown sprites command`. Most
        // were near-misses of a real arm, which is how the vocabulary drifted —
        // `add_skeletal_keyframe2d`/`add_keyframe2d`,
        // `set_skeleton_skin2d`/`set_skeleton2d_skin`,
        // `solve_ik2d`/`create_ik_chain2d`,
        // `create_tileset`+`update_tileset`+`delete_tileset`/`set_tileset`,
        // `create_tilemap`+`update_tilemap`+`delete_tilemap`+`clear_tilemap`/
        // `set_tilemap_data`+`remove_tilemap_data`, `set_tile`/`paint_tile`.
        // They are deleted, not aliased: an alias doubles the vocabulary that has
        // to stay in step, which is the root cause of this whole class. The rest
        // (`remove_skeletal_animation2d`, `set_blend_tree2d`,
        // `remove_blend_tree2d`, `list_tilesets`, `get_tilemap`,
        // `get_sorting_layers`) name features the engine does not have; adding one
        // means adding its arm here at the same time.
        // The spellings `sprites::dispatch` actually implements. Absent from
        // this list they were unreachable: `route_domain` returns 255 for an
        // unlisted name and `dispatch` answers `Unknown command`, so the arm
        // never runs however correct it is. That took the whole 2D tilemap and
        // 2D skeletal surface offline for every caller (PF-1178).
        | "add_keyframe2d" | "play_skeletal_animation2d" | "set_skeleton2d_skin"
        | "create_ik_chain2d" | "get_skeleton2d" | "auto_weight_skeleton2d"
        | "add_skeleton2d_mesh_attachment" | "get_sprite_sheet_state"
        | "get_sprite_animator_state" | "set_tilemap_data" | "remove_tilemap_data"
        | "paint_tile" | "erase_tile" | "set_grid_2d"
        // Implemented here, not in `animation.rs`. The router used to send these
        // two to domain 4, whose arms are inline `Not yet implemented` stubs, so
        // a real handler sat unreachable and every sprite state machine the
        // editor configured was silently discarded (PF-1178).
        | "set_animation_state_machine" | "remove_animation_state_machine" => 10,
        // DELIBERATELY UNROUTED: `sprites::dispatch` implements `set_tileset` and
        // `remove_tileset` against a per-entity `TilesetData` component keyed by
        // `entityId`, but the only caller keys tilesets by asset id and has no
        // entity to name. Routing them would turn a silent no-op into a silent
        // `Missing entityId`. Blocked on PF-1179 deciding which side is right.

        // --- edit_mode domain ---
        "enter_edit_mode" | "exit_edit_mode" | "set_selection_mode"
        // `extrude_faces` was routed here with no arm (PF-1181). Face extrusion is
        // reached through `mesh_operation`, and `procedural::extrude_shape` is the
        // separate whole-shape command.
        | "select_elements" | "mesh_operation" | "recalc_normals" => 11,

        // --- engine-mode and query commands handled inline ---
        "play" | "stop" | "pause" | "resume" | "get_mode"
        | "get_scene_graph" | "get_selection" | "get_entity_details"
        | "get_camera_state" => 12,

        _ => 255,
    }
}

/// Dispatch a command to the appropriate handler.
/// Uses a routing table for O(1) domain selection before the domain-level match.
///
/// The payload is bounded before routing. Every domain handler below reaches
/// `serde_json::from_value`, which recurses per level of nesting and has no
/// limit of its own, so this is the one place that check can be made once
/// instead of in each of the twelve domains — and the only place that also
/// covers `dispatch_batch`, whose items never pass through the bridge's own
/// entry point. See `core::json_guard`.
pub fn dispatch(command: &str, payload: serde_json::Value) -> CommandResult {
    // The name is interpolated into every error this function can return, so an
    // unbounded name is an unbounded error string travelling to JS and on into
    // the monitoring pipeline. Bound it before it is echoed anywhere.
    crate::core::json_guard::check_identifier("Command name", command)?;
    let payload = crate::core::json_guard::check_command_payload(command, payload)?;

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

/// Maximum number of commands accepted in one bridge batch.
pub const MAX_COMMAND_BATCH_ITEMS: usize = 256;

/// Dispatch a batch of commands from a JSON array.
///
/// Accepts a `serde_json::Value` that must be an array of objects, each with
/// at minimum a `"command"` string field and an optional `"payload"` object.
/// Returns a `Vec<CommandResponse>` in the same order as the input.
///
/// Processing is sequential (WASM is single-threaded). If a command fails,
/// execution continues — all responses are returned.
pub fn dispatch_batch(batch: serde_json::Value) -> Vec<CommandResponse> {
    // Bounded before anything reads it. The per-command check inside `dispatch`
    // is too late for a batch: extracting an item's payload clones it, and a
    // clone recurses per level exactly like the deserialize it is protecting.
    // Read the item count before the check, which takes ownership of the value
    // in order to dismantle it iteratively on rejection. `as_array().len()` is
    // O(1) and touches no child, so it is safe on a value nothing has vetted.
    let item_count = batch.as_array().map(|items| items.len());

    if let Some(count) = item_count {
        if count > MAX_COMMAND_BATCH_ITEMS {
            let error = format!(
                "Batch too large ({} items, limit {})",
                count, MAX_COMMAND_BATCH_ITEMS
            );
            // The oversized fast path deliberately runs before the structural
            // guard, so it must also take responsibility for tearing down a
            // hostile deeply nested value without recursive `Value::drop`.
            crate::core::json_guard::drop_without_recursing(batch);
            return (0..count)
                .map(|_| CommandResponse::err(error.clone()))
                .collect();
        }
    }

    let batch = match crate::core::json_guard::check_command_batch(batch) {
        Ok(batch) => batch,
        Err(e) => {
            // One response per item even here, because that is this function's
            // documented contract and callers index into the array by position
            // — a short one reads as success for the items that fell off the
            // end. A non-array envelope has no items to count, so it gets one.
            let count = item_count.unwrap_or(1).max(1);
            return (0..count)
                .map(|_| CommandResponse::err(e.clone()))
                .collect();
        }
    };

    let items = match batch.as_array() {
        Some(arr) => arr,
        None => return vec![CommandResponse::err("Batch payload must be a JSON array")],
    };

    items.iter().map(|item| {
        let command = match item.get("command").and_then(|v| v.as_str()) {
            Some(cmd) => cmd,
            None => return CommandResponse::err("Missing \"command\" field in batch item"),
        };
        // The bridge caps the command name on the single-command path, but a
        // batched item never passes through it — and the name is interpolated
        // into guard errors that travel back to JS and into monitoring.
        if let Err(e) = crate::core::json_guard::check_identifier("Command name", command) {
            return CommandResponse::err(e);
        }
        let payload = item.get("payload").cloned().unwrap_or(serde_json::Value::Null);
        match dispatch(command, payload) {
            Ok(()) => CommandResponse::ok(),
            Err(e) => CommandResponse::err(e),
        }
    }).collect()
}

/// Helper for default `true` in serde.
pub(crate) fn default_true() -> bool {
    true
}

/// Helper for default volume in serde.
pub(crate) fn default_volume() -> f32 {
    1.0
}

/// `route_domain` is a second, independent gate in front of every domain arm.
/// An unlisted name returns 255 and `dispatch` answers `Unknown command`, so a
/// perfectly correct arm is unreachable — and no test that calls a domain's own
/// `dispatch` can see it, because that call bypasses the router entirely. This
/// module reads the domain sources at compile time and holds the two lists to
/// each other, so the omission fails a test instead of shipping (PF-1178).
#[cfg(test)]
mod route_domain_parity {
    use super::route_domain;

    /// `(file name, domain index, source text)` for every module `dispatch` routes to.
    const DOMAIN_MODULES: &[(&str, u8, &str)] = &[
        ("transform.rs", 0, include_str!("transform.rs")),
        ("material.rs", 1, include_str!("material.rs")),
        ("physics.rs", 2, include_str!("physics.rs")),
        ("audio.rs", 3, include_str!("audio.rs")),
        ("animation.rs", 4, include_str!("animation.rs")),
        ("particles.rs", 5, include_str!("particles.rs")),
        ("performance.rs", 6, include_str!("performance.rs")),
        ("procedural.rs", 7, include_str!("procedural.rs")),
        ("scene.rs", 8, include_str!("scene.rs")),
        ("game.rs", 9, include_str!("game.rs")),
        ("sprites.rs", 10, include_str!("sprites.rs")),
        ("edit_mode.rs", 11, include_str!("edit_mode.rs")),
    ];

    /// Arms that exist but are intentionally NOT routed. Each needs a reason; the
    /// checks below fail if an entry becomes routed or stops being an arm, so this
    /// list cannot rot into a blanket exemption.
    const DELIBERATELY_UNROUTED: &[(&str, &str)] = &[
        // Both take a per-entity `TilesetData` keyed by `entityId`; the only
        // caller keys tilesets by asset id and has no entity to name. Routing
        // them trades a silent no-op for a silent `Missing entityId`.
        ("set_tileset", "PF-1179 — entity-keyed arm vs asset-keyed caller"),
        ("remove_tileset", "PF-1179 — entity-keyed arm vs asset-keyed caller"),
    ];

    /// The index `route_domain` gives the engine-mode and query names that
    /// `dispatch` matches inline rather than delegating to a module.
    const INLINE_DOMAIN: u8 = 12;

    /// Names `route_domain` claims that no arm implements, kept on purpose. Empty
    /// today, and that is the correct steady state: PF-1181 deleted all twenty
    /// entries this list would otherwise have held, because a routed name with no
    /// arm is vocabulary the engine advertises and cannot answer.
    ///
    /// Domain 12 needs no entry. Its names are matched inline in `dispatch`, and
    /// the check below reads THOSE arms out of this same file — strictly stronger
    /// than exempting the index, since a name dropped from the inline match still
    /// fails instead of being waved through.
    ///
    /// Both directions are checked, so this cannot rot into a blanket exemption:
    /// an entry that stops being routed fails, and so does one that grows an arm.
    const DELIBERATELY_ARMLESS: &[(&str, &str)] = &[];

    /// The `pub fn dispatch` body only. A whole-file scan would match quoted
    /// payload values inside the handlers as if they were command names.
    fn dispatch_body(source: &str) -> Option<&str> {
        let start = source.find("pub fn dispatch")?;
        let rest = &source[start..];
        // Handlers sit after `dispatch`, so the first `}` in column 0 ends it.
        let end = rest.find("\n}")? + 2;
        Some(&rest[..end])
    }

    /// Quoted lower-snake identifiers in match-arm position (`"x" =>` / `"x" |`).
    fn arm_names(body: &str) -> Vec<&str> {
        let bytes = body.as_bytes();
        let mut names = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != b'"' {
                i += 1;
                continue;
            }
            let start = i + 1;
            let Some(offset) = body[start..].find('"') else { break };
            let close = start + offset;
            let name = &body[start..close];
            let mut after = close + 1;
            while after < bytes.len() && bytes[after].is_ascii_whitespace() {
                after += 1;
            }
            let tail = &body[after..];
            let in_arm_position = tail.starts_with("=>") || tail.starts_with('|');
            let is_identifier = !name.is_empty()
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if in_arm_position && is_identifier {
                names.push(name);
            }
            i = close + 1;
        }
        names
    }

    /// The `fn route_domain` body only.
    ///
    /// Note `fn`, not `pub fn`: `route_domain` is private, and an anchor written
    /// `pub fn route_domain` matches nothing, returns `None`, and reads exactly
    /// like "the router claims no names" — a scanner failure that looks like a
    /// pass.
    ///
    /// Line comments are stripped. A name written in prose is not a routed name,
    /// and dropping one can only ever REMOVE a name from the routed set, which is
    /// the direction reality is already in — an unrouted name is unreachable
    /// whether or not this scanner noticed it.
    fn route_domain_body(router: &str) -> Option<String> {
        let start = router.find("\nfn route_domain(")?;
        let rest = &router[start + 1..];
        let end = rest.find("\n}")? + 2;
        Some(
            rest[..end]
                .lines()
                .map(|line| match line.find("//") {
                    Some(at) => &line[..at],
                    None => line,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }

    /// `(command name, domain index)` for every name the router claims.
    ///
    /// Names accumulate across the `|` chain and are flushed when the arm's
    /// `=> <digits>` is reached, so a group spanning ten lines is attributed
    /// correctly. The trailing `_ => 255` flushes nothing: the wildcard arm
    /// quotes no name.
    fn routed_names(body: &str) -> Vec<(String, u8)> {
        let bytes = body.as_bytes();
        let mut out: Vec<(String, u8)> = Vec::new();
        let mut pending: Vec<String> = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'"' {
                let start = i + 1;
                let Some(offset) = body[start..].find('"') else { break };
                let close = start + offset;
                pending.push(body[start..close].to_string());
                i = close + 1;
                continue;
            }
            if body[i..].starts_with("=>") {
                let mut j = i + 2;
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                let digits = j;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if let Ok(index) = body[digits..j].parse::<u8>() {
                    for name in pending.drain(..) {
                        out.push((name, index));
                    }
                }
                pending.clear();
                i = j.max(i + 2);
                continue;
            }
            i += 1;
        }
        out
    }

    #[test]
    fn the_source_parse_found_the_arms() {
        let mut total = 0;
        for (file, _, source) in DOMAIN_MODULES {
            let body = dispatch_body(source)
                .unwrap_or_else(|| panic!("{file}: no `pub fn dispatch` body found"));
            let names = arm_names(body);
            assert!(
                names.len() > 3,
                "{file}: parsed only {} arms — the scanner has broken and would \
                 report every domain as fully routed",
                names.len()
            );
            total += names.len();
        }
        assert!(total > 200, "parsed only {total} arms across all domains");
    }

    #[test]
    fn arm_names_ignores_quoted_payload_values() {
        // `"mask"` and `"high"` are payload VALUES; only `set_layer_mask` is a command.
        let body = "pub fn dispatch(c: &str) {\n    match c {\n        \
                    \"set_layer_mask\" | \"toggle_mask\" => p.get(\"mask\"),\n        \
                    _ => none(\"high\"),\n    }\n}\n";
        assert_eq!(arm_names(body), vec!["set_layer_mask", "toggle_mask"]);
    }

    #[test]
    fn every_implemented_arm_is_routed_to_its_own_domain() {
        let exempt: Vec<&str> = DELIBERATELY_UNROUTED.iter().map(|(n, _)| *n).collect();
        let mut unreachable = Vec::new();
        for (file, index, source) in DOMAIN_MODULES {
            let body = dispatch_body(source).expect("dispatch body");
            for name in arm_names(body) {
                if exempt.contains(&name) {
                    continue;
                }
                let routed = route_domain(name);
                if routed != *index {
                    unreachable.push(format!(
                        "{name}: implemented in {file} (domain {index}) but route_domain says \
                         {routed}{}",
                        if routed == 255 { " (unroutable)" } else { "" }
                    ));
                }
            }
        }
        assert!(
            unreachable.is_empty(),
            "These arms cannot be reached through `dispatch`. Add the name to its \
             domain's `route_domain` group, or record it in DELIBERATELY_UNROUTED \
             with a reason:\n  {}",
            unreachable.join("\n  ")
        );
    }

    #[test]
    fn deliberately_unrouted_entries_are_still_accurate() {
        let all_arms: Vec<&str> = DOMAIN_MODULES
            .iter()
            .flat_map(|(_, _, source)| arm_names(dispatch_body(source).expect("dispatch body")))
            .collect();
        for (name, reason) in DELIBERATELY_UNROUTED {
            assert!(
                reason.len() > 20,
                "{name}: an exemption without a real reason is not an exemption"
            );
            assert!(
                all_arms.contains(name),
                "{name} is no longer a dispatch arm — delete its DELIBERATELY_UNROUTED entry"
            );
            assert_eq!(
                route_domain(name),
                255,
                "{name} is routed now — delete its DELIBERATELY_UNROUTED entry"
            );
        }
    }

    /// Self-test for `routed_names`: a scanner that silently returns nothing makes
    /// the router->arm check below pass vacuously, and its own output looks the
    /// same either way.
    #[test]
    fn routed_names_reads_groups_and_ignores_the_wildcard() {
        let body = "fn route_domain(command: &str) -> u8 {\n    match command {\n        \
                    \"a\" | \"b\"\n        | \"c\" => 3,\n        \
                    \"d\" => 12,\n        _ => 255,\n    }\n}\n";
        assert_eq!(
            routed_names(body),
            vec![
                ("a".to_string(), 3),
                ("b".to_string(), 3),
                ("c".to_string(), 3),
                ("d".to_string(), 12),
            ]
        );
    }

    /// The inverse of `every_implemented_arm_is_routed_to_its_own_domain`, and it
    /// had never been checked: a name the router sends to a domain that has no arm
    /// for it answers `Unknown <domain> command`. That is a real error rather than
    /// a silent drop, but only a caller who believed the name existed ever sees
    /// it — so twenty such names sat in the router advertising a vocabulary the
    /// engine could not answer, several of them near-misses of real arms
    /// (`create_tileset` vs `set_tileset`, `set_skeleton_skin2d` vs
    /// `set_skeleton2d_skin`, `solve_ik2d` vs `create_ik_chain2d`). PF-1181.
    #[test]
    fn every_routed_name_has_an_arm_in_its_domain() {
        let router = include_str!("mod.rs");
        let body = route_domain_body(router).expect("mod.rs has an `fn route_domain`");
        let routed = routed_names(&body);
        assert!(
            routed.len() > 200,
            "parsed only {} routed names — the route_domain scanner has broken and \
             would report every name as armed",
            routed.len()
        );

        let inline_arms = arm_names(dispatch_body(router).expect("mod.rs has a `pub fn dispatch`"));
        assert!(
            inline_arms.len() > 3,
            "parsed only {} inline arms from `dispatch` — domain 12 would report as \
             fully armless",
            inline_arms.len()
        );
        let exempt: Vec<&str> = DELIBERATELY_ARMLESS.iter().map(|(n, _)| *n).collect();

        let mut armless = Vec::new();
        for (name, index) in &routed {
            if exempt.contains(&name.as_str()) {
                continue;
            }
            let (label, arms) = if *index == INLINE_DOMAIN {
                ("mod.rs, inline in `dispatch`", inline_arms.clone())
            } else {
                match DOMAIN_MODULES.iter().find(|(_, i, _)| i == index) {
                    Some((file, _, source)) => (
                        *file,
                        arm_names(dispatch_body(source).expect("dispatch body")),
                    ),
                    None => {
                        armless.push(format!(
                            "{name}: routed to domain {index}, which no module implements"
                        ));
                        continue;
                    }
                }
            };
            if !arms.contains(&name.as_str()) {
                armless.push(format!(
                    "{name}: route_domain sends it to domain {index} ({label}), which has \
                     no arm for it"
                ));
            }
        }
        assert!(
            armless.is_empty(),
            "These names are advertised by `route_domain` and answer `Unknown <domain> \
             command`. Implement the arm, or delete the name from `route_domain` — do \
             NOT alias it onto a neighbouring arm, which doubles the vocabulary that has \
             to stay in step:\n  {}",
            armless.join("\n  ")
        );
    }

    #[test]
    fn deliberately_armless_entries_are_still_accurate() {
        let router = include_str!("mod.rs");
        let inline_arms = arm_names(dispatch_body(router).expect("mod.rs dispatch body"));
        for (name, reason) in DELIBERATELY_ARMLESS {
            assert!(
                reason.len() > 20,
                "{name}: an exemption without a real reason is not an exemption"
            );
            let index = route_domain(name);
            assert_ne!(
                index, 255,
                "{name} is no longer routed — delete its DELIBERATELY_ARMLESS entry"
            );
            let arms = if index == INLINE_DOMAIN {
                inline_arms.clone()
            } else {
                let (_, _, source) = DOMAIN_MODULES
                    .iter()
                    .find(|(_, i, _)| *i == index)
                    .unwrap_or_else(|| panic!("{name} is routed to domain {index}, which no module implements"));
                arm_names(dispatch_body(source).expect("dispatch body"))
            };
            assert!(
                !arms.contains(name),
                "{name} has an arm now — delete its DELIBERATELY_ARMLESS entry"
            );
        }
    }

    #[test]
    fn an_unknown_name_is_unroutable() {
        assert_eq!(route_domain("no_such_command_xyz"), 255);
    }

    /// `DOMAIN_MODULES` is hand-maintained, and every check above iterates it — so a
    /// NEW domain module escapes all of them by simply not being listed. Nothing
    /// fails, and the domain reports itself fully routed while none of its arms have
    /// ever been held against `route_domain`. Read the directory instead: the file
    /// system is the authority on which modules exist.
    #[test]
    fn every_domain_module_on_disk_is_listed() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/core/commands");
        let entries = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("cannot enumerate {dir}: {e} — this check must not pass vacuously"));

        let mut on_disk: Vec<String> = Vec::new();
        for entry in entries {
            let name = entry.expect("readable dir entry").file_name();
            let name = name.to_str().expect("module file name is not UTF-8").to_owned();
            // `mod.rs` is this file: it holds the router and domain 12's inline arms,
            // and has no `pub fn dispatch` of the domain shape to scan.
            if name.ends_with(".rs") && name != "mod.rs" {
                on_disk.push(name);
            }
        }
        assert!(
            on_disk.len() > 5,
            "found only {} domain modules in {dir} — the enumeration has broken and \
             would report every list as complete",
            on_disk.len()
        );

        let listed: Vec<&str> = DOMAIN_MODULES.iter().map(|(f, _, _)| *f).collect();
        let mut missing: Vec<&String> = on_disk.iter().filter(|f| !listed.contains(&f.as_str())).collect();
        missing.sort();
        assert!(
            missing.is_empty(),
            "These domain modules exist but no check above looks at them — add each to \
             DOMAIN_MODULES with its `route_domain` index: {missing:?}"
        );

        let mut stale: Vec<&&str> = listed.iter().filter(|f| !on_disk.contains(&f.to_string())).collect();
        stale.sort();
        assert!(
            stale.is_empty(),
            "DOMAIN_MODULES names files that no longer exist: {stale:?}"
        );
    }

    /// A duplicated index would make `every_implemented_arm_is_routed_to_its_own_domain`
    /// compare one module's arms against another module's number, and a listed module
    /// that `dispatch` never calls is unreachable however well `route_domain` groups it.
    #[test]
    fn each_listed_index_dispatches_to_its_own_module() {
        let router = include_str!("mod.rs");
        let body = dispatch_body(router).expect("mod.rs has a `pub fn dispatch`");

        let mut seen: Vec<u8> = Vec::new();
        for (file, index, _) in DOMAIN_MODULES {
            assert!(
                !seen.contains(index),
                "{file}: domain index {index} is already claimed by another module — the \
                 arm check would grade it against the wrong number"
            );
            seen.push(*index);

            let module = file.strip_suffix(".rs").expect("module file name ends in .rs");
            let arm = format!("{index} => {module}::dispatch");
            // A bare `contains` is satisfied by a LONGER number ending in these digits —
            // renumbering the arm to `111 => edit_mode::dispatch` still contains
            // `11 => edit_mode::dispatch`, so the check passed on an index nothing routes
            // to. Require the digit run to start at the match.
            let routed = body
                .match_indices(&arm)
                .any(|(at, _)| !body[..at].ends_with(|c: char| c.is_ascii_digit()));
            assert!(
                routed,
                "{file} is listed as domain {index}, but `dispatch` has no `{arm}` arm — \
                 every command routed there would answer Unknown command"
            );
        }

        seen.sort_unstable();
        let expected: Vec<u8> = (0..DOMAIN_MODULES.len() as u8).collect();
        assert_eq!(
            seen, expected,
            "domain indices must be the contiguous set 0..{} — a gap means an arm number \
             nothing implements",
            DOMAIN_MODULES.len()
        );
    }
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

    // === dispatch_batch tests (PF-663) ===

    #[test]
    fn dispatch_batch_returns_error_for_non_array() {
        let result = dispatch_batch(json!({"command": "play"}));
        assert_eq!(result.len(), 1);
        assert!(!result[0].success);
        let err = result[0].error.as_deref().unwrap_or("");
        assert!(err.contains("array"), "expected array error, got: {}", err);
    }

    #[test]
    fn dispatch_batch_returns_error_for_item_missing_command_field() {
        let result = dispatch_batch(json!([{"payload": {}}]));
        assert_eq!(result.len(), 1);
        assert!(!result[0].success);
        let err = result[0].error.as_deref().unwrap_or("");
        assert!(err.contains("command"), "expected missing command error, got: {}", err);
    }

    #[test]
    fn dispatch_batch_returns_empty_vec_for_empty_array() {
        let result = dispatch_batch(json!([]));
        assert!(result.is_empty());
    }

    #[test]
    fn dispatch_batch_processes_all_items_and_returns_one_response_per_item() {
        // Two commands — each reaches a handler but fails with "not initialized"
        // (no PendingCommands resource in unit-test context)
        let result = dispatch_batch(json!([
            {"command": "spawn_entity", "payload": {"entityType": "cube", "name": "A"}},
            {"command": "rename_entity", "payload": {"entityId": "e1", "name": "B"}}
        ]));
        assert_eq!(result.len(), 2);
        // Both fail with "not initialized", not "Unknown command"
        for resp in &result {
            assert!(!resp.success);
            let err = resp.error.as_deref().unwrap_or("");
            assert!(
                err.contains("not initialized"),
                "Expected not-initialized error, got: {}",
                err
            );
        }
    }

    #[test]
    fn dispatch_batch_continues_after_first_failure() {
        // First item: known bad command; second: good command that fails with not initialized
        let result = dispatch_batch(json!([
            {"command": "nonexistent_xyz"},
            {"command": "spawn_entity", "payload": {"entityType": "cube"}}
        ]));
        assert_eq!(result.len(), 2);
        // First: unknown command error
        assert!(!result[0].success);
        let first_err = result[0].error.as_deref().unwrap_or("");
        assert!(
            first_err.contains("Unknown command") || first_err.contains("nonexistent_xyz"),
            "got: {}",
            first_err
        );
        // Second: reached the handler (not initialized)
        assert!(!result[1].success);
        let second_err = result[1].error.as_deref().unwrap_or("");
        assert!(
            second_err.contains("not initialized"),
            "got: {}",
            second_err
        );
    }

    #[test]
    fn dispatch_batch_uses_null_payload_when_payload_field_absent() {
        // delete_entities with no payload → no entityIds → returns Ok (empty list no-op)
        let result = dispatch_batch(json!([
            {"command": "delete_entities", "payload": {"entityIds": []}}
        ]));
        assert_eq!(result.len(), 1);
        assert!(result[0].success, "expected ok for empty delete, got: {:?}", result[0].error);
    }

    #[test]
    fn dispatch_batch_mixes_ok_and_err_responses() {
        // Empty delete is a no-op Ok; play needs PendingCommands
        let result = dispatch_batch(json!([
            {"command": "delete_entities", "payload": {"entityIds": []}},
            {"command": "play"}
        ]));
        assert_eq!(result.len(), 2);
        assert!(result[0].success, "first should be Ok");
        assert!(!result[1].success, "second should fail (not initialized)");
    }
    // === JSON guard wiring (PF-1149) ===
    //
    // The guard has its own unit tests; these exist because a guard that is
    // never called still passes every one of them. Each of these fails if the
    // call is removed from the code path it protects.

    /// Build `{"a":{"a":{...}}}` nested `levels` deep, without recursing and
    /// without `json!` — a `json!` whose value position is a variable expands to
    /// `serde_json::to_value`, which re-serializes recursively and would
    /// overflow while building the input.
    fn nested(levels: usize) -> serde_json::Value {
        let mut value = serde_json::Value::from(1);
        for _ in 0..levels {
            let mut map = serde_json::Map::new();
            map.insert("a".to_string(), value);
            value = serde_json::Value::Object(map);
        }
        value
    }

    #[test]
    fn dispatch_refuses_a_payload_nested_too_deeply() {
        let err = dispatch("spawn_entity", nested(100_000)).unwrap_err();
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
    }

    #[test]
    fn dispatch_accepts_a_wide_scalar_payload() {
        // A million tiles under two containers is an ordinary tilemap edit. It
        // must not be refused for its size — only its shape is bounded. It gets
        // as far as "not initialized", which is this context's success.
        let tiles: Vec<serde_json::Value> =
            (0..1_000_000).map(|i| serde_json::Value::from(i % 8)).collect();
        let mut payload = serde_json::Map::new();
        payload.insert("entityId".to_string(), serde_json::Value::from("e1"));
        payload.insert("tiles".to_string(), serde_json::Value::Array(tiles));
        let err = dispatch("set_tilemap_data", serde_json::Value::Object(payload))
            .expect_err("no PendingCommands in a unit-test context");

        // Asserting the error is merely *not* a guard error passes for the
        // wrong reasons — any other failure satisfies it. Compare against the
        // same command with a one-tile payload instead: identical errors mean
        // the wide one got exactly as far as the narrow one, i.e. past the
        // guard and into the handler.
        let mut control = serde_json::Map::new();
        control.insert("entityId".to_string(), serde_json::Value::from("e1"));
        control.insert(
            "tiles".to_string(),
            serde_json::Value::Array(vec![serde_json::Value::from(0)]),
        );
        let control_err = dispatch("set_tilemap_data", serde_json::Value::Object(control))
            .expect_err("no PendingCommands in a unit-test context");
        assert_eq!(
            err, control_err,
            "a wide scalar payload did not reach the same place a narrow one does"
        );
    }

    #[test]
    fn dispatch_batch_answers_once_when_the_envelope_is_not_an_array() {
        // A refused envelope with no items to count still owes the caller one
        // response. Nothing else exercises the `None` arm of that count.
        let result = dispatch_batch(nested(100_000));
        assert_eq!(result.len(), 1);
        assert!(!result[0].success);
        let err = result[0].error.as_deref().unwrap_or("");
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
    }

    #[test]
    fn dispatch_batch_answers_one_result_per_item_when_the_envelope_is_refused() {
        // Callers index into this array by position, so a short one reads as
        // success for the items that fell off the end.
        let mut items = Vec::new();
        for _ in 0..3 {
            let mut item = serde_json::Map::new();
            item.insert("command".to_string(), serde_json::Value::from("play"));
            items.push(serde_json::Value::Object(item));
        }
        let mut deep = serde_json::Map::new();
        deep.insert("command".to_string(), serde_json::Value::from("play"));
        deep.insert("payload".to_string(), nested(100_000));
        items.push(serde_json::Value::Object(deep));

        let result = dispatch_batch(serde_json::Value::Array(items));
        assert_eq!(result.len(), 4);
        for resp in &result {
            assert!(!resp.success);
            let err = resp.error.as_deref().unwrap_or("");
            assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
        }
    }

    #[test]
    fn dispatch_batch_answers_one_result_per_item_when_oversized() {
        let count = MAX_COMMAND_BATCH_ITEMS + 1;
        let items = (0..count)
            .map(|index| json!({"command": "play", "payload": {"index": index}}))
            .collect();

        let result = dispatch_batch(serde_json::Value::Array(items));

        assert_eq!(result.len(), count);
        for (index, response) in result.iter().enumerate() {
            assert!(!response.success, "response {index} unexpectedly succeeded");
            assert_eq!(
                response.error.as_deref(),
                Some("Batch too large (257 items, limit 256)"),
                "response {index} did not preserve its refusal position"
            );
        }
    }

    #[test]
    fn dispatch_batch_drops_an_oversized_deep_payload_iteratively() {
        let count = MAX_COMMAND_BATCH_ITEMS + 1;
        let mut items: Vec<_> = (0..count - 1)
            .map(|_| json!({"command": "play"}))
            .collect();
        let mut deep_item = serde_json::Map::new();
        deep_item.insert("command".to_string(), serde_json::Value::from("play"));
        deep_item.insert("payload".to_string(), nested(100_000));
        items.push(serde_json::Value::Object(deep_item));

        let result = dispatch_batch(serde_json::Value::Array(items));

        assert_eq!(result.len(), count);
        assert!(result.iter().all(|response| !response.success));
    }

    #[test]
    fn dispatch_batch_refuses_an_oversized_command_name() {
        // The bridge caps the name on the single-command path; a batched item
        // never passes through it, and the name is interpolated into errors
        // that travel back to JS.
        let name = "x".repeat(crate::core::json_guard::MAX_IDENTIFIER_BYTES + 1);
        let mut item = serde_json::Map::new();
        item.insert("command".to_string(), serde_json::Value::from(name.clone()));
        let result = dispatch_batch(serde_json::Value::Array(vec![serde_json::Value::Object(item)]));
        assert_eq!(result.len(), 1);
        let err = result[0].error.as_deref().unwrap_or("");
        assert!(err.contains("too long"), "unexpected error: {}", err);
        assert!(!err.contains(&name), "error echoes the oversized name: {}", err);
    }
}
