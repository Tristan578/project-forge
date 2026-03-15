//! Sprite and 2D camera pending commands.

use super::PendingCommands;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct SetProjectTypeRequest {
    pub project_type: String,
}

#[derive(Debug, Clone)]
pub struct SpriteDataUpdate {
    pub entity_id: String,
    pub texture_asset_id: Option<Option<String>>,
    pub color_tint: Option<[f32; 4]>,
    pub flip_x: Option<bool>,
    pub flip_y: Option<bool>,
    pub custom_size: Option<Option<[f32; 2]>>,
    pub sorting_layer: Option<String>,
    pub sorting_order: Option<i32>,
    pub anchor: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpriteRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct Camera2dDataUpdate {
    pub zoom: Option<f32>,
    pub pixel_perfect: Option<bool>,
    pub bounds: Option<Option<Camera2dBounds>>,
}

#[derive(Debug, Clone)]
pub struct Camera2dBounds {
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

// === Sprite Animation Request Structs ===

#[derive(Debug, Clone)]
pub struct SpriteSheetUpdate {
    pub entity_id: String,
    pub sprite_sheet_data: crate::core::sprite::SpriteSheetData,
}

#[derive(Debug, Clone)]
pub struct SpriteSheetRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct SpriteAnimatorUpdate {
    pub entity_id: String,
    pub animator_data: crate::core::sprite::SpriteAnimatorData,
}

#[derive(Debug, Clone)]
pub struct SpriteAnimatorRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct AnimationStateMachineUpdate {
    pub entity_id: String,
    pub state_machine_data: crate::core::sprite::AnimationStateMachineData,
}

#[derive(Debug, Clone)]
pub struct AnimationStateMachineRemoval {
    pub entity_id: String,
}

// === Spawn Sprite Request ===

#[derive(Debug, Clone)]
pub struct SpawnSpriteRequest {
    pub name: Option<String>,
    pub texture_asset_id: Option<String>,
    pub position: Option<[f32; 3]>,
    pub sorting_layer: Option<String>,
    pub sorting_order: Option<i32>,
}

// === Sorting Layers Request ===

#[derive(Debug, Clone)]
pub struct SetSortingLayersRequest {
    pub layers: Vec<String>,
}

// === Tileset CRUD Request Structs ===

#[derive(Debug, Clone)]
pub struct SetTilesetRequest {
    pub entity_id: String,
    pub tileset_data: crate::core::tileset::TilesetData,
}

#[derive(Debug, Clone)]
pub struct RemoveTilesetRequest {
    pub entity_id: String,
}

// === Tilemap Request Structs ===

#[derive(Debug, Clone)]
pub struct TilemapDataUpdate {
    pub entity_id: String,
    pub tilemap_data: crate::core::tilemap::TilemapData,
}

#[derive(Debug, Clone)]
pub struct TilemapDataRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct PaintTileRequest {
    pub entity_id: String,
    pub layer: usize,
    pub x: usize,
    pub y: usize,
    pub tile_index: u32,
}

#[derive(Debug, Clone)]
pub struct EraseTileRequest {
    pub entity_id: String,
    pub layer: usize,
    pub x: usize,
    pub y: usize,
}

#[derive(Debug, Clone)]
pub struct TilePlacement {
    pub x: usize,
    pub y: usize,
    pub tile_index: u32,
}

#[derive(Debug, Clone)]
pub struct FillTilesRequest {
    pub entity_id: String,
    pub layer: usize,
    pub tiles: Vec<TilePlacement>,
}

// === Grid 2D Request Structs ===

#[derive(Debug, Clone)]
pub struct SetGrid2dRequest {
    pub visible: bool,
    pub cell_size: f32,
    pub color: [f32; 4],
}


// === Skeleton 2D Mesh Attachment Request Structs ===

#[derive(Debug, Clone)]
pub struct AddMeshAttachment2dRequest {
    pub entity_id: String,
    pub skin_name: String,
    pub attachment_name: String,
    pub vertices: Vec<[f32; 2]>,
    pub uvs: Vec<[f32; 2]>,
    pub triangles: Vec<u16>,
    pub weights: Vec<crate::core::skeleton2d::VertexWeights>,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_add_mesh_attachment2d(&mut self, request: AddMeshAttachment2dRequest) {
        self.add_mesh_attachment2d_requests.push(request);
    }

    pub fn queue_set_project_type(&mut self, request: SetProjectTypeRequest) {
        self.set_project_type_requests.push(request);
    }

    pub fn queue_sprite_data_update(&mut self, update: SpriteDataUpdate) {
        self.sprite_data_updates.push(update);
    }

    pub fn queue_sprite_removal(&mut self, removal: SpriteRemoval) {
        self.sprite_removals.push(removal);
    }

    pub fn queue_camera_2d_data_update(&mut self, update: Camera2dDataUpdate) {
        self.camera_2d_data_updates.push(update);
    }

    pub fn queue_sprite_sheet_update(&mut self, update: SpriteSheetUpdate) {
        self.sprite_sheet_updates.push(update);
    }

    pub fn queue_sprite_sheet_removal(&mut self, removal: SpriteSheetRemoval) {
        self.sprite_sheet_removals.push(removal);
    }

    pub fn queue_sprite_animator_update(&mut self, update: SpriteAnimatorUpdate) {
        self.sprite_animator_updates.push(update);
    }

    pub fn queue_sprite_animator_removal(&mut self, removal: SpriteAnimatorRemoval) {
        self.sprite_animator_removals.push(removal);
    }

