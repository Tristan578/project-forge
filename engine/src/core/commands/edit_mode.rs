//! Edit mode command handlers

use serde::Deserialize;
use crate::core::pending_commands::{
    queue_enter_edit_mode_from_bridge,
    queue_exit_edit_mode_from_bridge,
    queue_set_selection_mode_from_bridge,
    queue_select_elements_from_bridge,
    queue_mesh_operation_from_bridge,
    queue_recalc_normals_from_bridge,
    EnterEditModeRequest,
    ExitEditModeRequest,
    SetSelectionModeRequest,
    SelectElementsRequest,
    MeshOperationRequest,
    RecalcNormalsRequest,
};

/// Dispatch edit mode commands
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "enter_edit_mode" => Some(handle_enter_edit_mode(payload.clone())),
        "exit_edit_mode" => Some(handle_exit_edit_mode(payload.clone())),
        "set_selection_mode" => Some(handle_set_selection_mode(payload.clone())),
        "select_elements" => Some(handle_select_elements(payload.clone())),
        "mesh_operation" => Some(handle_mesh_operation(payload.clone())),
        "recalc_normals" => Some(handle_recalc_normals(payload.clone())),
        _ => None,
    }
}

/// Selection modes `bridge::edit_mode::apply_edit_mode_requests` implements.
///
/// A mode outside this set reaches that system's `_ => continue`: the request is
/// dropped, nothing changes, and this command has already answered `Ok` — the
/// engine reporting work it did not do. Rejecting it here is the difference
/// between an honest failure and a silent one.
///
/// Tied to the bridge's own match arms by
/// `the_selection_mode_allowlist_matches_what_the_bridge_implements`, so adding a
/// mode there without adding it here fails the suite rather than shipping a
/// command that is refused for no reason.
const SELECTION_MODES: &[&str] = &["vertex", "edge", "face"];

/// Mesh operations `bridge::edit_mode::apply_edit_mode_requests` implements.
///
/// Same failure as `SELECTION_MODES`, one step worse: the bridge's `_` arm logs
/// `Unknown mesh operation` at warn level and drops the request, which never
/// reaches the caller. Callers currently ask for `inset`, `bevel`, `loop_cut`
/// and `delete` (web/src/components/editor/EditModeInspector.tsx and
/// web/src/lib/chat/handlers/editModeHandlers.ts); none are implemented, and all
/// four have been reporting success. They now report failure, which is what they
/// have always been doing.
///
/// Tied to the bridge by `the_mesh_operation_allowlist_matches_what_the_bridge_implements`.
const MESH_OPERATIONS: &[&str] = &["extrude", "subdivide"];

/// Payload for enter_edit_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnterEditModePayload {
    entity_id: String,
}

