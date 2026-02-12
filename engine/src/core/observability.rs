//! Observability module - first-frame detection and lifecycle events.

use bevy::prelude::*;

/// Plugin for observability and lifecycle event emission.
pub struct ObservabilityPlugin;

impl Plugin for ObservabilityPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(PostStartup, detect_first_frame);
    }
}

/// System that detects when the first frame has been processed.
/// Runs once in PostStartup to signal that initialization is complete.
fn detect_first_frame() {
    // Emit ready event through the bridge
    crate::bridge::emit_init_event("ready", Some("First frame rendered"), None);
}