    pub fn queue_animation_state_machine_update(&mut self, update: AnimationStateMachineUpdate) {
        self.animation_state_machine_updates.push(update);
    }

    pub fn queue_animation_state_machine_removal(&mut self, removal: AnimationStateMachineRemoval) {
        self.animation_state_machine_removals.push(removal);
    }

    pub fn queue_spawn_sprite(&mut self, request: SpawnSpriteRequest) {
        self.spawn_sprite_requests.push(request);
    }

    pub fn queue_set_sorting_layers(&mut self, request: SetSortingLayersRequest) {
        self.set_sorting_layers_requests.push(request);
    }

    pub fn queue_set_tileset(&mut self, request: SetTilesetRequest) {
        self.set_tileset_requests.push(request);
    }

    pub fn queue_remove_tileset(&mut self, request: RemoveTilesetRequest) {
        self.remove_tileset_requests.push(request);
    }

    pub fn queue_tilemap_data_update(&mut self, update: TilemapDataUpdate) {
        self.tilemap_data_updates.push(update);
    }

    pub fn queue_tilemap_data_removal(&mut self, removal: TilemapDataRemoval) {
        self.tilemap_data_removals.push(removal);
    }

    pub fn queue_paint_tile(&mut self, request: PaintTileRequest) {
        self.paint_tile_requests.push(request);
    }

    pub fn queue_erase_tile(&mut self, request: EraseTileRequest) {
        self.erase_tile_requests.push(request);
    }

    pub fn queue_fill_tiles(&mut self, request: FillTilesRequest) {
        self.fill_tiles_requests.push(request);
    }

    pub fn queue_set_grid_2d(&mut self, request: SetGrid2dRequest) {
        self.set_grid_2d_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_set_project_type_from_bridge(request: SetProjectTypeRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_project_type(request)).is_some()
}

pub fn queue_sprite_data_update_from_bridge(update: SpriteDataUpdate) -> bool {
    super::with_pending(|pc| pc.queue_sprite_data_update(update)).is_some()
}

pub fn queue_sprite_removal_from_bridge(removal: SpriteRemoval) -> bool {
    super::with_pending(|pc| pc.queue_sprite_removal(removal)).is_some()
}

pub fn queue_camera_2d_data_update_from_bridge(update: Camera2dDataUpdate) -> bool {
    super::with_pending(|pc| pc.queue_camera_2d_data_update(update)).is_some()
}

pub fn queue_sprite_sheet_update_from_bridge(update: SpriteSheetUpdate) -> bool {
    super::with_pending(|pc| pc.queue_sprite_sheet_update(update)).is_some()
}

pub fn queue_sprite_sheet_removal_from_bridge(removal: SpriteSheetRemoval) -> bool {
    super::with_pending(|pc| pc.queue_sprite_sheet_removal(removal)).is_some()
}

pub fn queue_sprite_animator_update_from_bridge(update: SpriteAnimatorUpdate) -> bool {
    super::with_pending(|pc| pc.queue_sprite_animator_update(update)).is_some()
}

pub fn queue_sprite_animator_removal_from_bridge(removal: SpriteAnimatorRemoval) -> bool {
    super::with_pending(|pc| pc.queue_sprite_animator_removal(removal)).is_some()
}

pub fn queue_animation_state_machine_update_from_bridge(update: AnimationStateMachineUpdate) -> bool {
    super::with_pending(|pc| pc.queue_animation_state_machine_update(update)).is_some()
}

pub fn queue_animation_state_machine_removal_from_bridge(removal: AnimationStateMachineRemoval) -> bool {
    super::with_pending(|pc| pc.queue_animation_state_machine_removal(removal)).is_some()
}

pub fn queue_spawn_sprite_from_bridge(request: SpawnSpriteRequest) -> bool {
    super::with_pending(|pc| pc.queue_spawn_sprite(request)).is_some()
}

pub fn queue_set_sorting_layers_from_bridge(request: SetSortingLayersRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_sorting_layers(request)).is_some()
}

pub fn queue_set_tileset_from_bridge(request: SetTilesetRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_tileset(request)).is_some()
}

pub fn queue_remove_tileset_from_bridge(request: RemoveTilesetRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_tileset(request)).is_some()
}

pub fn queue_tilemap_data_update_from_bridge(update: TilemapDataUpdate) -> bool {
    super::with_pending(|pc| pc.queue_tilemap_data_update(update)).is_some()
}

pub fn queue_tilemap_data_removal_from_bridge(removal: TilemapDataRemoval) -> bool {
    super::with_pending(|pc| pc.queue_tilemap_data_removal(removal)).is_some()
}

pub fn queue_add_mesh_attachment2d_from_bridge(request: AddMeshAttachment2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_add_mesh_attachment2d(request)).is_some()
}

pub fn queue_paint_tile_from_bridge(request: PaintTileRequest) -> bool {
    super::with_pending(|pc| pc.queue_paint_tile(request)).is_some()
}

pub fn queue_erase_tile_from_bridge(request: EraseTileRequest) -> bool {
    super::with_pending(|pc| pc.queue_erase_tile(request)).is_some()
}

pub fn queue_fill_tiles_from_bridge(request: FillTilesRequest) -> bool {
    super::with_pending(|pc| pc.queue_fill_tiles(request)).is_some()
}

pub fn queue_set_grid_2d_from_bridge(request: SetGrid2dRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_grid_2d(request)).is_some()
}
