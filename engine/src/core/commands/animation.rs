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
        // Stub handlers for animation commands not yet fully implemented
        "create_animation_clip" => Some(Err("Not yet implemented: create_animation_clip".to_string())),
        "add_keyframe" => Some(Err("Not yet implemented: add_keyframe".to_string())),
        "remove_keyframe" => Some(Err("Not yet implemented: remove_keyframe".to_string())),
        "update_keyframe" => Some(Err("Not yet implemented: update_keyframe".to_string())),
        "get_animation_clips" => Some(Err("Not yet implemented: get_animation_clips".to_string())),
        "play_animation_clip" => Some(Err("Not yet implemented: play_animation_clip".to_string())),
        "stop_animation_clip" => Some(Err("Not yet implemented: stop_animation_clip".to_string())),
        // `set_animation_state_machine` / `remove_animation_state_machine` are
        // NOT stubbed here any more: `sprites.rs` implements both, and the stubs
        // shadowed it for as long as the router pointed the names at this domain.
        "list_skeleton_animations" => Some(Err("Not yet implemented: list_skeleton_animations".to_string())),
        "get_skeleton_animation" => Some(Err("Not yet implemented: get_skeleton_animation".to_string())),

        _ => None,
    }
}

/// Crossfade applied when `play_animation` arrives without one.
const DEFAULT_CROSSFADE_SECS: f32 = 0.3;

/// Longest crossfade the engine will accept. The bound is not taste: the bridge
/// turns this into a `std::time::Duration` with `from_secs_f32`, which panics on
/// anything that does not fit — and a panic in wasm takes the whole engine down.
/// A blend longer than a minute is not a crossfade anyway.
const MAX_CROSSFADE_SECS: f32 = 60.0;