/// Handle enter_edit_mode command.
fn handle_enter_edit_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: EnterEditModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid enter_edit_mode payload: {}", e))?;

    let request = EnterEditModeRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_enter_edit_mode_from_bridge(request) {
        tracing::info!("Queued enter_edit_mode for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for exit_edit_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExitEditModePayload {
    entity_id: String,
}

/// Handle exit_edit_mode command.
fn handle_exit_edit_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: ExitEditModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid exit_edit_mode payload: {}", e))?;

    let request = ExitEditModeRequest {
        entity_id: data.entity_id.clone(),
    };

    if queue_exit_edit_mode_from_bridge(request) {
        tracing::info!("Queued exit_edit_mode for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_selection_mode command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSelectionModePayload {
    entity_id: String,
    mode: String,
}

/// Handle set_selection_mode command.
fn handle_set_selection_mode(payload: serde_json::Value) -> super::CommandResult {
    let data: SetSelectionModePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_selection_mode payload: {}", e))?;

    if !SELECTION_MODES.contains(&data.mode.as_str()) {
        return Err(format!(
            "Unknown selection mode '{}'. Valid values: {}",
            data.mode,
            SELECTION_MODES.join(", ")
        ));
    }

    let request = SetSelectionModeRequest {
        entity_id: data.entity_id.clone(),
        mode: data.mode.clone(),
    };

    if queue_set_selection_mode_from_bridge(request) {
        tracing::info!("Queued set_selection_mode: {} -> {}", data.entity_id, data.mode);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for select_elements command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectElementsPayload {
    entity_id: String,
    indices: Vec<u32>,
}

/// Handle select_elements command.
fn handle_select_elements(payload: serde_json::Value) -> super::CommandResult {
    let data: SelectElementsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid select_elements payload: {}", e))?;

    let request = SelectElementsRequest {
        entity_id: data.entity_id.clone(),
        indices: data.indices.clone(),
    };

    if queue_select_elements_from_bridge(request) {
        tracing::info!("Queued select_elements for entity: {} ({} indices)", data.entity_id, data.indices.len());
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for mesh_operation command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeshOperationPayload {
    entity_id: String,
    operation: String,
    params: String,
}

/// Handle mesh_operation command.
fn handle_mesh_operation(payload: serde_json::Value) -> super::CommandResult {
    let data: MeshOperationPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid mesh_operation payload: {}", e))?;

    if !MESH_OPERATIONS.contains(&data.operation.as_str()) {
        return Err(format!(
            "Unknown mesh operation '{}'. Implemented: {}",
            data.operation,
            MESH_OPERATIONS.join(", ")
        ));
    }

    let request = MeshOperationRequest {
        entity_id: data.entity_id.clone(),
        operation: data.operation.clone(),
        params: data.params.clone(),
    };

    if queue_mesh_operation_from_bridge(request) {
        tracing::info!("Queued mesh_operation: {} ({})", data.entity_id, data.operation);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for recalc_normals command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecalcNormalsPayload {
    entity_id: String,
    smooth: bool,
}

/// Handle recalc_normals command.
fn handle_recalc_normals(payload: serde_json::Value) -> super::CommandResult {
    let data: RecalcNormalsPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid recalc_normals payload: {}", e))?;

    let request = RecalcNormalsRequest {
        entity_id: data.entity_id.clone(),
        smooth: data.smooth,
    };

    if queue_recalc_normals_from_bridge(request) {
        tracing::info!("Queued recalc_normals for entity: {} (smooth: {})", data.entity_id, data.smooth);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::parity_util::{assert_arm_coverage, quoted_arm_names};
    use crate::core::pending::{
        register_pending_commands, unregister_pending_commands, PendingCommands,
    };
    use serde_json::json;

    const MODULE_SOURCE: &str = include_str!("edit_mode.rs");
    const BRIDGE_SOURCE: &str = include_str!("../../bridge/edit_mode.rs");
    const DISPATCH_MARKER: &str = "pub fn dispatch(command: &str, payload: &serde_json::Value)";

    /// Every command this module answers. `every_dispatch_arm_is_covered` reads
    /// the production `match` and compares against this list in both directions,
    /// so it cannot drift from what the module actually dispatches.
    const TESTED_ARMS: &[&str] = &[
        "enter_edit_mode",
        "exit_edit_mode",
        "set_selection_mode",
        "select_elements",
        "mesh_operation",
        "recalc_normals",
    ];

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
    ) -> (super::super::CommandResult, PendingCommands) {
        let mut pending = PendingCommands::default();
        register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .unwrap_or_else(|| panic!("`{command}` is not dispatched by the edit-mode domain"));
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

    /// Dispatch with no queue registered at all.
    fn dispatch_unregistered(
        command: &str,
        payload: serde_json::Value,
    ) -> super::super::CommandResult {
        unregister_pending_commands();
        dispatch(command, &payload).expect("known edit-mode command")
    }

    // === Success shapes ===

    #[test]
    fn enter_edit_mode_queues_the_entity() {
        let pending = queue_after("enter_edit_mode", json!({"entityId": "cube-1"}));
        assert_eq!(pending.enter_edit_mode_requests.len(), 1);
        assert_eq!(pending.enter_edit_mode_requests[0].entity_id, "cube-1");
    }

    #[test]
    fn exit_edit_mode_queues_the_entity() {
        let pending = queue_after("exit_edit_mode", json!({"entityId": "cube-1"}));
        assert_eq!(pending.exit_edit_mode_requests.len(), 1);
        assert_eq!(pending.exit_edit_mode_requests[0].entity_id, "cube-1");
    }

    #[test]
    fn set_selection_mode_queues_every_mode_the_bridge_implements() {
        for mode in SELECTION_MODES {
            let pending = queue_after(
                "set_selection_mode",
                json!({"entityId": "cube-1", "mode": mode}),
            );
            assert_eq!(pending.set_selection_mode_requests.len(), 1);
            let request = &pending.set_selection_mode_requests[0];
            assert_eq!(request.entity_id, "cube-1");
            assert_eq!(&request.mode, mode);
        }
    }

    #[test]
    fn select_elements_queues_the_indices() {
        let pending = queue_after(
            "select_elements",
            json!({"entityId": "cube-1", "indices": [0, 4, 9]}),
        );
        assert_eq!(pending.select_elements_requests.len(), 1);
        let request = &pending.select_elements_requests[0];
        assert_eq!(request.entity_id, "cube-1");
        assert_eq!(request.indices, vec![0, 4, 9]);
    }

    #[test]
    fn mesh_operation_queues_the_operation_and_its_params_verbatim() {
        let pending = queue_after(
            "mesh_operation",
            json!({
                "entityId": "cube-1",
                "operation": "extrude",
                "params": "{\"indices\":[0,1],\"distance\":2.0}",
            }),
        );
        assert_eq!(pending.mesh_operation_requests.len(), 1);
        let request = &pending.mesh_operation_requests[0];
        assert_eq!(request.entity_id, "cube-1");
        assert_eq!(request.operation, "extrude");
        assert_eq!(request.params, "{\"indices\":[0,1],\"distance\":2.0}");
    }

    #[test]
    fn recalc_normals_carries_the_smooth_flag_both_ways() {
        for smooth in [true, false] {
            let pending = queue_after(
                "recalc_normals",
                json!({"entityId": "cube-1", "smooth": smooth}),
            );
            assert_eq!(pending.recalc_normals_requests.len(), 1);
            assert_eq!(pending.recalc_normals_requests[0].smooth, smooth);
        }
    }

    // === Rejections ===

    #[test]
    fn an_unknown_command_is_not_claimed_by_this_domain() {
        assert!(
            dispatch("set_material_color", &json!({"entityId": "cube-1"})).is_none(),
            "claiming a foreign command would shadow the domain that implements it"
        );
    }

    #[test]
    fn every_command_rejects_a_missing_entity_id() {
        let payloads = [
            ("enter_edit_mode", json!({})),
            ("exit_edit_mode", json!({})),
            ("set_selection_mode", json!({"mode": "vertex"})),
            ("select_elements", json!({"indices": [1]})),
            (
                "mesh_operation",
                json!({"operation": "extrude", "params": "{}"}),
            ),
            ("recalc_normals", json!({"smooth": true})),
        ];
        for (command, payload) in payloads {
            let error = error_from(command, payload);
            assert!(
                error.contains("entityId"),
                "`{command}` must name the missing field, said: {error}"
            );
        }
    }

    #[test]
    fn every_command_rejects_a_wrongly_typed_field() {
        let payloads = [
            // entityId is a String everywhere.
            ("enter_edit_mode", json!({"entityId": 7})),
            ("exit_edit_mode", json!({"entityId": ["cube-1"]})),
            (
                "set_selection_mode",
                json!({"entityId": "cube-1", "mode": 3}),
            ),
            // indices is Vec<u32>: a string element is not a number.
            (
                "select_elements",
                json!({"entityId": "cube-1", "indices": ["0"]}),
            ),
            // params is a pre-serialized JSON *string*, not an object.
            (
                "mesh_operation",
                json!({"entityId": "cube-1", "operation": "extrude", "params": {"level": 1}}),
            ),
            (
                "recalc_normals",
                json!({"entityId": "cube-1", "smooth": "yes"}),
            ),
        ];
        for (command, payload) in payloads {
            let error = error_from(command, payload);
            assert!(
                error.starts_with(&format!("Invalid {command} payload")),
                "`{command}` must reject a wrongly typed field, said: {error}"
            );
        }
    }

    #[test]
    fn select_elements_rejects_a_negative_index() {
        let error = error_from(
            "select_elements",
            json!({"entityId": "cube-1", "indices": [-1]}),
        );
        assert!(error.starts_with("Invalid select_elements payload"), "{error}");
    }

    /// Regression: an unknown mode used to queue, hit the bridge's
    /// `_ => continue`, and change nothing while the command reported success.
    #[test]
    fn set_selection_mode_rejects_a_mode_the_bridge_cannot_apply() {
        let error = error_from(
            "set_selection_mode",
            json!({"entityId": "cube-1", "mode": "object"}),
        );
        assert!(
            error.contains("Unknown selection mode 'object'"),
            "expected an honest failure, said: {error}"
        );
        assert!(
            error.contains("vertex") && error.contains("edge") && error.contains("face"),
            "the error must tell the caller what is valid, said: {error}"
        );
    }

    /// Regression: `inset`, `bevel`, `loop_cut` and `delete` are dispatched by the
    /// editor UI and the chat handlers, and the bridge implements none of them.
    /// They used to warn into the console and answer `Ok`.
    #[test]
    fn mesh_operation_rejects_an_operation_the_bridge_cannot_perform() {
        for operation in ["inset", "bevel", "loop_cut", "delete"] {
            let error = error_from(
                "mesh_operation",
                json!({"entityId": "cube-1", "operation": operation, "params": "{}"}),
            );
            assert!(
                error.contains(&format!("Unknown mesh operation '{operation}'")),
                "`{operation}` must fail honestly rather than no-op, said: {error}"
            );
        }
    }

    #[test]
    fn a_rejected_command_queues_nothing() {
        let (result, pending) = dispatch_with_queue(
            "mesh_operation",
            json!({"entityId": "cube-1", "operation": "bevel", "params": "{}"}),
        );
        assert!(result.is_err());
        assert!(
            pending.mesh_operation_requests.is_empty(),
            "a refused command must not leave work in the queue"
        );
    }

    #[test]
    fn every_command_reports_a_missing_pending_queue() {
        let payloads = [
            ("enter_edit_mode", json!({"entityId": "cube-1"})),
            ("exit_edit_mode", json!({"entityId": "cube-1"})),
            (
                "set_selection_mode",
                json!({"entityId": "cube-1", "mode": "vertex"}),
            ),
            (
                "select_elements",
                json!({"entityId": "cube-1", "indices": [0]}),
            ),
            (
                "mesh_operation",
                json!({"entityId": "cube-1", "operation": "extrude", "params": "{}"}),
            ),
            (
                "recalc_normals",
                json!({"entityId": "cube-1", "smooth": true}),
            ),
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
            "core/commands/edit_mode.rs",
            MODULE_SOURCE,
            DISPATCH_MARKER,
            TESTED_ARMS,
            4,
        );
    }

    /// The allowlist exists to mirror the bridge. If the bridge grows a mode this
    /// module does not know, the command would be refused for no reason; if it
    /// loses one, the command would go back to succeeding at nothing.
    #[test]
    fn the_selection_mode_allowlist_matches_what_the_bridge_implements() {
        let implemented = quoted_arm_names(BRIDGE_SOURCE, "match request.mode.as_str()");
        let implemented: Vec<&str> = implemented.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            implemented,
            SELECTION_MODES.to_vec(),
            "SELECTION_MODES has drifted from bridge/edit_mode.rs"
        );
    }

    #[test]
    fn the_mesh_operation_allowlist_matches_what_the_bridge_implements() {
        let implemented = quoted_arm_names(BRIDGE_SOURCE, "match request.operation.as_str()");
        let implemented: Vec<&str> = implemented.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            implemented,
            MESH_OPERATIONS.to_vec(),
            "MESH_OPERATIONS has drifted from bridge/edit_mode.rs"
        );
    }
}
