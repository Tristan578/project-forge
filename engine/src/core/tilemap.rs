//! Tilemap data component for 2D tile-based levels.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Tilemap configuration component.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilemapData {
    pub tileset_asset_id: String,
    pub tile_size: [u32; 2],
    pub map_size: [u32; 2],
    pub layers: Vec<TilemapLayer>,
    pub origin: TilemapOrigin,
}

/// A single layer in a tilemap.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilemapLayer {
    pub name: String,
    pub tiles: Vec<Option<u32>>,
    pub visible: bool,
    pub opacity: f32,
    pub is_collision: bool,
}

/// Tilemap origin mode (TopLeft or Center).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum TilemapOrigin {
    TopLeft,
    Center,
}

/// Marker component indicating tilemap rendering is enabled.
#[derive(Component)]
pub struct TilemapEnabled;

impl Default for TilemapData {
    fn default() -> Self {
        Self {
            tileset_asset_id: String::new(),
            tile_size: [32, 32],
            map_size: [20, 15],
            layers: vec![TilemapLayer {
                name: "Layer 1".to_string(),
                tiles: vec![None; 20 * 15],
                visible: true,
                opacity: 1.0,
                is_collision: false,
            }],
            origin: TilemapOrigin::TopLeft,
        }
    }
}
