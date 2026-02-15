//! 2D sprite rendering components.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Sprite data component for 2D entities.
#[derive(Component, Clone, Serialize, Deserialize)]
pub struct SpriteData {
    /// Asset ID of the texture to render
    pub texture_asset_id: Option<String>,
    /// Color tint to apply to the sprite (RGBA, 0-1 range)
    pub color_tint: [f32; 4],
    /// Flip sprite horizontally
    pub flip_x: bool,
    /// Flip sprite vertically
    pub flip_y: bool,
    /// Custom size in world units (None = use texture dimensions)
    pub custom_size: Option<[f32; 2]>,
    /// Sorting layer name for draw order
    pub sorting_layer: String,
    /// Order within the sorting layer (higher = drawn on top)
    pub sorting_order: i32,
    /// Anchor point of the sprite
    pub anchor: SpriteAnchor,
}

/// Anchor point for sprite rendering.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpriteAnchor {
    Center,
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl Default for SpriteData {
    fn default() -> Self {
        Self {
            texture_asset_id: None,
            color_tint: [1.0, 1.0, 1.0, 1.0],
            flip_x: false,
            flip_y: false,
            custom_size: None,
            sorting_layer: "Default".to_string(),
            sorting_order: 0,
            anchor: SpriteAnchor::Center,
        }
    }
}

/// Marker component indicating sprite rendering is enabled.
#[derive(Component)]
pub struct SpriteEnabled;

/// Calculate Z-position from sorting layer and order.
/// Used to convert 2D layering into 3D Z depth for rendering.
pub fn z_from_sorting(data: &SpriteData) -> f32 {
    let layer_base = match data.sorting_layer.as_str() {
        "Background" => 0.0,
        "Default" => 100.0,
        "Foreground" => 200.0,
        "UI" => 300.0,
        _ => 100.0,
    };
    layer_base + (data.sorting_order as f32 * 0.01)
}
