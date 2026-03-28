//! Entity reparenting bridge system.
//!
//! This module contains the bridge-side apply system that drains reparent
//! requests from the pending queue and emits result events to JavaScript.
//! Pure logic lives in `core/reparent.rs`.

use bevy::prelude::*;

use crate::core::{
    entity_id::EntityId,
    pending_commands::PendingCommands,
    reparent::process_reparent,
};
use super::events::emit_event;

/// System that processes reparent requests from the bridge.
/// Drains the pending queue and emits REPARENT_RESULT events to JavaScript.
pub(super) fn apply_reparent_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(Entity, &EntityId, Option<&ChildOf>, Option<&Children>)>,
) {
    for request in pending.reparent_requests.drain(..) {
        let result = process_reparent(&request, &mut commands, &query);

        let (success, error) = match result {
            Ok(()) => (true, None),
            Err(e) => (false, Some(e)),
        };

        emit_reparent_result(&request.entity_id, success, error);
    }
}

fn emit_reparent_result(entity_id: &str, success: bool, error: Option<String>) {
    let payload = serde_json::json!({
        "success": success,
        "entityId": entity_id,
        "error": error,
    });
    emit_event("REPARENT_RESULT", &payload);
}
