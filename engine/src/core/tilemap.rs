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
    /// Per-cell collision shape, parallel to `tiles` (index `i` describes the
    /// same cell as `tiles[i]`).
    ///
    /// `#[serde(default)]` is load-bearing for backward compatibility: every
    /// scene exported before OP-04 carries only the layer-level `is_collision`
    /// flag and no `collisionShapes` key, so the field must default to an empty
    /// vector rather than fail the whole scene load. An empty vector means "no
    /// per-tile shapes authored" — collision then falls back to the layer's
    /// `is_collision` flag (a full solid tile for any non-empty cell), exactly
    /// as those older scenes behaved.
    #[serde(default)]
    pub collision_shapes: Vec<CollisionShape>,
}

/// The collision silhouette of a single tile.
///
/// Authored per cell (OP-04). `None` is the default for every cell so that a
/// tilemap deserialized without a `collisionShapes` array — every pre-OP-04
/// scene — behaves exactly as it did before this field existed.
///
/// Serialized as the camelCase strings `none` / `full` / `halfTop` /
/// `halfBottom` / `slopeLeft` / `slopeRight`, matching the JS command contract
/// in `web/src/stores/slices/types.ts` and the `set_tile_collision_shape`
/// command payload.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CollisionShape {
    /// No collision — the cell is passable.
    #[default]
    None,
    /// A solid tile filling the whole cell.
    Full,
    /// Solid in the top half (`y >= 0.5` in tile-local coords); passable below.
    HalfTop,
    /// Solid in the bottom half (`y <= 0.5` in tile-local coords); passable above.
    HalfBottom,
    /// A slope whose surface is high on the left and descends to the right; the
    /// solid region is the triangle below the diagonal from the top-left corner
    /// to the bottom-right corner (`y <= 1 - x`).
    SlopeLeft,
    /// A slope whose surface is high on the right and descends to the left; the
    /// solid region is the triangle below the diagonal from the bottom-left
    /// corner to the top-right corner (`y <= x`).
    SlopeRight,
}

impl CollisionShape {
    /// Parse the wire string a command payload carries into a shape.
    ///
    /// This is the single source of truth for the shape vocabulary shared by
    /// the `set_tile_collision_shape` engine command and its chat-handler /
    /// script-API siblings. Returns `None` for any unrecognized string so the
    /// caller can report an actionable error rather than silently defaulting to
    /// a passable cell (which would corrupt authoring intent in silence).
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "none" => Some(CollisionShape::None),
            "full" => Some(CollisionShape::Full),
            "halfTop" => Some(CollisionShape::HalfTop),
            "halfBottom" => Some(CollisionShape::HalfBottom),
            "slopeLeft" => Some(CollisionShape::SlopeLeft),
            "slopeRight" => Some(CollisionShape::SlopeRight),
            _ => None,
        }
    }

    /// The wire string this shape serializes to (the inverse of `from_wire`).
    pub fn as_wire(self) -> &'static str {
        match self {
            CollisionShape::None => "none",
            CollisionShape::Full => "full",
            CollisionShape::HalfTop => "halfTop",
            CollisionShape::HalfBottom => "halfBottom",
            CollisionShape::SlopeLeft => "slopeLeft",
            CollisionShape::SlopeRight => "slopeRight",
        }
    }
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
                collision_shapes: Vec::new(),
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

/// Write one cell's collision shape into a layer, growing `collision_shapes` to
/// match `tiles.len()` (filling the gap with `CollisionShape::None`) the first
/// time a shape is authored on the layer.
///
/// Returns `true` when the cell was written, `false` when the coordinate is out
/// of range — in which case nothing is mutated, so an oversized or off-map edit
/// cannot corrupt an existing cell (the OP-04 "rejects or recovers from invalid
/// work" scenario).
///
/// Lives in `core/` beside `tile_flat_index` for the same reason: the bridge is
/// `wasm32`-only, so any assertion about this write would never run under
/// native `cargo test --lib`.
pub fn set_layer_collision_shape(
    layer: &mut TilemapLayer,
    x: usize,
    y: usize,
    map_w: usize,
    map_h: usize,
    shape: CollisionShape,
) -> bool {
    let tiles_len = layer.tiles.len();
    let Some(index) = tile_flat_index(x, y, map_w, map_h, tiles_len) else {
        return false;
    };
    if layer.collision_shapes.len() != tiles_len {
        // First authored shape on this layer (or a layer whose vector never
        // matched its tiles): size it once, defaulting every cell to passable.
        layer
            .collision_shapes
            .resize(tiles_len, CollisionShape::None);
    }
    layer.collision_shapes[index] = shape;
    true
}

