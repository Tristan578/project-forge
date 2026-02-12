//! Camera controls for the editor viewport.
//!
//! Uses `bevy_panorbit_camera` for orbit, pan, and zoom functionality.
//! Adds focus-on-selection (F key) and command integration.

use bevy::prelude::*;
use bevy_panorbit_camera::{PanOrbitCamera, PanOrbitCameraPlugin};

use super::camera_presets::{self, CameraViewState};
use super::entity_id::EntityId;
use super::pending_commands::PendingCommands;
use super::selection::Selection;

/// Plugin that adds camera control functionality.
pub struct CameraControlPlugin;

impl Plugin for CameraControlPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(PanOrbitCameraPlugin)
            .init_resource::<CameraViewState>()
            .add_systems(Update, (
                apply_pending_camera_focus,
                focus_on_selection_system,
                camera_presets::camera_preset_keyboard_system,
                camera_presets::apply_camera_preset_system,
                camera_presets::detect_animation_complete_system,
                camera_presets::detect_manual_orbit_system,
            ));
    }
}

/// Marker component for the editor camera.
#[derive(Component)]
pub struct EditorCamera;

/// System that applies pending camera focus requests from the bridge.
fn apply_pending_camera_focus(
    mut pending: ResMut<PendingCommands>,
    entity_query: Query<(&EntityId, &Transform)>,
    mut camera_query: Query<&mut PanOrbitCamera, With<EditorCamera>>,
) {
    for request in pending.camera_focus_requests.drain(..) {
        // Find the entity's transform
        if let Some((_, transform)) = entity_query
            .iter()
            .find(|(eid, _)| eid.0 == request.entity_id)
        {
            // Update camera focus target
            if let Ok(mut camera) = camera_query.single_mut() {
                camera.target_focus = transform.translation;
            }
        }
    }
}

/// System that handles 'F' key to focus on selected entity.
fn focus_on_selection_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    selection: Res<Selection>,
    entity_query: Query<(&EntityId, &Transform)>,
    mut camera_query: Query<&mut PanOrbitCamera, With<EditorCamera>>,
) {
    if keyboard.just_pressed(KeyCode::KeyF) {
        if let Some(primary_id) = &selection.primary_id {
            // Find the selected entity's transform
            if let Some((_, transform)) = entity_query
                .iter()
                .find(|(eid, _)| &eid.0 == primary_id)
            {
                // Update camera focus target
                if let Ok(mut camera) = camera_query.single_mut() {
                    camera.target_focus = transform.translation;
                }
            }
        }
    }
}

/// Focus the camera on a specific entity by ID.
/// Called from the command handler.
pub fn focus_camera_on_entity(
    entity_id: &str,
    entity_query: &Query<(&EntityId, &Transform)>,
    camera_query: &mut Query<&mut PanOrbitCamera, With<EditorCamera>>,
) -> Result<(), String> {
    // Find the entity's transform
    let transform = entity_query
        .iter()
        .find(|(eid, _)| eid.0 == entity_id)
        .map(|(_, t)| t)
        .ok_or_else(|| format!("Entity not found: {}", entity_id))?;

    // Update camera focus target
    if let Ok(mut camera) = camera_query.single_mut() {
        camera.target_focus = transform.translation;
        Ok(())
    } else {
        Err("No editor camera found".to_string())
    }
}
