//! Particle command handlers

use serde::Deserialize;
use crate::core::pending_commands::{
    queue_particle_update_from_bridge,
    queue_particle_removal_from_bridge,
    queue_particle_toggle_from_bridge,
    queue_particle_preset_from_bridge,
    queue_particle_playback_from_bridge,
    ParticleUpdate, ParticleRemoval, ParticleToggle, ParticlePresetRequest, ParticlePlayback,
    QueryRequest,
};
use crate::core::particles::ParticleData as CoreParticleData;

/// Dispatch particle commands
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "set_particle" => Some(handle_set_particle(payload.clone())),
        "remove_particle" => Some(handle_remove_particle(payload.clone())),
        "toggle_particle" => Some(handle_toggle_particle(payload.clone())),
        "set_particle_preset" => Some(handle_set_particle_preset(payload.clone())),
        "play_particle" => Some(handle_play_particle(payload.clone())),
        "stop_particle" => Some(handle_stop_particle(payload.clone())),
        "burst_particle" => Some(handle_burst_particle(payload.clone())),
        "get_particle" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .ok_or("Missing entityId".to_string())
                .map(|s| s.to_string());
            match entity_id {
                Ok(id) => Some(super::handle_query(QueryRequest::ParticleState { entity_id: id })),
                Err(e) => Some(Err(e)),
            }
        },
        _ => None,
    }
}

/// Payload for set_particle command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetParticlePayload {
    entity_id: String,
    #[serde(flatten)]
    particle_data: CoreParticleData,
}

/// Handle set_particle command.
fn handle_set_particle(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_remove_particle(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_toggle_particle(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_set_particle_preset(payload: serde_json::Value) -> super::CommandResult {
    let data: SetParticlePresetPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_particle_preset payload: {}", e))?;

    // Validate preset name
    use crate::core::particles::ParticlePreset as PP;
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
fn handle_play_particle(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_stop_particle(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_burst_particle(payload: serde_json::Value) -> super::CommandResult {
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
