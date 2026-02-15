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

// === Queue Methods ===

impl PendingCommands {
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
