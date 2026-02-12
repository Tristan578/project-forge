//! Grid snapping system for precise object placement.
//!
//! Provides configurable snapping for translate, rotate, and scale operations
//! when the Ctrl key modifier is held during gizmo manipulation.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use transform_gizmo_bevy::prelude::*;

/// Resource storing snap configuration.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapSettings {
    /// Whether snapping is currently enabled (Ctrl held)
    pub snap_enabled: bool,

    /// Translation snap increment in world units (default: 0.5)
    pub translation_snap: f32,

    /// Rotation snap increment in degrees (default: 15.0)
    pub rotation_snap_degrees: f32,

    /// Scale snap increment (default: 0.25)
    pub scale_snap: f32,

    /// Whether the visual grid is displayed
    pub grid_visible: bool,

    /// Grid cell size (typically matches translation_snap)
    pub grid_size: f32,

    /// Grid extent (number of cells in each direction from origin)
    pub grid_extent: u32,
}

impl Default for SnapSettings {
    fn default() -> Self {
        Self {
            snap_enabled: false,
            translation_snap: 0.5,
            rotation_snap_degrees: 15.0,
            scale_snap: 0.25,
            grid_visible: false,
            grid_size: 0.5,
            grid_extent: 20, // 20 cells in each direction = 40x40 grid
        }
    }
}

impl SnapSettings {
    /// Get rotation snap in radians (for use with gizmo API).
    pub fn rotation_snap_radians(&self) -> f32 {
        self.rotation_snap_degrees.to_radians()
    }
}

/// Plugin that adds snap functionality.
pub struct SnapPlugin;

impl Plugin for SnapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SnapSettings>()
            .add_systems(
                Update,
                (detect_snap_modifier, apply_snap_to_gizmo, render_grid_overlay).chain(),
            );
    }
}

/// System that detects Ctrl key and updates snap state.
fn detect_snap_modifier(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut snap_settings: ResMut<SnapSettings>,
) {
    let ctrl_pressed =
        keyboard.pressed(KeyCode::ControlLeft) || keyboard.pressed(KeyCode::ControlRight);

    // Only update if changed to avoid unnecessary change detection
    if snap_settings.snap_enabled != ctrl_pressed {
        snap_settings.snap_enabled = ctrl_pressed;

        // Emit event to React when snap state changes
        crate::bridge::events::emit_snap_settings_changed(&snap_settings);
    }
}

/// System that configures gizmo snapping based on Ctrl state.
fn apply_snap_to_gizmo(
    snap_settings: Res<SnapSettings>,
    mut gizmo_options: ResMut<GizmoOptions>,
) {
    if snap_settings.is_changed() {
        if snap_settings.snap_enabled {
            gizmo_options.snap_distance = snap_settings.translation_snap;
            gizmo_options.snap_angle = snap_settings.rotation_snap_radians();
            gizmo_options.snap_scale = snap_settings.scale_snap;
        } else {
            gizmo_options.snap_distance = 0.0;
            gizmo_options.snap_angle = 0.0;
            gizmo_options.snap_scale = 0.0;
        }
    }
}

/// System that renders the visual grid overlay using Bevy gizmos.
fn render_grid_overlay(snap_settings: Res<SnapSettings>, mut gizmos: Gizmos) {
    if !snap_settings.grid_visible {
        return;
    }

    let grid_size = snap_settings.grid_size;
    let extent = snap_settings.grid_extent as i32;
    let half_extent = extent as f32 * grid_size;

    // Grid line color (subtle gray)
    let grid_color = Color::srgba(0.5, 0.5, 0.5, 0.3);
    let axis_color = Color::srgba(0.7, 0.7, 0.7, 0.5);

    // Draw grid lines parallel to X axis (varying Z)
    for i in -extent..=extent {
        let z = i as f32 * grid_size;
        let color = if i == 0 { axis_color } else { grid_color };
        gizmos.line(
            Vec3::new(-half_extent, 0.0, z),
            Vec3::new(half_extent, 0.0, z),
            color,
        );
    }

    // Draw grid lines parallel to Z axis (varying X)
    for i in -extent..=extent {
        let x = i as f32 * grid_size;
        let color = if i == 0 { axis_color } else { grid_color };
        gizmos.line(
            Vec3::new(x, 0.0, -half_extent),
            Vec3::new(x, 0.0, half_extent),
            color,
        );
    }
}

/// Snap a value to the nearest grid increment.
pub fn snap_to_grid(value: f32, snap: f32) -> f32 {
    if snap <= 0.0 {
        return value;
    }
    (value / snap).round() * snap
}
