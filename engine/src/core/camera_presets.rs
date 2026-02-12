//! Camera preset views for quick viewport navigation.
//!
//! Provides preset camera angles (Top, Front, Right, Perspective) with smooth
//! animated transitions using bevy_panorbit_camera's built-in interpolation.

use bevy::prelude::*;
use bevy_panorbit_camera::PanOrbitCamera;
use serde::{Deserialize, Serialize};

use super::camera::EditorCamera;
use super::pending_commands::PendingCommands;

/// Available camera preset views.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CameraPreset {
    /// Looking down Y-axis (top-down view)
    Top,
    /// Looking down Z-axis (front view)
    Front,
    /// Looking down X-axis (right side view)
    Right,
    /// Default diagonal 3D view
    #[default]
    Perspective,
}

impl CameraPreset {
    /// Get the target yaw angle in radians for this preset.
    /// Yaw is the horizontal rotation (azimuth).
    pub fn target_yaw(&self) -> f32 {
        match self {
            CameraPreset::Top => 0.0,
            CameraPreset::Front => 0.0,
            CameraPreset::Right => std::f32::consts::FRAC_PI_2, // 90 degrees
            CameraPreset::Perspective => std::f32::consts::FRAC_PI_4, // 45 degrees
        }
    }

    /// Get the target pitch angle in radians for this preset.
    /// Pitch is the vertical rotation (elevation).
    pub fn target_pitch(&self) -> f32 {
        match self {
            CameraPreset::Top => std::f32::consts::FRAC_PI_2 - 0.01, // Just under 90 deg (avoid gimbal lock)
            CameraPreset::Front => 0.0,
            CameraPreset::Right => 0.0,
            CameraPreset::Perspective => std::f32::consts::FRAC_PI_6, // 30 degrees
        }
    }

    /// Get the default radius for this preset (or None to keep current).
    pub fn target_radius(&self) -> Option<f32> {
        match self {
            CameraPreset::Top => Some(10.0), // Slightly further for top view
            CameraPreset::Front => None,     // Keep current distance
            CameraPreset::Right => None,     // Keep current distance
            CameraPreset::Perspective => Some(8.66), // Default perspective distance
        }
    }

    /// Human-readable name for UI display.
    pub fn display_name(&self) -> &'static str {
        match self {
            CameraPreset::Top => "Top",
            CameraPreset::Front => "Front",
            CameraPreset::Right => "Right",
            CameraPreset::Perspective => "Perspective",
        }
    }
}

/// Resource tracking the current camera view state.
#[derive(Resource, Debug, Clone)]
pub struct CameraViewState {
    /// The currently active preset (if any).
    /// None if the user has manually orbited away from a preset.
    pub current_preset: Option<CameraPreset>,

    /// Whether the camera is in orthographic projection mode.
    /// (Future enhancement - initially always false)
    pub is_orthographic: bool,

    /// Whether an animation is currently in progress.
    pub is_animating: bool,
}

impl Default for CameraViewState {
    fn default() -> Self {
        Self {
            current_preset: Some(CameraPreset::Perspective),
            is_orthographic: false,
            is_animating: false,
        }
    }
}

/// Smoothness values for preset transitions.
/// Range 0.0 (instant) to 1.0 (very slow). Higher = smoother/slower.
const PRESET_ORBIT_SMOOTHNESS: f32 = 0.8;
const PRESET_ZOOM_SMOOTHNESS: f32 = 0.8;

/// System that handles applying camera presets from pending commands.
pub fn apply_camera_preset_system(
    mut camera_query: Query<&mut PanOrbitCamera, With<EditorCamera>>,
    mut view_state: ResMut<CameraViewState>,
    mut pending: ResMut<PendingCommands>,
) {
    // Process pending preset requests from bridge commands
    for request in pending.camera_preset_requests.drain(..) {
        apply_preset_to_camera(&mut camera_query, &mut view_state, request.preset);
    }
}

/// Apply a preset to the camera.
fn apply_preset_to_camera(
    camera_query: &mut Query<&mut PanOrbitCamera, With<EditorCamera>>,
    view_state: &mut CameraViewState,
    preset: CameraPreset,
) {
    if let Ok(mut camera) = camera_query.single_mut() {
        // Set target values for smooth animation
        camera.target_yaw = preset.target_yaw();
        camera.target_pitch = preset.target_pitch();

        // Only update radius if preset specifies one
        if let Some(radius) = preset.target_radius() {
            camera.target_radius = radius;
        }

        // Configure smoothness for the transition
        camera.orbit_smoothness = PRESET_ORBIT_SMOOTHNESS;
        camera.zoom_smoothness = PRESET_ZOOM_SMOOTHNESS;

        // Update state
        view_state.current_preset = Some(preset);
        view_state.is_animating = true;

        // Emit event to React
        emit_view_preset_changed(preset);
    }
}