/// Test whether two axis-aligned boxes overlap. Edge-touching does not count as
/// overlap (strict inequalities), so a player resting exactly on a surface is
/// not reported as embedded in it.
fn aabb_overlap(a_min: [f32; 2], a_max: [f32; 2], b_min: [f32; 2], b_max: [f32; 2]) -> bool {
    a_min[0] < b_max[0]
        && a_max[0] > b_min[0]
        && a_min[1] < b_max[1]
        && a_max[1] > b_min[1]
}

/// Whether a point given in tile-local normalized coordinates (the tile is the
/// unit square, `(0,0)` bottom-left, `(1,1)` top-right, world Y-up) lies inside
/// the solid region of `shape`.
///
/// This is the canonical definition of every shape's silhouette; the AABB
/// resolver below is defined in terms of it for the slope cases.
pub fn point_in_tile_solid(shape: CollisionShape, lx: f32, ly: f32) -> bool {
    if !(0.0..=1.0).contains(&lx) || !(0.0..=1.0).contains(&ly) {
        return false;
    }
    match shape {
        CollisionShape::None => false,
        CollisionShape::Full => true,
        CollisionShape::HalfTop => ly >= 0.5,
        CollisionShape::HalfBottom => ly <= 0.5,
        CollisionShape::SlopeLeft => ly <= 1.0 - lx,
        CollisionShape::SlopeRight => ly <= lx,
    }
}

/// The solid axis-aligned sub-box of a box-type shape, in tile-local normalized
/// coordinates. `None` for `CollisionShape::None` (no collision) and for the
/// slope shapes, whose solid region is triangular — callers resolve those
/// through `point_in_tile_solid` instead.
pub fn shape_solid_box(shape: CollisionShape) -> Option<([f32; 2], [f32; 2])> {
    match shape {
        CollisionShape::None => None,
        CollisionShape::Full => Some(([0.0, 0.0], [1.0, 1.0])),
        CollisionShape::HalfTop => Some(([0.0, 0.5], [1.0, 1.0])),
        CollisionShape::HalfBottom => Some(([0.0, 0.0], [1.0, 0.5])),
        CollisionShape::SlopeLeft | CollisionShape::SlopeRight => None,
    }
}

