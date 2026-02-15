//! Animation command handlers

use crate::core::pending_commands::{
    queue_animation_request_from_bridge,
    AnimationRequest, AnimationAction,
    QueryRequest,
};

/// Dispatch animation commands
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "play_animation" => Some(handle_play_animation(payload.clone())),
        "pause_animation" => Some(handle_pause_animation(payload.clone())),
        "resume_animation" => Some(handle_resume_animation(payload.clone())),
        "stop_animation" => Some(handle_stop_animation(payload.clone())),
        "seek_animation" => Some(handle_seek_animation(payload.clone())),
        "set_animation_speed" => Some(handle_set_animation_speed(payload.clone())),
        "set_animation_loop" => Some(handle_set_animation_loop(payload.clone())),
        "set_animation_blend_weight" => Some(handle_set_blend_weight(payload.clone())),
        "set_clip_speed" => Some(handle_set_clip_speed(payload.clone())),
        "get_animation_state" | "list_animations" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId".to_string())
                .map(|s| s.to_string());
            match entity_id {
                Ok(id) => Some(super::handle_query(QueryRequest::AnimationState { entity_id: id })),
                Err(e) => Some(Err(e)),
            }
        },
        "get_animation_graph" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId".to_string())
                .map(|s| s.to_string());
            match entity_id {
                Ok(id) => Some(super::handle_query(QueryRequest::AnimationGraph { entity_id: id })),
                Err(e) => Some(Err(e)),
            }
        },
        _ => None,
    }
}

/// Handle play_animation command.
/// Payload: { entityId: string, clipName: string, crossfadeSecs?: number }
fn handle_play_animation(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_pause_animation(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_resume_animation(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_stop_animation(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_seek_animation(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_set_animation_speed(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_set_animation_loop(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_set_blend_weight(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_set_clip_speed(payload: serde_json::Value) -> super::CommandResult {
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