/// System that handles keyboard shortcuts for camera presets.
pub fn camera_preset_keyboard_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut camera_query: Query<&mut PanOrbitCamera, With<EditorCamera>>,
    mut view_state: ResMut<CameraViewState>,
) {
    // Check for numpad keys
    let numpad_preset = if keyboard.just_pressed(KeyCode::Numpad7) {
        Some(CameraPreset::Top)
    } else if keyboard.just_pressed(KeyCode::Numpad1) {
        Some(CameraPreset::Front)
    } else if keyboard.just_pressed(KeyCode::Numpad3) {
        Some(CameraPreset::Right)
    } else if keyboard.just_pressed(KeyCode::Numpad5) {
        Some(CameraPreset::Perspective)
    } else {
        None
    };

    // Check for Alt+number alternatives (for keyboards without numpad)
    let alt_pressed = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    let alt_preset = if alt_pressed {
        if keyboard.just_pressed(KeyCode::Digit7) {
            Some(CameraPreset::Top)
        } else if keyboard.just_pressed(KeyCode::Digit1) {
            Some(CameraPreset::Front)
        } else if keyboard.just_pressed(KeyCode::Digit3) {
            Some(CameraPreset::Right)
        } else if keyboard.just_pressed(KeyCode::Digit5) {
            Some(CameraPreset::Perspective)
        } else {
            None
        }
    } else {
        None
    };

    // Apply the preset if one was triggered
    if let Some(preset) = numpad_preset.or(alt_preset) {
        apply_preset_to_camera(&mut camera_query, &mut view_state, preset);
    }
}

/// System that detects when camera animation completes.
pub fn detect_animation_complete_system(
    camera_query: Query<&PanOrbitCamera, With<EditorCamera>>,
    mut view_state: ResMut<CameraViewState>,
) {
    if !view_state.is_animating {
        return;
    }

    if let Ok(camera) = camera_query.single() {
        // Check if current values are close to targets
        // yaw, pitch, radius are Option<f32>, target_* are f32
        let yaw_done = camera.yaw.map(|y| (y - camera.target_yaw).abs() < 0.01).unwrap_or(true);
        let pitch_done = camera.pitch.map(|p| (p - camera.target_pitch).abs() < 0.01).unwrap_or(true);
        let radius_done = camera.radius.map(|r| (r - camera.target_radius).abs() < 0.1).unwrap_or(true);

        if yaw_done && pitch_done && radius_done {
            view_state.is_animating = false;
        }
    }
}

/// System that clears preset state when user manually orbits the camera.
pub fn detect_manual_orbit_system(
    camera_query: Query<&PanOrbitCamera, (With<EditorCamera>, Changed<PanOrbitCamera>)>,
    mouse_button: Res<ButtonInput<MouseButton>>,
    mut view_state: ResMut<CameraViewState>,
) {
    // Only clear preset if user is actively orbiting (right-click held)
    let is_orbiting = mouse_button.pressed(MouseButton::Right);

    if is_orbiting && !view_state.is_animating {
        if camera_query.single().is_ok() {
            // User manually moved the camera - clear preset indicator
            if view_state.current_preset.is_some() {
                view_state.current_preset = None;
                emit_view_preset_changed_cleared();
            }
        }
    }
}

/// Emit VIEW_PRESET_CHANGED event to React.
fn emit_view_preset_changed(preset: CameraPreset) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ViewPresetPayload {
        preset: CameraPreset,
        display_name: &'static str,
    }

    crate::bridge::events::emit_event("VIEW_PRESET_CHANGED", &ViewPresetPayload {
        preset,
        display_name: preset.display_name(),
    });
}

/// Emit event when preset is cleared (user manually orbited).
fn emit_view_preset_changed_cleared() {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ViewPresetClearedPayload {
        preset: Option<()>,  // null
        display_name: Option<()>,  // null
    }

    crate::bridge::events::emit_event("VIEW_PRESET_CHANGED", &ViewPresetClearedPayload {
        preset: None,
        display_name: None,
    });
}