/// Whether a player AABB (world-space `min`/`max`) collides with the solid
/// region of a tile whose bottom-left corner sits at `tile_min` and whose side
/// length is `tile_size`.
///
/// Box shapes (`Full`, `HalfTop`, `HalfBottom`) are resolved exactly by
/// overlapping the player box with the shape's solid sub-box. Slopes are
/// resolved by sampling the corners of the player∩tile rectangle against
/// `point_in_tile_solid`, which is sufficient for the triangular silhouettes
/// and keeps this function total for all six shapes.
///
/// This is the pure resolver the OP-04 fixture exercises: it is the thing that
/// makes "a player collides with a half-top tile only in its solid half" a real
/// geometry assertion, and it lives in `core/` so `cargo test --lib` runs it.
///
/// SCOPE: this is a standalone geometry primitive, NOT yet a live gameplay
/// control. Nothing in the Play-mode physics runtime calls it — the 2D
/// simulation (`physics_2d_sim.rs`, bevy_rapier2d) generates no tilemap
/// colliders at all, so a played build ignores per-tile shapes exactly as it
/// ignores the layer-level `is_collision` flag today. The unit tests below
/// therefore prove the silhouette math, not that a player's movement respects
/// it in Play mode. Wiring this into rapier collider generation (including
/// triangle colliders for the slope cases) is a separate runtime step tracked
/// under parent #9814 (OP-05); do not read the coverage here as shipped
/// gameplay collision.
pub fn player_overlaps_tile_solid(
    player_min: [f32; 2],
    player_max: [f32; 2],
    tile_min: [f32; 2],
    tile_size: f32,
    shape: CollisionShape,
) -> bool {
    if tile_size <= 0.0 {
        return false;
    }
    let tile_max = [tile_min[0] + tile_size, tile_min[1] + tile_size];

    // A shape with no solid region never collides.
    if shape == CollisionShape::None {
        return false;
    }

    if let Some((box_min, box_max)) = shape_solid_box(shape) {
        let solid_min = [
            tile_min[0] + box_min[0] * tile_size,
            tile_min[1] + box_min[1] * tile_size,
        ];
        let solid_max = [
            tile_min[0] + box_max[0] * tile_size,
            tile_min[1] + box_max[1] * tile_size,
        ];
        return aabb_overlap(player_min, player_max, solid_min, solid_max);
    }

    // Slope: the player must first overlap the tile bounds at all, then some
    // corner of the overlap region must fall inside the slope triangle.
    if !aabb_overlap(player_min, player_max, tile_min, tile_max) {
        return false;
    }
    let clamp = |v: f32, lo: f32, hi: f32| v.max(lo).min(hi);
    let ix_min = clamp(player_min[0], tile_min[0], tile_max[0]);
    let ix_max = clamp(player_max[0], tile_min[0], tile_max[0]);
    let iy_min = clamp(player_min[1], tile_min[1], tile_max[1]);
    let iy_max = clamp(player_max[1], tile_min[1], tile_max[1]);
    for (wx, wy) in [
        (ix_min, iy_min),
        (ix_max, iy_min),
        (ix_min, iy_max),
        (ix_max, iy_max),
    ] {
        let lx = (wx - tile_min[0]) / tile_size;
        let ly = (wy - tile_min[1]) / tile_size;
        if point_in_tile_solid(shape, lx, ly) {
            return true;
        }
    }
    false
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

#[cfg(test)]
mod collision_shape_tests {
    use super::*;

    #[test]
    fn every_shape_round_trips_through_the_wire_strings() {
        for shape in [
            CollisionShape::None,
            CollisionShape::Full,
            CollisionShape::HalfTop,
            CollisionShape::HalfBottom,
            CollisionShape::SlopeLeft,
            CollisionShape::SlopeRight,
        ] {
            assert_eq!(CollisionShape::from_wire(shape.as_wire()), Some(shape));
        }
    }

    #[test]
    fn serde_uses_the_camelcase_wire_strings() {
        assert_eq!(
            serde_json::to_string(&CollisionShape::HalfTop).unwrap(),
            "\"halfTop\"",
        );
        assert_eq!(
            serde_json::from_str::<CollisionShape>("\"slopeRight\"").unwrap(),
            CollisionShape::SlopeRight,
        );
    }

    #[test]
    fn an_unknown_wire_string_is_refused_rather_than_defaulted() {
        // A typo must be a reportable error, never a silent passable cell.
        assert_eq!(CollisionShape::from_wire("halftop"), None);
        assert_eq!(CollisionShape::from_wire(""), None);
        assert_eq!(CollisionShape::from_wire("solid"), None);
    }

    #[test]
    fn the_default_shape_is_none() {
        assert_eq!(CollisionShape::default(), CollisionShape::None);
    }

    #[test]
    fn a_layer_deserialized_without_collision_shapes_defaults_to_empty() {
        // Every pre-OP-04 scene is exactly this shape: no `collisionShapes` key.
        // It must load, not error, and leave the vector empty (fall back to the
        // layer-level `is_collision` flag).
        let json = r#"{
            "name": "Layer 1",
            "tiles": [null, 3, null, 7],
            "visible": true,
            "opacity": 1.0,
            "isCollision": true
        }"#;
        let layer: TilemapLayer = serde_json::from_str(json).unwrap();
        assert!(layer.collision_shapes.is_empty());
        assert!(layer.is_collision);
        assert_eq!(layer.tiles, vec![None, Some(3), None, Some(7)]);
    }

    #[test]
    fn a_populated_collision_shapes_array_round_trips() {
        let json = r#"{
            "name": "Ground",
            "tiles": [1, 2],
            "visible": true,
            "opacity": 1.0,
            "isCollision": true,
            "collisionShapes": ["full", "halfTop"]
        }"#;
        let layer: TilemapLayer = serde_json::from_str(json).unwrap();
        assert_eq!(
            layer.collision_shapes,
            vec![CollisionShape::Full, CollisionShape::HalfTop],
        );
        // And re-serializing keeps the field.
        let back = serde_json::to_string(&layer).unwrap();
        assert!(back.contains("\"collisionShapes\""));
        assert!(back.contains("\"halfTop\""));
    }
}

