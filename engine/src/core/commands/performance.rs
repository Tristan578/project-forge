//! Performance and LOD command handlers.

use serde::Deserialize;
use serde_json::Value;
// A runtime build refuses these commands before reaching a queue (see
// `editor_only`), so the queue functions are genuinely unused there.
#[cfg(not(feature = "runtime"))]
use crate::core::pending::{
    bridge_set_lod, bridge_generate_lods, bridge_set_performance_budget,
    bridge_get_performance_stats, bridge_optimize_scene, bridge_set_lod_distances,
    bridge_set_simplification_backend,
};
use super::CommandResult;

/// Dispatch performance commands.
pub fn dispatch(command: &str, payload: &Value) -> Option<CommandResult> {
    match command {
        "set_lod" => Some(handle_set_lod(payload)),
        "generate_lods" => Some(handle_generate_lods(payload)),
        "set_performance_budget" => Some(handle_set_performance_budget(payload)),
        "get_performance_stats" => Some(handle_get_performance_stats()),
        "optimize_scene" => Some(handle_optimize_scene()),
        "set_lod_distances" => Some(handle_set_lod_distances(payload)),
        "set_simplification_backend" => Some(handle_set_simplification_backend(payload)),
        _ => None,
    }
}

/// Turn "did the request reach the queue" into the answer every other command
/// domain gives when it did not.
///
/// The queueing used to sit behind `#[cfg(target_arch = "wasm32")]` even though
/// the queue itself is pure `core/` and compiles everywhere. That made the whole
/// module a no-op off wasm — untestable — and, because the queue functions threw
/// away `with_pending`'s `Option`, it also meant an unregistered
/// `PendingCommands` produced `Ok` and a dropped request.
#[cfg(not(feature = "runtime"))]
fn queued(accepted: bool) -> CommandResult {
    if accepted {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Every queue in this module is drained by `bridge::performance::
/// apply_lod_commands` or `apply_performance_budget_commands`, and `bridge/mod.rs`
/// registers both only inside `#[cfg(not(feature = "runtime"))]`. In a runtime
/// build nothing drains them, so accepting a request would grow a buffer for the
/// life of the process while the command reported success. Refuse, and say why.
///
/// Takes the parsed payload, so the parse still happens in a runtime build — a
/// malformed command must fail as malformed, not as unsupported — and so the
/// binding is used on every target without an `allow`.
#[cfg(feature = "runtime")]
fn editor_only<T>(command: &str, _params: T) -> CommandResult {
    Err(format!(
        "`{command}` is an editor-only command: its queue is not drained in a runtime build"
    ))
}

/// A runtime build hands the parsed payload to `editor_only`, which is generic
/// and never reads it — the parse still has to happen so a malformed command
/// fails as malformed, but nothing consumes the fields.
#[cfg_attr(feature = "runtime", allow(dead_code))]
#[derive(Deserialize)]
struct SetLodPayload {
    #[serde(rename = "entityId")]
    entity_id: String,
    #[serde(rename = "lodDistances")]
    lod_distances: [f32; 3],
    #[serde(rename = "autoGenerate")]
    auto_generate: bool,
    #[serde(rename = "lodRatios")]
    lod_ratios: [f32; 3],
}

fn handle_set_lod(payload: &Value) -> CommandResult {
    let params: SetLodPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_lod payload: {}", e))?;

    #[cfg(feature = "runtime")]
    return editor_only("set_lod", params);

    #[cfg(not(feature = "runtime"))]
    queued(bridge_set_lod(
        params.entity_id,
        params.lod_distances,
        params.auto_generate,
        params.lod_ratios,
    ))
}

/// A runtime build hands the parsed payload to `editor_only`, which is generic
/// and never reads it — the parse still has to happen so a malformed command
/// fails as malformed, but nothing consumes the fields.
#[cfg_attr(feature = "runtime", allow(dead_code))]
#[derive(Deserialize)]
struct GenerateLodsPayload {
    #[serde(rename = "entityId")]
    entity_id: String,
}

fn handle_generate_lods(payload: &Value) -> CommandResult {
    let params: GenerateLodsPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid generate_lods payload: {}", e))?;

    #[cfg(feature = "runtime")]
    return editor_only("generate_lods", params);

    #[cfg(not(feature = "runtime"))]
    queued(bridge_generate_lods(params.entity_id))
}

/// A runtime build hands the parsed payload to `editor_only`, which is generic
/// and never reads it — the parse still has to happen so a malformed command
/// fails as malformed, but nothing consumes the fields.
#[cfg_attr(feature = "runtime", allow(dead_code))]
#[derive(Deserialize)]
struct SetPerformanceBudgetPayload {
    #[serde(rename = "maxTriangles")]
    max_triangles: u32,
    #[serde(rename = "maxDrawCalls")]
    max_draw_calls: u32,
    #[serde(rename = "targetFps")]
    target_fps: f32,
    #[serde(rename = "warningThreshold")]
    warning_threshold: f32,
}

fn handle_set_performance_budget(payload: &Value) -> CommandResult {
    let params: SetPerformanceBudgetPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_performance_budget payload: {}", e))?;

    #[cfg(feature = "runtime")]
    return editor_only("set_performance_budget", params);

    #[cfg(not(feature = "runtime"))]
    queued(bridge_set_performance_budget(
        params.max_triangles,
        params.max_draw_calls,
        params.target_fps,
        params.warning_threshold,
    ))
}

fn handle_get_performance_stats() -> CommandResult {
    #[cfg(feature = "runtime")]
    return editor_only("get_performance_stats", ());

    #[cfg(not(feature = "runtime"))]
    queued(bridge_get_performance_stats())
}

fn handle_optimize_scene() -> CommandResult {
    #[cfg(feature = "runtime")]
    return editor_only("optimize_scene", ());

    #[cfg(not(feature = "runtime"))]
    queued(bridge_optimize_scene())
}

/// A runtime build hands the parsed payload to `editor_only`, which is generic
/// and never reads it — the parse still has to happen so a malformed command
/// fails as malformed, but nothing consumes the fields.
#[cfg_attr(feature = "runtime", allow(dead_code))]
#[derive(Deserialize)]
struct SetLodDistancesPayload {
    distances: [f32; 3],
}

fn handle_set_lod_distances(payload: &Value) -> CommandResult {
    let params: SetLodDistancesPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_lod_distances payload: {}", e))?;

    #[cfg(feature = "runtime")]
    return editor_only("set_lod_distances", params);

    #[cfg(not(feature = "runtime"))]
    queued(bridge_set_lod_distances(params.distances))
}

/// Backend names `SimplificationBackend::set_by_name` actually switches to.
///
/// That function falls back to `"qem"` for anything it does not recognise, so an
/// unlisted name would be accepted here, silently become QEM, and the caller
/// would be told its choice took effect.
/// `the_backend_allowlist_matches_what_the_simplifier_implements` drives
/// `set_by_name` with each of these and fails if one stops round-tripping.
const SIMPLIFICATION_BACKENDS: &[&str] = &["qem", "fast"];

#[derive(Deserialize)]
struct SetSimplificationBackendPayload {
    backend: String,
}

fn handle_set_simplification_backend(payload: &Value) -> CommandResult {
    let params: SetSimplificationBackendPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_simplification_backend payload: {}", e))?;

    if !SIMPLIFICATION_BACKENDS.contains(&params.backend.as_str()) {
        return Err(format!(
            "Unknown simplification backend '{}'. Valid values: {}",
            params.backend,
            SIMPLIFICATION_BACKENDS
                .iter()
                .map(|b| format!("'{b}'"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    #[cfg(feature = "runtime")]
    return editor_only("set_simplification_backend", params);

    #[cfg(not(feature = "runtime"))]
    queued(bridge_set_simplification_backend(params.backend))
}

/// Commands this module answers. Shared by the parity test and the
/// runtime-refusal test so neither can drift from the other.
#[cfg(test)]
const TESTED_ARMS: &[&str] = &[
    "set_lod",
    "generate_lods",
    "set_performance_budget",
    "get_performance_stats",
    "optimize_scene",
    "set_lod_distances",
    "set_simplification_backend",
];

/// The bulk of the suite. Everything here observes the pending queue, which a
/// runtime build deliberately never reaches (see `editor_only`), so it is gated
/// to the editor build — the one CI runs.
#[cfg(all(test, not(feature = "runtime")))]
mod tests {
    use super::*;
    use crate::core::parity_util::assert_arm_coverage;
    use crate::core::pending::{
        register_pending_commands, unregister_pending_commands, PendingCommands,
    };
    use serde_json::json;

    const MODULE_SOURCE: &str = include_str!("performance.rs");
    const BRIDGE_SOURCE: &str = include_str!("../../bridge/performance.rs");

    /// The signature differs from the other command modules — this one takes a
    /// bare `Value`, not `serde_json::Value` — so the marker has to match this
    /// file, not the house style.
    const DISPATCH_MARKER: &str = "pub fn dispatch(command: &str, payload: &Value)";

    /// Clears the thread-local pointer whatever the test did, including on a
    /// panic — leaving it set would hand the next test on this thread a dangling
    /// pointer into a dropped stack frame.
    struct PendingGuard;

    impl Drop for PendingGuard {
        fn drop(&mut self) {
            unregister_pending_commands();
        }
    }

    /// Dispatch with a live queue registered, returning both the command's answer
    /// and the queue, so a test can assert on what was actually enqueued rather
    /// than only on the `Ok`.
    fn dispatch_with_queue(
        command: &str,
        payload: serde_json::Value,
    ) -> (CommandResult, PendingCommands) {
        let mut pending = PendingCommands::default();
        register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .unwrap_or_else(|| panic!("`{command}` is not dispatched by the performance domain"));
        (result, pending)
    }

    fn queue_after(command: &str, payload: serde_json::Value) -> PendingCommands {
        let (result, pending) = dispatch_with_queue(command, payload);
        assert!(result.is_ok(), "`{command}` failed: {result:?}");
        pending
    }

    /// The error a malformed command must produce. Panics if it succeeded — a
    /// command that answers `Ok` to a payload it cannot act on is the failure
    /// this whole module is here to catch.
    fn error_from(command: &str, payload: serde_json::Value) -> String {
        let (result, _pending) = dispatch_with_queue(command, payload);
        result.unwrap_err()
    }

    fn set_lod_payload() -> serde_json::Value {
        json!({
            "entityId": "entity_1",
            "lodDistances": [10.0, 25.0, 60.0],
            "autoGenerate": true,
            "lodRatios": [0.75, 0.4, 0.15],
        })
    }

    fn budget_payload() -> serde_json::Value {
        json!({
            "maxTriangles": 250_000,
            "maxDrawCalls": 600,
            "targetFps": 60.0,
            "warningThreshold": 0.8,
        })
    }

    /// A payload for every command, so the shared malformed-input tests can walk
    /// the whole dispatch table instead of hand-picking two arms.
    fn valid_payload(command: &str) -> serde_json::Value {
        match command {
            "set_lod" => set_lod_payload(),
            "generate_lods" => json!({ "entityId": "entity_1" }),
            "set_performance_budget" => budget_payload(),
            "get_performance_stats" | "optimize_scene" => json!({}),
            "set_lod_distances" => json!({ "distances": [10.0, 25.0, 60.0] }),
            "set_simplification_backend" => json!({ "backend": "fast" }),
            other => panic!("no fixture payload for `{other}` — add one"),
        }
    }

    /// The commands that read a payload at all. `get_performance_stats` and
    /// `optimize_scene` take none, so there is no field for them to be missing
    /// or wrongly typed; `a_payloadless_command_ignores_its_payload` covers what
    /// they do instead.
    const PAYLOAD_COMMANDS: &[&str] = &[
        "set_lod",
        "generate_lods",
        "set_performance_budget",
        "set_lod_distances",
        "set_simplification_backend",
    ];

    /// A required field of each payload-taking command, and a value of the wrong
    /// type for it.
    fn a_required_field(command: &str) -> (&'static str, serde_json::Value) {
        match command {
            "set_lod" => ("entityId", json!(7)),
            "generate_lods" => ("entityId", json!(false)),
            "set_performance_budget" => ("maxTriangles", json!("lots")),
            "set_lod_distances" => ("distances", json!("near, mid, far")),
            "set_simplification_backend" => ("backend", json!(["fast"])),
            other => panic!("no required field recorded for `{other}` — add one"),
        }
    }

    // === Success shapes ===

    #[test]
    fn set_lod_queues_every_field_it_was_given() {
        let pending = queue_after("set_lod", set_lod_payload());
        assert_eq!(pending.set_lod_requests.len(), 1);
        let request = &pending.set_lod_requests[0];
        assert_eq!(request.entity_id, "entity_1");
        assert_eq!(request.lod_distances, [10.0, 25.0, 60.0]);
        assert!(request.auto_generate);
        assert_eq!(request.lod_ratios, [0.75, 0.4, 0.15]);
    }

    #[test]
    fn generate_lods_queues_the_entity() {
        let pending = queue_after("generate_lods", json!({ "entityId": "entity_2" }));
        assert_eq!(pending.generate_lods_requests.len(), 1);
        assert_eq!(pending.generate_lods_requests[0].entity_id, "entity_2");
    }

    #[test]
    fn set_performance_budget_queues_every_field_it_was_given() {
        let pending = queue_after("set_performance_budget", budget_payload());
        assert_eq!(pending.set_performance_budget_requests.len(), 1);
        let request = &pending.set_performance_budget_requests[0];
        assert_eq!(request.max_triangles, 250_000);
        assert_eq!(request.max_draw_calls, 600);
        assert_eq!(request.target_fps, 60.0);
        assert_eq!(request.warning_threshold, 0.8);
    }

    #[test]
    fn get_performance_stats_queues_a_request() {
        let pending = queue_after("get_performance_stats", json!({}));
        assert_eq!(pending.get_performance_stats_requests.len(), 1);
    }

    #[test]
    fn optimize_scene_queues_a_request() {
        let pending = queue_after("optimize_scene", json!({}));
        assert_eq!(pending.optimize_scene_requests.len(), 1);
    }

    #[test]
    fn set_lod_distances_queues_the_distances() {
        let pending = queue_after("set_lod_distances", json!({ "distances": [5.0, 15.0, 45.0] }));
        assert_eq!(pending.set_lod_distances_requests.len(), 1);
        assert_eq!(pending.set_lod_distances_requests[0].distances, [5.0, 15.0, 45.0]);
    }

    #[test]
    fn set_simplification_backend_queues_every_backend_the_simplifier_implements() {
        for backend in SIMPLIFICATION_BACKENDS {
            let pending =
                queue_after("set_simplification_backend", json!({ "backend": backend }));
            assert_eq!(
                pending.set_simplification_backend_requests.len(),
                1,
                "`{backend}` did not reach the queue"
            );
            assert_eq!(
                pending.set_simplification_backend_requests[0].backend_name, *backend,
                "the backend name was rewritten on the way to the queue"
            );
        }
    }

    /// `get_performance_stats` and `optimize_scene` take no arguments, so
    /// whatever arrives with them is inert. Pin that: if either grows a payload,
    /// this test is where the decision has to be made explicitly.
    #[test]
    fn a_payloadless_command_ignores_its_payload() {
        for command in ["get_performance_stats", "optimize_scene"] {
            let (result, _pending) =
                dispatch_with_queue(command, json!({ "nonsense": [1, 2, 3], "target": null }));
            assert!(
                result.is_ok(),
                "`{command}` takes no payload but rejected one: {result:?}"
            );
        }
    }

    // === Malformed input ===

    #[test]
    fn every_payload_command_rejects_a_missing_required_field() {
        for command in PAYLOAD_COMMANDS {
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
        for command in PAYLOAD_COMMANDS {
            let (field, wrong) = a_required_field(command);
            let mut payload = valid_payload(command);
            payload
                .as_object_mut()
                .expect("fixture payloads are objects")
                .insert(field.to_string(), wrong);
            let error = error_from(command, payload);
            assert!(
                error.starts_with(&format!("Invalid {command} payload")),
                "`{command}` accepted a wrongly typed `{field}` or mislabelled the failure: {error}"
            );
        }
    }

    /// `[f32; 3]` is a fixed-size array: a four-element list is not a longer LOD
    /// chain, it is a payload the bridge cannot act on.
    #[test]
    fn a_distance_array_of_the_wrong_length_is_rejected() {
        let error = error_from(
            "set_lod_distances",
            json!({ "distances": [1.0, 2.0, 3.0, 4.0] }),
        );
        assert!(
            error.starts_with("Invalid set_lod_distances payload"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn set_simplification_backend_rejects_a_backend_the_simplifier_does_not_implement() {
        let error = error_from("set_simplification_backend", json!({ "backend": "meshopt" }));
        assert!(
            error.contains("meshopt") && error.contains("qem") && error.contains("fast"),
            "the error should name the rejected backend and the valid ones: {error}"
        );
    }

    #[test]
    fn a_rejected_command_queues_nothing() {
        let (result, pending) =
            dispatch_with_queue("set_simplification_backend", json!({ "backend": "meshopt" }));
        assert!(result.is_err());
        assert!(
            pending.set_simplification_backend_requests.is_empty(),
            "a refused command still enqueued work"
        );
    }

    #[test]
    fn an_unknown_command_is_not_this_domains() {
        assert!(dispatch("set_lod_ratios", &json!({})).is_none());
        assert!(dispatch("", &json!({})).is_none());
    }

    /// Regression guard for the defect this suite was written to find: the queue
    /// functions used to discard `with_pending`'s `Option`, so with no
    /// `PendingCommands` registered the request was dropped and the command
    /// still answered `Ok`.
    #[test]
    fn every_command_reports_a_missing_pending_queue() {
        for command in TESTED_ARMS {
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

    // === Parity with production ===

    #[test]
    fn every_dispatch_arm_is_covered() {
        assert_arm_coverage(
            "core/commands/performance.rs",
            MODULE_SOURCE,
            DISPATCH_MARKER,
            TESTED_ARMS,
            // A tripwire, not the arm count: a deleted arm has to be caught by
            // the stale-name check below, which names it.
            5,
        );
    }

    /// The allowlist exists because `set_by_name` falls back to QEM for anything
    /// it does not recognise — an unlisted name would be accepted, silently
    /// become QEM, and the caller would be told its choice took effect. Drive the
    /// real simplifier rather than trusting the comment.
    #[test]
    fn the_backend_allowlist_matches_what_the_simplifier_implements() {
        use crate::core::lod::SimplificationBackend;

        for name in SIMPLIFICATION_BACKENDS {
            let mut backend = SimplificationBackend::default();
            backend.set_by_name(name);
            assert_eq!(
                backend.backend_name, *name,
                "`{name}` is on the allowlist but `set_by_name` does not implement it — \
                 the command would report success and silently use QEM"
            );
        }

        // Start from a non-default backend, or "fell back to QEM" and "did
        // nothing at all" look identical.
        let mut backend = SimplificationBackend::default();
        backend.set_by_name("fast");
        backend.set_by_name("meshopt");
        assert_eq!(
            backend.backend_name, "qem",
            "`set_by_name` gained a backend that is not on the allowlist — add it to \
             SIMPLIFICATION_BACKENDS so the command stops rejecting it"
        );
    }

    /// Why `editor_only` exists. Both systems that drain this module's queues are
    /// compiled out of a runtime build, so accepting a request there would grow a
    /// buffer forever while the command reported success. `bridge/` is wasm-only
    /// and has no native test, so pin the gate by reading its source.
    #[test]
    fn the_queues_are_drained_only_by_editor_only_systems() {
        for system in ["apply_lod_commands", "apply_performance_budget_commands"] {
            let signature = format!("pub fn {system}(");
            let at = BRIDGE_SOURCE
                .find(&signature)
                .unwrap_or_else(|| panic!("`{system}` is gone from bridge/performance.rs"));
            let preamble = &BRIDGE_SOURCE[..at];
            assert!(
                preamble
                    .rsplit("\n\n")
                    .next()
                    .expect("rsplit always yields at least one piece")
                    .contains("#[cfg(not(feature = \"runtime\"))]"),
                "`{system}` is no longer editor-only — if it now runs in a runtime build, \
                 drop the `editor_only` refusal from core/commands/performance.rs"
            );
        }
    }

    /// Every arm has to reach `editor_only` in a runtime build, not just most of
    /// them: a handler that forgets it silently resurrects the unbounded-growth
    /// bug for its own queue. Runtime is a separate compilation, so read the
    /// source rather than trying to observe it from here.
    #[test]
    fn every_arm_refuses_itself_by_name_in_a_runtime_build() {
        for command in TESTED_ARMS {
            let call = format!("editor_only(\"{command}\"");
            assert!(
                MODULE_SOURCE.contains(&call),
                "`{command}` has no `{call})` — in a runtime build it would queue work \
                 that nothing drains and still answer Ok"
            );
        }
    }
}

/// The mirror image of the suite above: in a runtime build every command must
/// refuse, and must still fail a malformed payload as malformed.
#[cfg(all(test, feature = "runtime"))]
mod runtime_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_command_refuses_because_nothing_would_drain_its_queue() {
        for command in TESTED_ARMS {
            let payload = match *command {
                "set_lod" => json!({
                    "entityId": "e", "lodDistances": [1.0, 2.0, 3.0],
                    "autoGenerate": true, "lodRatios": [0.5, 0.3, 0.1],
                }),
                "generate_lods" => json!({ "entityId": "e" }),
                "set_performance_budget" => json!({
                    "maxTriangles": 1, "maxDrawCalls": 1,
                    "targetFps": 60.0, "warningThreshold": 0.8,
                }),
                "set_lod_distances" => json!({ "distances": [1.0, 2.0, 3.0] }),
                "set_simplification_backend" => json!({ "backend": "fast" }),
                _ => json!({}),
            };
            let result = dispatch(command, &payload)
                .unwrap_or_else(|| panic!("`{command}` is not dispatched"));
            let error = result.expect_err("a runtime build has nothing to drain the queue");
            assert!(
                error.contains(command) && error.contains("editor-only"),
                "`{command}` refused without saying why: {error}"
            );
        }
    }

    #[test]
    fn a_malformed_payload_still_fails_as_malformed() {
        let error = dispatch("generate_lods", &json!({}))
            .expect("known command")
            .expect_err("entityId is required");
        assert!(
            error.starts_with("Invalid generate_lods payload"),
            "a runtime build reported a parse failure as an unsupported command: {error}"
        );
    }
}