/// Read the optional `crossfadeSecs` field.
///
/// This used to be `.and_then(|v| v.as_f64()).unwrap_or(0.3)`, which answered
/// `Ok` and silently used the default for `"fast"`, `null`, `true` or `{}` — the
/// caller was told its crossfade took effect. It also passed `1e300` (which
/// becomes `f32::INFINITY`) straight through to `Duration::from_secs_f32` in
/// `bridge/animation.rs`, panicking the engine from a JSON payload.
fn read_crossfade_secs(payload: &serde_json::Value) -> Result<f32, String> {
    let value = match payload.get("crossfadeSecs") {
        None | Some(serde_json::Value::Null) => return Ok(DEFAULT_CROSSFADE_SECS),
        Some(value) => value,
    };

    let secs = value
        .as_f64()
        .ok_or_else(|| format!("crossfadeSecs must be a number, got {}", value))?
        as f32;

    if !(0.0..=MAX_CROSSFADE_SECS).contains(&secs) {
        return Err(format!(
            "crossfadeSecs must be between 0 and {MAX_CROSSFADE_SECS} seconds, got {secs}"
        ));
    }

    Ok(secs)
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
    let crossfade_secs = read_crossfade_secs(&payload)?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parity_util::assert_arm_coverage;
    use crate::core::pending::{
        register_pending_commands, unregister_pending_commands, PendingCommands,
    };
    use serde_json::json;

    const MODULE_SOURCE: &str = include_str!("animation.rs");
    const DISPATCH_MARKER: &str =
        "pub fn dispatch(command: &str, payload: &serde_json::Value)";

    /// Commands that queue an `AnimationRequest`.
    const QUEUEING_ARMS: &[&str] = &[
        "play_animation",
        "pause_animation",
        "resume_animation",
        "stop_animation",
        "seek_animation",
        "set_animation_speed",
        "set_animation_loop",
        "set_animation_blend_weight",
        "set_clip_speed",
    ];

    /// Commands that queue a `QueryRequest` instead.
    const QUERY_ARMS: &[&str] = &[
        "get_animation_state",
        "list_animations",
        "get_animation_graph",
    ];

    /// Commands that are dispatched only to be refused. They are part of the
    /// contract — the router must not fall through to "Unknown command" for
    /// them — so they are covered like any other arm.
    const STUB_ARMS: &[&str] = &[
        "create_animation_clip",
        "add_keyframe",
        "remove_keyframe",
        "update_keyframe",
        "get_animation_clips",
        "play_animation_clip",
        "stop_animation_clip",
        "list_skeleton_animations",
        "get_skeleton_animation",
    ];

    /// Every command this module answers. `every_dispatch_arm_is_covered` reads
    /// the production `match` and compares against this list in both directions,
    /// so it cannot drift from what the module actually dispatches.
    fn tested_arms() -> Vec<&'static str> {
        QUEUEING_ARMS
            .iter()
            .chain(QUERY_ARMS)
            .chain(STUB_ARMS)
            .copied()
            .collect()
    }

    /// Clears the thread-local pointer whatever the test did, including on a
    /// panic — leaving it set would hand the next test on this thread a dangling
    /// pointer into a dropped stack frame.
    struct PendingGuard;

    impl Drop for PendingGuard {
        fn drop(&mut self) {
            unregister_pending_commands();
        }
    }

    fn dispatch_with_queue(
        command: &str,
        payload: serde_json::Value,
    ) -> (super::super::CommandResult, PendingCommands) {
        let mut pending = PendingCommands::default();
        register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .unwrap_or_else(|| panic!("`{command}` is not dispatched by the animation domain"));
        (result, pending)
    }

    fn queue_after(command: &str, payload: serde_json::Value) -> PendingCommands {
        let (result, pending) = dispatch_with_queue(command, payload);
        assert!(result.is_ok(), "`{command}` failed: {result:?}");
        pending
    }

    /// The single action a command queued. Panics unless exactly one request was
    /// enqueued, so a handler that queues twice — or not at all — cannot pass by
    /// having its first request inspected.
    fn action_after(command: &str, payload: serde_json::Value) -> AnimationAction {
        let pending = queue_after(command, payload);
        assert_eq!(
            pending.animation_requests.len(),
            1,
            "`{command}` queued {} animation requests, expected exactly 1",
            pending.animation_requests.len()
        );
        assert_eq!(
            pending.animation_requests[0].entity_id, "entity_1",
            "`{command}` queued the wrong entity"
        );
        pending.animation_requests[0].action.clone()
    }

    /// The error a malformed command must produce. Panics if it succeeded — a
    /// command that answers `Ok` to a payload it cannot act on is the failure
    /// this whole module is here to catch.
    fn error_from(command: &str, payload: serde_json::Value) -> String {
        let (result, _pending) = dispatch_with_queue(command, payload);
        result.unwrap_err()
    }

    fn valid_payload(command: &str) -> serde_json::Value {
        match command {
            "play_animation" => json!({ "entityId": "entity_1", "clipName": "run" }),
            "pause_animation" | "resume_animation" | "stop_animation" | "get_animation_state"
            | "list_animations" | "get_animation_graph" => json!({ "entityId": "entity_1" }),
            "seek_animation" => json!({ "entityId": "entity_1", "timeSecs": 1.5 }),
            "set_animation_speed" => json!({ "entityId": "entity_1", "speed": 2.0 }),
            "set_animation_loop" => json!({ "entityId": "entity_1", "looping": true }),
            "set_animation_blend_weight" => {
                json!({ "entityId": "entity_1", "clipName": "run", "weight": 0.5 })
            }
            "set_clip_speed" => {
                json!({ "entityId": "entity_1", "clipName": "run", "speed": 2.0 })
            }
            other => panic!("no fixture payload for `{other}` — add one"),
        }
    }

    /// A required field of each payload-reading command, and a value of the
    /// wrong type for it.
    fn a_required_field(command: &str) -> (&'static str, serde_json::Value) {
        match command {
            "play_animation" => ("clipName", json!(3)),
            "pause_animation" => ("entityId", json!(1)),
            "resume_animation" => ("entityId", json!(true)),
            "stop_animation" => ("entityId", json!([])),
            "seek_animation" => ("timeSecs", json!("1.5")),
            "set_animation_speed" => ("speed", json!("fast")),
            "set_animation_loop" => ("looping", json!("yes")),
            "set_animation_blend_weight" => ("weight", json!(null)),
            "set_clip_speed" => ("clipName", json!(false)),
            "get_animation_state" | "list_animations" => ("entityId", json!(0)),
            "get_animation_graph" => ("entityId", json!({})),
            other => panic!("no required field recorded for `{other}` — add one"),
        }
    }

    // === Success shapes ===

    #[test]
    fn play_animation_queues_the_clip_and_the_default_crossfade() {
        let action = action_after("play_animation", valid_payload("play_animation"));
        let AnimationAction::Play {
            clip_name,
            crossfade_secs,
        } = action
        else {
            panic!("play_animation queued {action:?}, expected Play");
        };
        assert_eq!(clip_name, "run");
        assert_eq!(crossfade_secs, DEFAULT_CROSSFADE_SECS);
    }

    #[test]
    fn play_animation_keeps_an_explicit_crossfade() {
        let action = action_after(
            "play_animation",
            json!({ "entityId": "entity_1", "clipName": "run", "crossfadeSecs": 1.25 }),
        );
        let AnimationAction::Play { crossfade_secs, .. } = action else {
            panic!("expected Play, got {action:?}");
        };
        assert_eq!(crossfade_secs, 1.25);
    }

    /// An explicit `null` is how a JS caller spells "I have no value for this",
    /// so it has to mean the same as omitting the key.
    #[test]
    fn a_null_crossfade_means_the_default() {
        let action = action_after(
            "play_animation",
            json!({ "entityId": "entity_1", "clipName": "run", "crossfadeSecs": null }),
        );
        let AnimationAction::Play { crossfade_secs, .. } = action else {
            panic!("expected Play, got {action:?}");
        };
        assert_eq!(crossfade_secs, DEFAULT_CROSSFADE_SECS);
    }

    #[test]
    fn the_playback_commands_queue_their_own_action() {
        for (command, expected) in [
            ("pause_animation", "Pause"),
            ("resume_animation", "Resume"),
            ("stop_animation", "Stop"),
        ] {
            let action = action_after(command, valid_payload(command));
            let matched = matches!(
                (command, &action),
                ("pause_animation", AnimationAction::Pause)
                    | ("resume_animation", AnimationAction::Resume)
                    | ("stop_animation", AnimationAction::Stop)
            );
            assert!(matched, "`{command}` queued {action:?}, expected {expected}");
        }
    }

    #[test]
    fn seek_animation_queues_the_time() {
        let action = action_after("seek_animation", valid_payload("seek_animation"));
        let AnimationAction::Seek { time_secs } = action else {
            panic!("expected Seek, got {action:?}");
        };
        assert_eq!(time_secs, 1.5);
    }

    #[test]
    fn set_animation_speed_queues_the_speed() {
        let action = action_after("set_animation_speed", valid_payload("set_animation_speed"));
        let AnimationAction::SetSpeed { speed } = action else {
            panic!("expected SetSpeed, got {action:?}");
        };
        assert_eq!(speed, 2.0);
    }

    #[test]
    fn set_animation_loop_queues_the_flag() {
        for looping in [true, false] {
            let action = action_after(
                "set_animation_loop",
                json!({ "entityId": "entity_1", "looping": looping }),
            );
            let AnimationAction::SetLoop { looping: queued } = action else {
                panic!("expected SetLoop, got {action:?}");
            };
            assert_eq!(queued, looping);
        }
    }

    #[test]
    fn set_animation_blend_weight_queues_the_clip_and_weight() {
        let action = action_after(
            "set_animation_blend_weight",
            valid_payload("set_animation_blend_weight"),
        );
        let AnimationAction::SetBlendWeight { clip_name, weight } = action else {
            panic!("expected SetBlendWeight, got {action:?}");
        };
        assert_eq!(clip_name, "run");
        assert_eq!(weight, 0.5);
    }

    #[test]
    fn set_clip_speed_queues_the_clip_and_speed() {
        let action = action_after("set_clip_speed", valid_payload("set_clip_speed"));
        let AnimationAction::SetClipSpeed { clip_name, speed } = action else {
            panic!("expected SetClipSpeed, got {action:?}");
        };
        assert_eq!(clip_name, "run");
        assert_eq!(speed, 2.0);
    }

    #[test]
    fn the_query_commands_queue_the_query_they_name() {
        for command in QUERY_ARMS {
            let pending = queue_after(command, valid_payload(command));
            assert_eq!(
                pending.query_requests.len(),
                1,
                "`{command}` queued {} queries, expected exactly 1",
                pending.query_requests.len()
            );
            let matched = match (*command, &pending.query_requests[0]) {
                (
                    "get_animation_state" | "list_animations",
                    QueryRequest::AnimationState { entity_id },
                ) => entity_id == "entity_1",
                ("get_animation_graph", QueryRequest::AnimationGraph { entity_id }) => {
                    entity_id == "entity_1"
                }
                _ => false,
            };
            assert!(
                matched,
                "`{command}` queued {:?}",
                pending.query_requests[0]
            );
        }
    }

    /// `list_animations` is an alias, not a second query: both names have to
    /// produce the identical request or the two surfaces drift apart.
    #[test]
    fn list_animations_is_an_alias_for_get_animation_state() {
        let one = queue_after("get_animation_state", valid_payload("get_animation_state"));
        let two = queue_after("list_animations", valid_payload("list_animations"));
        assert_eq!(
            format!("{:?}", one.query_requests),
            format!("{:?}", two.query_requests),
        );
    }

    // === Clamps ===

    /// Zero or negative speed would freeze or reverse playback in a way the
    /// bridge cannot express, so the handler floors it. Pin the floor: a caller
    /// that sends 0 must not get a stopped animation.
    #[test]
    fn a_speed_at_or_below_zero_is_floored() {
        for command in ["set_animation_speed", "set_clip_speed"] {
            for sent in [0.0, -4.0] {
                let mut payload = valid_payload(command);
                payload["speed"] = json!(sent);
                let speed = match action_after(command, payload) {
                    AnimationAction::SetSpeed { speed } => speed,
                    AnimationAction::SetClipSpeed { speed, .. } => speed,
                    other => panic!("`{command}` queued {other:?}"),
                };
                assert_eq!(speed, 0.01, "`{command}` did not floor a speed of {sent}");
            }
        }
    }

    #[test]
    fn a_blend_weight_outside_zero_to_one_is_clamped() {
        for (sent, expected) in [(5.0, 1.0), (-2.0, 0.0)] {
            let mut payload = valid_payload("set_animation_blend_weight");
            payload["weight"] = json!(sent);
            let AnimationAction::SetBlendWeight { weight, .. } =
                action_after("set_animation_blend_weight", payload)
            else {
                panic!("expected SetBlendWeight");
            };
            assert_eq!(weight, expected, "a weight of {sent} was not clamped");
        }
    }

    // === Malformed input ===

    #[test]
    fn every_payload_command_rejects_a_missing_required_field() {
        for command in QUEUEING_ARMS.iter().chain(QUERY_ARMS) {
            let (field, _) = a_required_field(command);
            let mut payload = valid_payload(command);
            payload
                .as_object_mut()
                .expect("fixture payloads are objects")
                .remove(field);
            let error = error_from(command, payload);
            assert!(
                error.contains(field),
                "`{command}` lost `{field}` and did not say so: {error}"
            );
        }
    }

    #[test]
    fn every_payload_command_rejects_a_wrongly_typed_field() {
        for command in QUEUEING_ARMS.iter().chain(QUERY_ARMS) {
            let (field, wrong) = a_required_field(command);
            let mut payload = valid_payload(command);
            payload
                .as_object_mut()
                .expect("fixture payloads are objects")
                .insert(field.to_string(), wrong.clone());
            let error = error_from(command, payload);
            assert!(
                error.contains(field),
                "`{command}` accepted {wrong} for `{field}`, or failed without naming it: {error}"
            );
        }
    }

    /// Regression guard. `crossfadeSecs` used to be read with
    /// `.and_then(as_f64).unwrap_or(0.3)`, so a value of the wrong type was
    /// discarded, the default was used, and the caller was told `Ok`.
    #[test]
    fn a_crossfade_of_the_wrong_type_is_rejected_rather_than_defaulted() {
        for wrong in [json!("fast"), json!(true), json!({}), json!([0.3])] {
            let error = error_from(
                "play_animation",
                json!({ "entityId": "entity_1", "clipName": "run", "crossfadeSecs": wrong }),
            );
            assert!(
                error.contains("crossfadeSecs"),
                "a crossfade of {wrong} was silently defaulted: {error}"
            );
        }
    }

    /// `1e300` becomes `f32::INFINITY`, and the bridge used to hand that to
    /// `Duration::from_secs_f32`, which panics — an engine-wide crash reachable
    /// from a JSON payload.
    #[test]
    fn a_crossfade_the_bridge_cannot_turn_into_a_duration_is_rejected() {
        for wrong in [json!(1e300), json!(-1.0), json!(MAX_CROSSFADE_SECS as f64 + 1.0)] {
            let error = error_from(
                "play_animation",
                json!({ "entityId": "entity_1", "clipName": "run", "crossfadeSecs": wrong }),
            );
            assert!(
                error.contains("crossfadeSecs"),
                "a crossfade of {wrong} was accepted: {error}"
            );
        }
    }

    #[test]
    fn a_zero_crossfade_is_still_a_valid_instant_switch() {
        let action = action_after(
            "play_animation",
            json!({ "entityId": "entity_1", "clipName": "run", "crossfadeSecs": 0.0 }),
        );
        let AnimationAction::Play { crossfade_secs, .. } = action else {
            panic!("expected Play, got {action:?}");
        };
        assert_eq!(crossfade_secs, 0.0);
    }

    #[test]
    fn a_rejected_command_queues_nothing() {
        let (result, pending) = dispatch_with_queue("play_animation", json!({ "clipName": "run" }));
        assert!(result.is_err());
        assert!(
            pending.animation_requests.is_empty(),
            "a refused command still enqueued work"
        );
    }

    #[test]
    fn an_unknown_command_is_not_this_domains() {
        assert!(dispatch("rewind_animation", &json!({})).is_none());
        assert!(dispatch("", &json!({})).is_none());
    }

    #[test]
    fn every_command_reports_a_missing_pending_queue() {
        for command in QUEUEING_ARMS.iter().chain(QUERY_ARMS) {
            unregister_pending_commands();
            let result = dispatch(command, &valid_payload(command))
                .unwrap_or_else(|| panic!("`{command}` is not dispatched"));
            assert_eq!(
                result,
                Err("PendingCommands resource not initialized".to_string()),
                "`{command}` answered {result:?} with no queue registered — the request vanished"
            );
        }
    }

    // === Stubs ===

    /// A stub must refuse, and must refuse under its own name: the messages are
    /// hand-written, so a copy-pasted one would tell a caller the wrong command
    /// is unimplemented.
    #[test]
    fn every_stub_refuses_under_its_own_name() {
        for command in STUB_ARMS {
            let result = dispatch(command, &json!({ "entityId": "entity_1" }))
                .unwrap_or_else(|| panic!("`{command}` is not dispatched — it must not fall through to the router's Unknown command"));
            assert_eq!(
                result,
                Err(format!("Not yet implemented: {command}")),
                "`{command}` did not refuse under its own name"
            );
        }
    }

    /// A stub must not reach the queue even with a payload that would satisfy
    /// the implemented version of the same command.
    #[test]
    fn a_stub_queues_nothing() {
        let (result, pending) = dispatch_with_queue(
            "play_animation_clip",
            json!({ "entityId": "entity_1", "clipName": "run" }),
        );
        assert!(result.is_err());
        assert!(pending.animation_requests.is_empty());
        assert!(pending.query_requests.is_empty());
    }

    // === Parity with production ===

    #[test]
    fn every_dispatch_arm_is_covered() {
        assert_arm_coverage(
            "animation",
            MODULE_SOURCE,
            DISPATCH_MARKER,
            &tested_arms(),
            21,
        );
    }
}
