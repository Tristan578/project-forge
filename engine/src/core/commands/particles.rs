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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parity_util::assert_arm_coverage;
    use crate::core::particles::{ParticleBlendMode, ParticleOrientation, ParticlePreset, SpawnerMode};
    use crate::core::pending::{
        register_pending_commands, unregister_pending_commands, PendingCommands,
    };
    use serde_json::json;

    const MODULE_SOURCE: &str = include_str!("particles.rs");
    const BRIDGE_SOURCE: &str = include_str!("../../bridge/particles.rs");
    const DISPATCH_MARKER: &str = "pub fn dispatch(command: &str, payload: &serde_json::Value)";

    /// Every command this module answers, checked against the production `match`
    /// in both directions by `every_dispatch_arm_is_covered`.
    const TESTED_ARMS: &[&str] = &[
        "set_particle",
        "remove_particle",
        "toggle_particle",
        "set_particle_preset",
        "play_particle",
        "stop_particle",
        "burst_particle",
        "get_particle",
    ];

    /// Clears the thread-local pointer even if the test panics, so the next test
    /// on this thread cannot inherit a pointer into a dropped stack frame.
    struct PendingGuard;

    impl Drop for PendingGuard {
        fn drop(&mut self) {
            unregister_pending_commands();
        }
    }

    /// `set_particle` replaces the whole `ParticleData` component — the bridge
    /// does `commands.entity(e).insert(update.particle_data)`. So the payload has
    /// to carry every field; there are no serde defaults and a partial payload is
    /// rejected. `set_particle_names_the_field_a_partial_payload_is_missing`
    /// pins that, because a caller sending a patch gets a confusing error.
    fn full_particle_data() -> serde_json::Value {
        json!({
            "preset": "custom",
            "spawnerMode": {"type": "continuous", "rate": 50.0},
            "maxParticles": 1000,
            "lifetimeMin": 1.0,
            "lifetimeMax": 2.0,
            "emissionShape": {"type": "point"},
            "velocityMin": [0.0, 1.0, 0.0],
            "velocityMax": [0.0, 2.0, 0.0],
            "acceleration": [0.0, 0.0, 0.0],
            "linearDrag": 0.0,
            "sizeStart": 0.1,
            "sizeEnd": 0.0,
            "sizeKeyframes": [],
            "colorGradient": [
                {"position": 0.0, "color": [1.0, 1.0, 1.0, 1.0]},
                {"position": 1.0, "color": [1.0, 1.0, 1.0, 0.0]}
            ],
            "blendMode": "alpha_blend",
            "orientation": "billboard",
            "worldSpace": true
        })
    }

    fn set_particle_payload(entity_id: &str) -> serde_json::Value {
        let mut payload = full_particle_data();
        payload["entityId"] = json!(entity_id);
        payload
    }

    fn dispatch_with_queue(
        command: &str,
        payload: serde_json::Value,
    ) -> (super::super::CommandResult, PendingCommands) {
        let mut pending = PendingCommands::default();
        register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .unwrap_or_else(|| panic!("`{command}` is not dispatched by the particle domain"));
        (result, pending)
    }

    fn queue_after(command: &str, payload: serde_json::Value) -> PendingCommands {
        let (result, pending) = dispatch_with_queue(command, payload);
        assert!(result.is_ok(), "`{command}` failed: {result:?}");
        pending
    }

    /// Panics if the command succeeded — answering `Ok` to a payload it cannot
    /// act on is the exact failure these tests exist to catch.
    fn error_from(command: &str, payload: serde_json::Value) -> String {
        let (result, _pending) = dispatch_with_queue(command, payload);
        result.unwrap_err()
    }

    fn dispatch_unregistered(
        command: &str,
        payload: serde_json::Value,
    ) -> super::super::CommandResult {
        unregister_pending_commands();
        dispatch(command, &payload).expect("known particle command")
    }

    // === Success shapes ===

    #[test]
    fn set_particle_queues_the_data_it_was_given() {
        let pending = queue_after("set_particle", set_particle_payload("emitter-1"));
        assert_eq!(pending.particle_updates.len(), 1);
        let update = &pending.particle_updates[0];
        assert_eq!(update.entity_id, "emitter-1");
        assert_eq!(update.particle_data.preset, ParticlePreset::Custom);
        assert_eq!(update.particle_data.max_particles, 1000);
        assert_eq!(update.particle_data.lifetime_max, 2.0);
        assert_eq!(
            update.particle_data.spawner_mode,
            SpawnerMode::Continuous { rate: 50.0 }
        );
        assert_eq!(update.particle_data.blend_mode, ParticleBlendMode::AlphaBlend);
        assert_eq!(
            update.particle_data.orientation,
            ParticleOrientation::Billboard
        );
        assert!(update.particle_data.world_space);
        assert_eq!(update.particle_data.color_gradient.len(), 2);
    }

    /// The flattened `ParticleData` must not swallow the sibling `entityId`, and
    /// the entity must not leak into the component.
    #[test]
    fn set_particle_keeps_the_entity_id_out_of_the_flattened_component() {
        let pending = queue_after("set_particle", set_particle_payload("emitter-1"));
        let data = &pending.particle_updates[0].particle_data;
        let round_tripped = serde_json::to_value(data).expect("ParticleData serializes");
        assert!(
            round_tripped.get("entityId").is_none(),
            "entityId was absorbed into the flattened particle data: {round_tripped}"
        );
    }

    #[test]
    fn remove_particle_queues_the_entity() {
        let pending = queue_after("remove_particle", json!({"entityId": "emitter-1"}));
        assert_eq!(pending.particle_removals.len(), 1);
        assert_eq!(pending.particle_removals[0].entity_id, "emitter-1");
    }

    #[test]
    fn toggle_particle_carries_the_flag_both_ways() {
        for enabled in [true, false] {
            let pending = queue_after(
                "toggle_particle",
                json!({"entityId": "emitter-1", "enabled": enabled}),
            );
            assert_eq!(pending.particle_toggles.len(), 1);
            assert_eq!(pending.particle_toggles[0].entity_id, "emitter-1");
            assert_eq!(pending.particle_toggles[0].enabled, enabled);
        }
    }

    #[test]
    fn set_particle_preset_queues_every_preset_the_engine_knows() {
        let presets = [
            "fire",
            "smoke",
            "sparks",
            "rain",
            "snow",
            "explosion",
            "magic_sparkle",
            "dust",
            "trail",
            "custom",
        ];
        for preset in presets {
            let pending = queue_after(
                "set_particle_preset",
                json!({"entityId": "emitter-1", "preset": preset}),
            );
            assert_eq!(pending.particle_preset_requests.len(), 1);
            let request = &pending.particle_preset_requests[0];
            assert_eq!(request.entity_id, "emitter-1");
            assert_eq!(request.preset, preset);
            assert!(
                ParticlePreset::from_str(preset).is_some(),
                "`{preset}` is queued but the bridge's own from_str would drop it"
            );
        }
    }

    #[test]
    fn play_particle_queues_a_play_action_with_no_burst_count() {
        let pending = queue_after("play_particle", json!({"entityId": "emitter-1"}));
        assert_eq!(pending.particle_playback.len(), 1);
        let playback = &pending.particle_playback[0];
        assert_eq!(playback.entity_id, "emitter-1");
        assert_eq!(playback.action, "play");
        assert_eq!(playback.burst_count, None);
    }

    #[test]
    fn stop_particle_queues_a_stop_action_with_no_burst_count() {
        let pending = queue_after("stop_particle", json!({"entityId": "emitter-1"}));
        assert_eq!(pending.particle_playback.len(), 1);
        let playback = &pending.particle_playback[0];
        assert_eq!(playback.entity_id, "emitter-1");
        assert_eq!(playback.action, "stop");
        assert_eq!(playback.burst_count, None);
    }

    #[test]
    fn burst_particle_carries_the_count_through() {
        let pending = queue_after(
            "burst_particle",
            json!({"entityId": "emitter-1", "count": 250}),
        );
        assert_eq!(pending.particle_playback.len(), 1);
        let playback = &pending.particle_playback[0];
        assert_eq!(playback.entity_id, "emitter-1");
        assert_eq!(playback.action, "burst");
        assert_eq!(playback.burst_count, Some(250));
    }

    /// `count` is optional; omitting it must still queue a burst rather than
    /// failing, because the chat surface can ask for a burst without a number.
    #[test]
    fn burst_particle_without_a_count_still_queues_a_burst() {
        let pending = queue_after("burst_particle", json!({"entityId": "emitter-1"}));
        assert_eq!(pending.particle_playback[0].action, "burst");
        assert_eq!(pending.particle_playback[0].burst_count, None);
    }

    /// `get_particle` is a read: it goes through `handle_query`, so with a live
    /// queue it enqueues a `QueryRequest` and enqueues no mutation.
    #[test]
    fn get_particle_queues_a_query_and_mutates_nothing() {
        let pending = queue_after("get_particle", json!({"entityId": "emitter-1"}));
        assert_eq!(pending.query_requests.len(), 1);
        match &pending.query_requests[0] {
            crate::core::pending::QueryRequest::ParticleState { entity_id } => {
                assert_eq!(entity_id, "emitter-1");
            }
            other => panic!("get_particle queued the wrong query: {other:?}"),
        }
        assert!(pending.particle_updates.is_empty());
        assert!(pending.particle_playback.is_empty());
    }

    // === Rejections ===

    #[test]
    fn an_unknown_command_is_not_claimed_by_this_domain() {
        assert!(
            dispatch("set_particle_texture", &json!({"entityId": "emitter-1"})).is_none(),
            "claiming a foreign command would shadow the domain that implements it"
        );
    }

    #[test]
    fn every_command_rejects_a_missing_entity_id() {
        let payloads = [
            ("set_particle", full_particle_data()),
            ("remove_particle", json!({})),
            ("toggle_particle", json!({"enabled": true})),
            ("set_particle_preset", json!({"preset": "fire"})),
            ("play_particle", json!({})),
            ("stop_particle", json!({})),
            ("burst_particle", json!({"count": 10})),
            ("get_particle", json!({})),
        ];
        for (command, payload) in payloads {
            let error = error_from(command, payload);
            assert!(
                error.contains("entityId") || error.contains("entity_id"),
                "`{command}` must name the missing field, said: {error}"
            );
        }
    }

    #[test]
    fn every_command_rejects_a_wrongly_typed_field() {
        let mut wrong_max_particles = set_particle_payload("emitter-1");
        wrong_max_particles["maxParticles"] = json!("lots");
        let payloads = [
            ("set_particle", wrong_max_particles),
            // entityId is read as a string; an object is not one.
            ("remove_particle", json!({"entityId": {"id": "emitter-1"}})),
            (
                "toggle_particle",
                json!({"entityId": "emitter-1", "enabled": "yes"}),
            ),
            (
                "set_particle_preset",
                json!({"entityId": "emitter-1", "preset": 3}),
            ),
            ("play_particle", json!({"entityId": 1})),
            ("stop_particle", json!({"entityId": [1, 2]})),
            (
                "burst_particle",
                json!({"entityId": "emitter-1", "count": "many"}),
            ),
            ("get_particle", json!({"entityId": false})),
        ];
        for (command, payload) in payloads {
            let error = error_from(command, payload);
            assert!(
                !error.is_empty(),
                "`{command}` must reject a wrongly typed field"
            );
        }
    }

    /// A negative count cannot be a particle count. `u32` rejects it — this pins
    /// that the field did not drift to a signed type.
    #[test]
    fn burst_particle_rejects_a_negative_count() {
        let error = error_from(
            "burst_particle",
            json!({"entityId": "emitter-1", "count": -5}),
        );
        assert!(
            error.starts_with("Invalid burst_particle payload"),
            "{error}"
        );
    }

    #[test]
    fn set_particle_preset_rejects_a_preset_the_engine_cannot_build() {
        let error = error_from(
            "set_particle_preset",
            json!({"entityId": "emitter-1", "preset": "lava"}),
        );
        assert!(
            error.contains("Unknown particle preset: lava"),
            "expected an honest failure, said: {error}"
        );
    }

    /// Without validation an unknown preset would queue, reach the bridge's
    /// `if let Some(preset) = ParticlePreset::from_str(..)`, be dropped there,
    /// and the command would already have answered `Ok`.
    #[test]
    fn a_rejected_preset_queues_nothing() {
        let (result, pending) = dispatch_with_queue(
            "set_particle_preset",
            json!({"entityId": "emitter-1", "preset": "lava"}),
        );
        assert!(result.is_err());
        assert!(
            pending.particle_preset_requests.is_empty(),
            "a refused command must not leave work in the queue"
        );
    }

    /// The particle inspector sends one changed field at a time
    /// (`web/src/components/editor/ParticleInspector.tsx` `handleUpdate`), but
    /// `set_particle` is a whole-component replace with no serde defaults. The
    /// error has to name the field so that break is diagnosable rather than
    /// mysterious.
    #[test]
    fn set_particle_names_the_field_a_partial_payload_is_missing() {
        let error = error_from(
            "set_particle",
            json!({"entityId": "emitter-1", "maxParticles": 2000}),
        );
        assert!(
            error.starts_with("Invalid set_particle payload"),
            "{error}"
        );
        assert!(
            error.contains("missing field"),
            "a partial update must say which field is missing, said: {error}"
        );
    }

    #[test]
    fn every_command_reports_a_missing_pending_queue() {
        let payloads = [
            ("set_particle", set_particle_payload("emitter-1")),
            ("remove_particle", json!({"entityId": "emitter-1"})),
            (
                "toggle_particle",
                json!({"entityId": "emitter-1", "enabled": true}),
            ),
            (
                "set_particle_preset",
                json!({"entityId": "emitter-1", "preset": "fire"}),
            ),
            ("play_particle", json!({"entityId": "emitter-1"})),
            ("stop_particle", json!({"entityId": "emitter-1"})),
            (
                "burst_particle",
                json!({"entityId": "emitter-1", "count": 10}),
            ),
            ("get_particle", json!({"entityId": "emitter-1"})),
        ];
        for (command, payload) in payloads {
            assert_eq!(
                dispatch_unregistered(command, payload),
                Err("PendingCommands resource not initialized".to_string()),
                "`{command}` must report an unavailable queue"
            );
        }
    }

    // === Source parity ===

    #[test]
    fn every_dispatch_arm_is_covered() {
        assert_arm_coverage(
            "core/commands/particles.rs",
            MODULE_SOURCE,
            DISPATCH_MARKER,
            TESTED_ARMS,
            6,
        );
    }

    /// The three playback commands are the only producers of
    /// `ParticlePlayback.action`, and `bridge::particles::apply_particle_playback`
    /// is its only consumer. That system used to drain the queue without reading
    /// `action` at all, so play, stop and burst reported success and did nothing.
    /// This fails if it goes back to being a drain.
    #[test]
    fn the_bridge_actually_reads_the_playback_action() {
        // `block_of` blanks string contents, which is exactly what this test
        // needs to read, so take the span from the stripped view and slice the
        // raw source at the same offsets — `strip_comments` preserves byte
        // length, so the two views stay aligned.
        let stripped = crate::core::parity_util::strip_comments(BRIDGE_SOURCE);
        let (start, end) = crate::core::parity_util::block_span(
            &stripped,
            "pub(super) fn apply_particle_playback",
        );
        let body = &BRIDGE_SOURCE[start..end];
        for action in ["play", "stop", "burst"] {
            assert!(
                body.contains(&format!("\"{action}\"")),
                "apply_particle_playback does not handle `{action}` — the command \
                 answers Ok and the request is discarded"
            );
        }
        assert!(
            body.contains("burst_count"),
            "apply_particle_playback ignores burst_count — burst_particle's count \
             is accepted and thrown away"
        );
    }
}
