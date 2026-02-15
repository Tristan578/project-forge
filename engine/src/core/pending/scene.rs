//! Scene, asset, and prefab pending commands.

use serde::{Deserialize, Serialize};
use super::PendingCommands;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct GltfImportRequest {
    pub data_base64: String,
    pub name: String,
    pub position: Option<bevy::math::Vec3>,
}

#[derive(Debug, Clone)]
pub struct TextureLoadRequest {
    pub data_base64: String,
    pub name: String,
    pub entity_id: String,
    pub slot: String,
}

#[derive(Debug, Clone)]
pub struct PlaceAssetRequest {
    pub asset_id: String,
    pub position: Option<bevy::math::Vec3>,
}

#[derive(Debug, Clone)]
pub struct DeleteAssetRequest {
    pub asset_id: String,
}

#[derive(Debug, Clone)]
pub struct RemoveTextureRequest {
    pub entity_id: String,
    pub slot: String,
}

#[derive(Debug, Clone)]
pub struct SceneExportRequest;

#[derive(Debug, Clone)]
pub struct SceneLoadRequest {
    pub json: String,
}

#[derive(Debug, Clone)]
pub struct NewSceneRequest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstantiatePrefabRequest {
    pub snapshot_json: String,
    pub position: Option<[f32; 3]>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct QualityPresetRequest {
    pub preset: String,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_scene_export(&mut self) {
        self.scene_export_requests.push(SceneExportRequest);
    }

    pub fn queue_scene_load(&mut self, request: SceneLoadRequest) {
        self.scene_load_requests.push(request);
    }

    pub fn queue_new_scene(&mut self) {
        self.new_scene_requests.push(NewSceneRequest);
    }

    pub fn queue_gltf_import(&mut self, request: GltfImportRequest) {
        self.gltf_import_requests.push(request);
    }

    pub fn queue_texture_load(&mut self, request: TextureLoadRequest) {
        self.texture_load_requests.push(request);
    }

    pub fn queue_place_asset(&mut self, request: PlaceAssetRequest) {
        self.place_asset_requests.push(request);
    }

    pub fn queue_delete_asset(&mut self, request: DeleteAssetRequest) {
        self.delete_asset_requests.push(request);
    }

    pub fn queue_remove_texture(&mut self, request: RemoveTextureRequest) {
        self.remove_texture_requests.push(request);
    }

    pub fn queue_quality_preset(&mut self, request: QualityPresetRequest) {
        self.quality_preset_requests.push(request);
    }

    pub fn queue_instantiate_prefab(&mut self, request: InstantiatePrefabRequest) {
        self.instantiate_prefab_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_scene_export_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_scene_export()).is_some()
}

pub fn queue_scene_load_from_bridge(request: SceneLoadRequest) -> bool {
    super::with_pending(|pc| pc.queue_scene_load(request)).is_some()
}

pub fn queue_new_scene_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_new_scene()).is_some()
}

pub fn queue_gltf_import_from_bridge(request: GltfImportRequest) -> bool {
    super::with_pending(|pc| pc.queue_gltf_import(request)).is_some()
}

pub fn queue_texture_load_from_bridge(request: TextureLoadRequest) -> bool {
    super::with_pending(|pc| pc.queue_texture_load(request)).is_some()
}

pub fn queue_place_asset_from_bridge(request: PlaceAssetRequest) -> bool {
    super::with_pending(|pc| pc.queue_place_asset(request)).is_some()
}

pub fn queue_delete_asset_from_bridge(request: DeleteAssetRequest) -> bool {
    super::with_pending(|pc| pc.queue_delete_asset(request)).is_some()
}

pub fn queue_remove_texture_from_bridge(request: RemoveTextureRequest) -> bool {
    super::with_pending(|pc| pc.queue_remove_texture(request)).is_some()
}

pub fn queue_quality_preset_from_bridge(request: QualityPresetRequest) -> bool {
    super::with_pending(|pc| pc.queue_quality_preset(request)).is_some()
}

pub fn queue_instantiate_prefab_from_bridge(request: InstantiatePrefabRequest) -> bool {
    super::with_pending(|pc| pc.queue_instantiate_prefab(request)).is_some()
}
