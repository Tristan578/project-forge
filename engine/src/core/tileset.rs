//! Tileset data component for sprite sheet-based tile atlases.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tileset configuration for a sprite sheet-based tile atlas.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TilesetData {
    pub asset_id: String,
    pub tile_size: [u32; 2],
    pub grid_size: [u32; 2],
    pub spacing: u32,
    pub margin: u32,
    pub tiles: Vec<TileMetadata>,
}

/// Asset-keyed tileset metadata shared by every tilemap that references the atlas.
#[derive(Resource, Default)]
pub struct TilesetRegistry(pub HashMap<String, TilesetData>);

impl TilesetRegistry {
    pub fn insert(&mut self, data: TilesetData) {
        self.0.insert(data.asset_id.clone(), data);
    }

    pub fn remove(&mut self, asset_id: &str) {
        self.0.remove(asset_id);
    }
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

#[cfg(test)]
mod tests {
    use super::{TilesetData, TilesetRegistry};

    fn tileset(asset_id: &str, spacing: u32) -> TilesetData {
        TilesetData {
            asset_id: asset_id.to_string(),
            tile_size: [16, 16],
            grid_size: [8, 4],
            spacing,
            margin: 0,
            tiles: Vec::new(),
        }
    }

    #[test]
    fn registry_updates_and_removes_tilesets_by_asset_id() {
        let mut registry = TilesetRegistry::default();
        registry.insert(tileset("atlas-a", 0));
        registry.insert(tileset("atlas-b", 1));
        registry.insert(tileset("atlas-a", 2));

        assert_eq!(registry.0.len(), 2);
        assert_eq!(registry.0["atlas-a"].spacing, 2);
        assert_eq!(registry.0["atlas-b"].spacing, 1);

        registry.remove("atlas-a");
        assert!(!registry.0.contains_key("atlas-a"));
        assert!(registry.0.contains_key("atlas-b"));
    }
}
