//! Transform Gizmo system for entity manipulation.
//!
//! Provides interactive 3-axis gizmos for translating, rotating, and scaling
//! selected entities. Integrates with the Selection system.
//! Supports multi-entity transforms via the transform-gizmo-bevy library.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use transform_gizmo_bevy::prelude::*;

use super::entity_id::EntityId;
use super::history::{HistoryStack, TransformSnapshot, UndoableAction};
use super::selection::Selection;

/// Plugin that adds transform gizmo functionality.
pub struct ForgeGizmoPlugin;

impl Plugin for ForgeGizmoPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(TransformGizmoPlugin)
            .init_resource::<ActiveGizmoMode>()
            .init_resource::<CoordinateMode>()
            .init_resource::<GizmoInteractionState>()
            .add_systems(Update, (
                configure_multi_target_gizmo,
                sync_gizmo_targets,
                apply_coordinate_mode,
                handle_gizmo_shortcuts,
                handle_coordinate_mode_shortcut,
                track_gizmo_interaction,
                emit_transform_changes,
            ));
    }
}

/// Tracks gizmo interaction state for history recording.
#[derive(Resource, Default)]
pub struct GizmoInteractionState {
    /// Whether the gizmo is currently being dragged
    is_dragging: bool,
    /// Transform snapshots captured when drag started
    drag_start_transforms: Vec<(String, TransformSnapshot)>,
}

/// Current gizmo manipulation mode (exposed to React).
#[derive(Resource, Default, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActiveGizmoMode {
    #[default]
    Translate,
    Rotate,
    Scale,
}

impl ActiveGizmoMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ActiveGizmoMode::Translate => "translate",
            ActiveGizmoMode::Rotate => "rotate",
            ActiveGizmoMode::Scale => "scale",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "translate" => Some(ActiveGizmoMode::Translate),
            "rotate" => Some(ActiveGizmoMode::Rotate),
            "scale" => Some(ActiveGizmoMode::Scale),
            _ => None,
        }
    }
}

/// Coordinate mode for gizmo transformations.
/// Maps directly to transform-gizmo-bevy's GizmoOrientation.
#[derive(Resource, Default, Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoordinateMode {
    /// Gizmo axes align to world XYZ.
    #[default]
    World,
    /// Gizmo axes align to the selected object's rotation.
    Local,
}

impl CoordinateMode {
    /// Convert to the crate's GizmoOrientation enum.
    pub fn to_gizmo_orientation(&self) -> GizmoOrientation {
        match self {
            CoordinateMode::World => GizmoOrientation::Global,
            CoordinateMode::Local => GizmoOrientation::Local,
        }
    }

    /// Toggle between World and Local modes.
    pub fn toggle(&self) -> Self {
        match self {
            CoordinateMode::World => CoordinateMode::Local,
            CoordinateMode::Local => CoordinateMode::World,
        }
    }

    /// String representation for display.
    pub fn as_str(&self) -> &'static str {
        match self {
            CoordinateMode::World => "world",
            CoordinateMode::Local => "local",
        }
    }

    /// Human-readable display name.
    pub fn display_name(&self) -> &'static str {
        match self {
            CoordinateMode::World => "World",
            CoordinateMode::Local => "Local",
        }
    }

    /// Parse from string (for commands).
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "world" | "global" => Some(CoordinateMode::World),
            "local" => Some(CoordinateMode::Local),
            _ => None,
        }
    }
}

