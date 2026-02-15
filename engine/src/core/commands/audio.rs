//! Audio command handlers.

use serde::Deserialize;

use crate::core::pending_commands::{
    queue_audio_update_from_bridge, queue_audio_removal_from_bridge,
    queue_audio_playback_from_bridge, queue_audio_bus_update_from_bridge,
    queue_audio_bus_create_from_bridge, queue_audio_bus_delete_from_bridge,
    queue_audio_bus_effects_update_from_bridge, queue_reverb_zone_update_from_bridge,
    queue_reverb_zone_toggle_from_bridge, queue_reverb_zone_removal_from_bridge,
    AudioUpdate, AudioRemoval, AudioPlayback, AudioBusUpdate, AudioBusCreate,
    AudioBusDelete, AudioBusEffectsUpdate, ReverbZoneUpdate, ReverbZoneToggle,
    ReverbZoneRemoval, QueryRequest,
};

/// Dispatch audio commands.
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        // Audio commands
        "set_audio" => Some(handle_set_audio(payload.clone())),
        "remove_audio" => Some(handle_remove_audio(payload.clone())),
        "play_audio" => Some(handle_play_audio(payload.clone())),
        "stop_audio" => Some(handle_stop_audio(payload.clone())),
        "pause_audio" => Some(handle_pause_audio(payload.clone())),
        "get_audio" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            entity_id.map(|id| super::handle_query(QueryRequest::AudioData { entity_id: id }))
        }

        // Audio bus commands
        "update_audio_bus" => Some(handle_update_audio_bus(payload.clone())),
        "create_audio_bus" => Some(handle_create_audio_bus(payload.clone())),
        "delete_audio_bus" => Some(handle_delete_audio_bus(payload.clone())),
        "get_audio_buses" => Some(super::handle_query(QueryRequest::AudioBuses)),
        "set_bus_effects" => Some(handle_set_bus_effects(payload.clone())),

        // Reverb zone commands
        "set_reverb_zone" => Some(handle_set_reverb_zone(payload.clone())),
        "toggle_reverb_zone" => Some(handle_toggle_reverb_zone(payload.clone())),
        "remove_reverb_zone" => Some(handle_remove_reverb_zone(payload.clone())),
        "get_reverb_zone" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            entity_id.map(|id| super::handle_query(QueryRequest::ReverbZoneState { entity_id: id }))
        }

        _ => None,
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
fn handle_set_audio(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_remove_audio(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_play_audio(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_stop_audio(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_pause_audio(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_update_audio_bus(payload: serde_json::Value) -> super::CommandResult {
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
    #[serde(default = "super::default_volume")]
    volume: f32,
}

/// Handle create_audio_bus command.
fn handle_create_audio_bus(payload: serde_json::Value) -> super::CommandResult {
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
fn handle_delete_audio_bus(payload: serde_json::Value) -> super::CommandResult {
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
    effects: Vec<crate::core::audio::AudioEffectDef>,
}

/// Handle set_bus_effects command (A-2).
fn handle_set_bus_effects(payload: serde_json::Value) -> super::CommandResult {
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
// Reverb zone handlers
// ---------------------------------------------------------------------------

/// Payload for set_reverb_zone command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetReverbZonePayload {
    entity_id: String,
    #[serde(flatten)]
    reverb_data: crate::core::reverb_zone::ReverbZoneData,
}

/// Handle set_reverb_zone command.
fn handle_set_reverb_zone(payload: serde_json::Value) -> super::CommandResult {
    let data: SetReverbZonePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_reverb_zone payload: {}", e))?;

    let update = ReverbZoneUpdate {
        entity_id: data.entity_id.clone(),
        reverb_zone_data: data.reverb_data,
    };

    if queue_reverb_zone_update_from_bridge(update) {
        tracing::info!("Queued reverb zone update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle toggle_reverb_zone command.
fn handle_toggle_reverb_zone(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let enabled = payload.get("enabled")
        .and_then(|v| v.as_bool())
        .ok_or("Missing enabled")?;

    let toggle = ReverbZoneToggle {
        entity_id: entity_id.clone(),
        enabled,
    };

    if queue_reverb_zone_toggle_from_bridge(toggle) {
        tracing::info!("Queued reverb zone toggle for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_reverb_zone command.
fn handle_remove_reverb_zone(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = ReverbZoneRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_reverb_zone_removal_from_bridge(removal) {
        tracing::info!("Queued reverb zone removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
