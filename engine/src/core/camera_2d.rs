//! 2D camera configuration.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Camera configuration for 2D projects.
#[derive(Component, Clone, Serialize, Deserialize)]
pub struct Camera2dData {
    /// Zoom level (1.0 = default, <1.0 = zoomed out, >1.0 = zoomed in)
    pub zoom: f32,
    /// Enable pixel-perfect rendering (snaps to whole pixels)
    pub pixel_perfect: bool,
    /// Optional camera movement bounds
    pub bounds: Option<CameraBounds>,
}

/// Bounds for restricting camera movement.
#[derive(Clone, Serialize, Deserialize)]
pub struct CameraBounds {
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

impl Default for Camera2dData {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pixel_perfect: false,
            bounds: None,
        }
    }
}

/// Marker component indicating 2D camera is enabled.
#[derive(Component)]
pub struct Camera2dEnabled;