#[cfg(test)]
mod set_layer_collision_shape_tests {
    use super::*;

    fn layer(tiles: usize) -> TilemapLayer {
        TilemapLayer {
            name: "L".to_string(),
            tiles: vec![None; tiles],
            visible: true,
            opacity: 1.0,
            is_collision: true,
            collision_shapes: Vec::new(),
        }
    }

    #[test]
    fn first_write_grows_the_vector_and_defaults_the_rest_to_none() {
        // 4x1 map. Author a shape at x=2 only.
        let mut l = layer(4);
        assert!(set_layer_collision_shape(
            &mut l,
            2,
            0,
            4,
            1,
            CollisionShape::HalfBottom,
        ));
        assert_eq!(l.collision_shapes.len(), 4);
        assert_eq!(
            l.collision_shapes,
            vec![
                CollisionShape::None,
                CollisionShape::None,
                CollisionShape::HalfBottom,
                CollisionShape::None,
            ],
        );
    }

    #[test]
    fn an_out_of_range_cell_writes_nothing() {
        // The "rejects or recovers from invalid work" scenario: an oversized
        // edit must not corrupt existing cells. Seed one authored shape first.
        let mut l = layer(4);
        assert!(set_layer_collision_shape(&mut l, 0, 0, 4, 1, CollisionShape::Full));
        let before = l.collision_shapes.clone();

        assert!(!set_layer_collision_shape(&mut l, 9, 0, 4, 1, CollisionShape::SlopeLeft));
        assert!(!set_layer_collision_shape(&mut l, 0, 9, 4, 1, CollisionShape::SlopeLeft));
        assert_eq!(l.collision_shapes, before, "invalid edit left cells intact");
    }

    #[test]
    fn a_second_write_does_not_reset_earlier_cells() {
        let mut l = layer(3);
        assert!(set_layer_collision_shape(&mut l, 0, 0, 3, 1, CollisionShape::Full));
        assert!(set_layer_collision_shape(&mut l, 2, 0, 3, 1, CollisionShape::HalfTop));
        assert_eq!(l.collision_shapes[0], CollisionShape::Full);
        assert_eq!(l.collision_shapes[2], CollisionShape::HalfTop);
        assert_eq!(l.collision_shapes.len(), 3);
    }
}

#[cfg(test)]
mod collision_resolution_tests {
    use super::*;

    // The OP-04 acceptance fixture, distilled to its pure geometric core: a
    // player collides with a HALF-TOP tile only while it is above the tile's
    // midline, and passes through the lower half. A single unit tile at the
    // origin keeps the arithmetic legible; `player_overlaps_tile_solid` scales
    // to any tile size, exercised separately below.

    const TILE_MIN: [f32; 2] = [0.0, 0.0];
    const TILE: f32 = 1.0;