/// System that configures GizmoOptions for multi-target transforms.
/// Runs once at startup and when configuration changes.
fn configure_multi_target_gizmo(
    mut gizmo_options: ResMut<GizmoOptions>,
    active_mode: Res<ActiveGizmoMode>,
) {
    // Enable grouped multi-target transforms
    gizmo_options.group_targets = true;

    // Update gizmo modes based on our ActiveGizmoMode resource
    // Each mode enables all axes for that transformation type
    gizmo_options.gizmo_modes = match *active_mode {
        ActiveGizmoMode::Translate => {
            GizmoMode::TranslateX | GizmoMode::TranslateY | GizmoMode::TranslateZ
                | GizmoMode::TranslateXY | GizmoMode::TranslateXZ | GizmoMode::TranslateYZ
        }
        ActiveGizmoMode::Rotate => {
            GizmoMode::RotateX | GizmoMode::RotateY | GizmoMode::RotateZ
        }
        ActiveGizmoMode::Scale => {
            GizmoMode::ScaleX | GizmoMode::ScaleY | GizmoMode::ScaleZ
                | GizmoMode::ScaleUniform
        }
    };
}

/// System that syncs gizmo targets with ALL selected entities.
/// Adds GizmoTarget to all selected entities, removes from unselected.
fn sync_gizmo_targets(
    selection: Res<Selection>,
    mut commands: Commands,
    gizmo_targets: Query<Entity, With<GizmoTarget>>,
    transforms: Query<&Transform>,
) {
    // Remove gizmo from entities that are no longer selected
    for entity in gizmo_targets.iter() {
        if !selection.entities.contains(&entity) {
            commands.entity(entity).remove::<GizmoTarget>();
        }
    }

    // Add gizmo to ALL selected entities that have transforms
    for &entity in selection.entities.iter() {
        if transforms.get(entity).is_ok() && !gizmo_targets.contains(entity) {
            commands.entity(entity).insert(GizmoTarget::default());
        }
    }
}

/// System that tracks gizmo interaction start/end for history recording.
fn track_gizmo_interaction(
    mouse_button: Res<ButtonInput<MouseButton>>,
    selection: Res<Selection>,
    query: Query<(&EntityId, &Transform), With<GizmoTarget>>,
    mut interaction_state: ResMut<GizmoInteractionState>,
    mut history: ResMut<HistoryStack>,
) {
    let left_pressed = mouse_button.pressed(MouseButton::Left);

    // Detect drag start
    if left_pressed && !interaction_state.is_dragging {
        // Check if any gizmo target exists (user might be clicking on gizmo)
        if !selection.entities.is_empty() {
            interaction_state.is_dragging = true;
            interaction_state.drag_start_transforms.clear();

            // Capture initial transforms for all selected entities
            for (entity_id, transform) in query.iter() {
                interaction_state.drag_start_transforms.push((
                    entity_id.0.clone(),
                    TransformSnapshot::from(transform),
                ));
            }
        }
    }

    // Detect drag end
    if !left_pressed && interaction_state.is_dragging {
        interaction_state.is_dragging = false;

        // Only record if we have transforms captured
        if !interaction_state.drag_start_transforms.is_empty() {
            // Capture final transforms and check if any actually changed
            let mut changes: Vec<(String, TransformSnapshot, TransformSnapshot)> = Vec::new();

            for (entity_id, old_transform) in interaction_state.drag_start_transforms.drain(..) {
                // Find current transform for this entity
                for (eid, transform) in query.iter() {
                    if eid.0 == entity_id {
                        let new_transform = TransformSnapshot::from(transform);

                        // Only record if transform actually changed
                        if old_transform != new_transform {
                            changes.push((entity_id.clone(), old_transform, new_transform));
                        }
                        break;
                    }
                }
            }

            // Push to history if any changes occurred
            if !changes.is_empty() {
                if changes.len() == 1 {
                    // Single entity - use existing TransformChange action
                    let (entity_id, old_transform, new_transform) = changes.remove(0);
                    history.push(UndoableAction::TransformChange {
                        entity_id,
                        old_transform,
                        new_transform,
                    });
                } else {
                    // Multiple entities - use new MultiTransformChange action
                    history.push(UndoableAction::MultiTransformChange { transforms: changes });
                }
            }
        }
    }
}

