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

/// Resource for configuring the 2D editor grid overlay.
#[derive(Resource, Clone, Debug)]
pub struct Grid2dConfig {
    pub visible: bool,
    pub cell_size: f32,
    pub color: [f32; 4],
}

impl Default for Grid2dConfig {
    fn default() -> Self {
        Self {
            visible: false,
            cell_size: 32.0,
            color: [0.3, 0.3, 0.3, 0.5],
        }
    }
}

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

/// Resolve a tile coordinate to a flat index into a `TilemapLayer::tiles` vector,
/// or `None` if the write must be skipped.
///
/// Four ways a write is refused, and the third is the one a hand-written
/// `y * map_w + x` misses: `map_size` is authored data that nothing forces to
/// agree with the length of `tiles`, so a tilemap declaring a map far larger
/// than its own vector can make `y * map_w` WRAP on wasm32's 32-bit `usize`.
/// A wrapped product lands back inside the vector and writes the WRONG cell —
/// silent corruption that the `< tiles_len` bound below cannot see, because the
/// wrapped value passes it. Checked arithmetic turns that into a skip.
///
/// Kept in `core/` rather than the bridge so it is unit-testable: `bridge/` is
/// `#[cfg(target_arch = "wasm32")]`, so native `cargo test` never compiles it.
pub fn tile_flat_index(
    x: usize,
    y: usize,
    map_w: usize,
    map_h: usize,
    tiles_len: usize,
) -> Option<usize> {
    if x >= map_w || y >= map_h {
        return None;
    }
    let index = y.checked_mul(map_w)?.checked_add(x)?;
    if index >= tiles_len {
        return None;
    }
    Some(index)
}

#[cfg(test)]
mod tile_flat_index_tests {
    use super::tile_flat_index;

    #[test]
    fn resolves_an_in_range_coordinate() {
        // Row-major: (x=3, y=2) on a 20-wide map is 2 * 20 + 3.
        assert_eq!(tile_flat_index(3, 2, 20, 15, 300), Some(43));
    }

    #[test]
    fn resolves_the_first_and_last_cell() {
        assert_eq!(tile_flat_index(0, 0, 20, 15, 300), Some(0));
        assert_eq!(tile_flat_index(19, 14, 20, 15, 300), Some(299));
    }

    #[test]
    fn refuses_a_coordinate_outside_the_declared_map() {
        assert_eq!(tile_flat_index(20, 0, 20, 15, 300), None);
        assert_eq!(tile_flat_index(0, 15, 20, 15, 300), None);
    }

    #[test]
    fn refuses_an_index_past_the_end_of_the_tiles_vector() {
        // Inside the DECLARED map, but the layer's vector was never grown to
        // match: map_size and tiles.len() are independent authored data.
        assert_eq!(tile_flat_index(19, 14, 20, 15, 100), None);
    }

    #[test]
    fn refuses_a_multiplication_that_would_overflow() {
        // `y * map_w` cannot be represented, so there is no honest index. A bare
        // `*` would wrap to a small value that passes the `< tiles_len` bound
        // and corrupt an unrelated cell.
        let huge = usize::MAX / 2 + 1;
        assert_eq!(tile_flat_index(0, 2, huge, usize::MAX, usize::MAX), None);
    }

    #[test]
    fn refuses_an_addition_that_would_overflow() {
        // The product fits but the column push past it does not.
        assert_eq!(
            tile_flat_index(2, 1, usize::MAX, usize::MAX, usize::MAX),
            None,
        );
    }
}
