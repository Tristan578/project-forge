//! Tileset data component for sprite sheet-based tile atlases.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Tileset configuration component (stores tileset metadata).
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilesetData {
    pub asset_id: String,
    pub tile_size: [u32; 2],
    pub grid_size: [u32; 2],
    pub spacing: u32,
    pub margin: u32,
    pub tiles: Vec<TileMetadata>,
}

/// Metadata for a single tile in a tileset.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileMetadata {
    pub tile_id: u32,
    pub name: Option<String>,
    pub collision: bool,
    pub animation: Option<TileAnimation>,
}

/// Animation data for animated tiles.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileAnimation {
    pub frame_ids: Vec<u32>,
    pub frame_duration: f32,
}