    #[test]
    fn half_top_collides_only_in_its_solid_upper_half() {
        // Player sitting in the UPPER half → collides.
        assert!(player_overlaps_tile_solid(
            [0.25, 0.6],
            [0.75, 0.9],
            TILE_MIN,
            TILE,
            CollisionShape::HalfTop,
        ));
        // Player entirely in the LOWER half → passes through.
        assert!(!player_overlaps_tile_solid(
            [0.25, 0.1],
            [0.75, 0.4],
            TILE_MIN,
            TILE,
            CollisionShape::HalfTop,
        ));
        // Player straddling the midline → collides (it reaches the solid part).
        assert!(player_overlaps_tile_solid(
            [0.25, 0.3],
            [0.75, 0.7],
            TILE_MIN,
            TILE,
            CollisionShape::HalfTop,
        ));
    }

    #[test]
    fn half_bottom_is_the_mirror_of_half_top() {
        // Lower-half player collides; upper-half player passes through.
        assert!(player_overlaps_tile_solid(
            [0.25, 0.1],
            [0.75, 0.4],
            TILE_MIN,
            TILE,
            CollisionShape::HalfBottom,
        ));
        assert!(!player_overlaps_tile_solid(
            [0.25, 0.6],
            [0.75, 0.9],
            TILE_MIN,
            TILE,
            CollisionShape::HalfBottom,
        ));
    }

    #[test]
    fn full_collides_anywhere_inside_and_none_never_collides() {
        let lower = ([0.25, 0.1], [0.75, 0.4]);
        let upper = ([0.25, 0.6], [0.75, 0.9]);
        for (min, max) in [lower, upper] {
            assert!(player_overlaps_tile_solid(
                min,
                max,
                TILE_MIN,
                TILE,
                CollisionShape::Full,
            ));
            assert!(!player_overlaps_tile_solid(
                min,
                max,
                TILE_MIN,
                TILE,
                CollisionShape::None,
            ));
        }
    }

    #[test]
    fn a_player_outside_the_tile_never_collides() {
        assert!(!player_overlaps_tile_solid(
            [2.0, 2.0],
            [2.5, 2.5],
            TILE_MIN,
            TILE,
            CollisionShape::Full,
        ));
    }

    #[test]
    fn half_top_resolution_scales_with_tile_size() {
        // A 32px tile at world (100, 200): solid region is y in [216, 232].
        let tile_min = [100.0, 200.0];
        let size = 32.0;
        // Player near the top of the cell → collides.
        assert!(player_overlaps_tile_solid(
            [104.0, 220.0],
            [120.0, 228.0],
            tile_min,
            size,
            CollisionShape::HalfTop,
        ));
        // Player in the lower quarter (y in [204, 210]) → passes through.
        assert!(!player_overlaps_tile_solid(
            [104.0, 204.0],
            [120.0, 210.0],
            tile_min,
            size,
            CollisionShape::HalfTop,
        ));
    }

    #[test]
    fn slope_left_is_solid_below_its_falling_diagonal() {
        // SlopeLeft solid region: y <= 1 - x. Bottom-left corner is solid,
        // top-right corner is open.
        assert!(point_in_tile_solid(CollisionShape::SlopeLeft, 0.1, 0.1));
        assert!(!point_in_tile_solid(CollisionShape::SlopeLeft, 0.9, 0.9));
        // A player hugging the low-left corner overlaps the slope.
        assert!(player_overlaps_tile_solid(
            [0.0, 0.0],
            [0.3, 0.3],
            TILE_MIN,
            TILE,
            CollisionShape::SlopeLeft,
        ));
        // A player pinned to the open top-right corner does not.
        assert!(!player_overlaps_tile_solid(
            [0.85, 0.85],
            [1.0, 1.0],
            TILE_MIN,
            TILE,
            CollisionShape::SlopeLeft,
        ));
    }

    #[test]
    fn slope_right_mirrors_slope_left() {
        assert!(point_in_tile_solid(CollisionShape::SlopeRight, 0.9, 0.1));
        assert!(!point_in_tile_solid(CollisionShape::SlopeRight, 0.1, 0.9));
    }
}