/// System that handles keyboard shortcuts for gizmo mode switching.
fn handle_gizmo_shortcuts(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut active_mode: ResMut<ActiveGizmoMode>,
) {
    if keyboard.just_pressed(KeyCode::KeyW) {
        *active_mode = ActiveGizmoMode::Translate;
    } else if keyboard.just_pressed(KeyCode::KeyE) {
        *active_mode = ActiveGizmoMode::Rotate;
    } else if keyboard.just_pressed(KeyCode::KeyR) {
        *active_mode = ActiveGizmoMode::Scale;
    }
}

/// System that applies the current coordinate mode to gizmo options.
fn apply_coordinate_mode(
    coordinate_mode: Res<CoordinateMode>,
    mut gizmo_options: ResMut<GizmoOptions>,
) {
    // Only update if the resource changed to avoid unnecessary updates
    if coordinate_mode.is_changed() {
        gizmo_options.gizmo_orientation = coordinate_mode.to_gizmo_orientation();
    }
}

/// System that handles the X key shortcut to toggle coordinate mode.
fn handle_coordinate_mode_shortcut(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut coordinate_mode: ResMut<CoordinateMode>,
) {
    if keyboard.just_pressed(KeyCode::KeyX) {
        let new_mode = coordinate_mode.toggle();
        *coordinate_mode = new_mode;

        // Emit event to React
        emit_coordinate_mode_changed(new_mode);
    }
}

/// Emit COORDINATE_MODE_CHANGED event to React.
fn emit_coordinate_mode_changed(mode: CoordinateMode) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CoordinateModePayload {
        mode: CoordinateMode,
        display_name: &'static str,
    }

    crate::bridge::events::emit_event("COORDINATE_MODE_CHANGED", &CoordinateModePayload {
        mode,
        display_name: mode.display_name(),
    });
}

/// Payload for transform change events sent to React.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransformPayload {
    pub entity_id: String,
    pub position: [f32; 3],
    pub rotation: [f32; 3], // Euler angles in radians
    pub scale: [f32; 3],
}

/// System that detects transform changes and emits events to React.
fn emit_transform_changes(
    selection: Res<Selection>,
    query: Query<(&EntityId, &Transform), Changed<Transform>>,
    mut last_transforms: Local<HashMap<Entity, Transform>>,
) {
    // Only track changes on the primary selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, transform)) = query.get(primary) {
            // Check if this is a meaningful change (not just floating point noise)
            let should_emit = last_transforms
                .get(&primary)
                .map(|last| !transforms_approx_equal(last, transform))
                .unwrap_or(true);

            if should_emit {
                last_transforms.insert(primary, *transform);

                let (rx, ry, rz) = transform.rotation.to_euler(EulerRot::XYZ);

                let payload = TransformPayload {
                    entity_id: entity_id.0.clone(),
                    position: [
                        transform.translation.x,
                        transform.translation.y,
                        transform.translation.z,
                    ],
                    rotation: [rx, ry, rz],
                    scale: [transform.scale.x, transform.scale.y, transform.scale.z],
                };

                crate::bridge::events::emit_event("TRANSFORM_CHANGED", &payload);
            }
        }
    }
}

/// Compare two transforms for approximate equality (to filter out floating point noise).
fn transforms_approx_equal(a: &Transform, b: &Transform) -> bool {
    const EPSILON: f32 = 0.0001;

    let pos_equal = (a.translation - b.translation).length_squared() < EPSILON;
    let rot_equal = a.rotation.dot(b.rotation).abs() > (1.0 - EPSILON);
    let scale_equal = (a.scale - b.scale).length_squared() < EPSILON;

    pos_equal && rot_equal && scale_equal
}

/// Set the gizmo mode from a command.
pub fn set_gizmo_mode(mode: ActiveGizmoMode, active_mode: &mut ResMut<ActiveGizmoMode>) {
    **active_mode = mode;
}

/// Set the coordinate mode from a command (public for pending_commands).
pub fn set_coordinate_mode(mode: CoordinateMode, coordinate_mode: &mut ResMut<CoordinateMode>) {
    **coordinate_mode = mode;
    emit_coordinate_mode_changed(mode);
}
