//! Drains `core::render_errors::RenderErrorTracker` into `RENDER_ERROR` events.
//!
//! The classification and the once-per-error bookkeeping live in `core/`, where
//! they are tested natively; this wrapper only moves reports across the wire.
//! It is registered unconditionally (editor and runtime), and it keeps running
//! after rendering stops, because `StopRendering` halts the render sub-app only.

use bevy::prelude::*;

use super::events::emit_render_error;
use crate::core::render_errors::RenderErrorTracker;

/// Emit every pending render-error report, oldest first.
pub(super) fn emit_render_error_reports(tracker: Option<ResMut<RenderErrorTracker>>) {
    let Some(mut tracker) = tracker else { return };
    for report in tracker.take_pending() {
        emit_render_error(&report);
    }
}
