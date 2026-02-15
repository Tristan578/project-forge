//! Command handling - pure Rust logic for processing commands from the frontend.
//! Split into domain modules for maintainability.

mod transform;
mod material;
mod physics;
mod audio;
mod animation;
mod particles;
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

/// Dispatch a command to the appropriate handler.
/// Each domain module tries to handle the command; first match wins.
pub fn dispatch(command: &str, payload: serde_json::Value) -> CommandResult {
    // Try each domain dispatcher in turn
    if let Some(result) = transform::dispatch(command, &payload) { return result; }
    if let Some(result) = material::dispatch(command, &payload) { return result; }
    if let Some(result) = physics::dispatch(command, &payload) { return result; }
    if let Some(result) = audio::dispatch(command, &payload) { return result; }
    if let Some(result) = animation::dispatch(command, &payload) { return result; }
    if let Some(result) = particles::dispatch(command, &payload) { return result; }
    if let Some(result) = procedural::dispatch(command, &payload) { return result; }
    if let Some(result) = scene::dispatch(command, &payload) { return result; }
    if let Some(result) = game::dispatch(command, &payload) { return result; }
    if let Some(result) = sprites::dispatch(command, &payload) { return result; }
    if let Some(result) = edit_mode::dispatch(command, &payload) { return result; }

    // Mode commands (play/stop/pause/resume)
    match command {
        "play" => handle_mode_change(ModeChangeRequest::Play),
        "stop" => handle_mode_change(ModeChangeRequest::Stop),
        "pause" => handle_mode_change(ModeChangeRequest::Pause),
        "resume" => handle_mode_change(ModeChangeRequest::Resume),
        "get_mode" => handle_query(QueryRequest::EngineMode),
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
