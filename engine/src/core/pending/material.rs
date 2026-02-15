//! Material, texture, and lighting pending commands.

use super::PendingCommands;
use crate::core::lighting::LightData;
use crate::core::material::MaterialData;
use crate::core::post_processing::{
    BloomSettings, ChromaticAberrationSettings, ColorGradingSettings, DepthOfFieldSettings,
    MotionBlurSettings, SharpeningSettings, SsaoSettings,
};
use crate::core::shader_effects::ShaderEffectData;

// === Request Structs ===

#[derive(Debug, Clone)]
pub struct MaterialUpdate {
    pub entity_id: String,
    pub material_data: MaterialData,
}

#[derive(Debug, Clone)]
pub struct LightUpdate {
    pub entity_id: String,
    pub light_data: LightData,
}

#[derive(Debug, Clone)]
pub struct AmbientLightUpdate {
    pub color: Option<[f32; 3]>,
    pub brightness: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct EnvironmentUpdate {
    pub skybox_brightness: Option<f32>,
    pub ibl_intensity: Option<f32>,
    pub ibl_rotation_degrees: Option<f32>,
    pub clear_color: Option<[f32; 3]>,
    pub fog_enabled: Option<bool>,
    pub fog_color: Option<[f32; 3]>,
    pub fog_start: Option<f32>,
    pub fog_end: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct PostProcessingUpdate {
    pub bloom: Option<BloomSettings>,
    pub chromatic_aberration: Option<ChromaticAberrationSettings>,
    pub color_grading: Option<ColorGradingSettings>,
    pub sharpening: Option<SharpeningSettings>,
    pub ssao: Option<Option<SsaoSettings>>,
    pub depth_of_field: Option<Option<DepthOfFieldSettings>>,
    pub motion_blur: Option<Option<MotionBlurSettings>>,
}

#[derive(Debug, Clone)]
pub struct ShaderUpdate {
    pub entity_id: String,
    pub shader_data: ShaderEffectData,
}

#[derive(Debug, Clone)]
pub struct ShaderRemoval {
    pub entity_id: String,
}

#[derive(Debug, Clone)]
pub struct SetSkyboxRequest {
    pub preset: Option<String>,
    pub asset_id: Option<String>,
    pub brightness: Option<f32>,
    pub ibl_intensity: Option<f32>,
    pub rotation: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct RemoveSkyboxRequest;

#[derive(Debug, Clone)]
pub struct UpdateSkyboxRequest {
    pub brightness: Option<f32>,
    pub ibl_intensity: Option<f32>,
    pub rotation: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct SetCustomSkyboxRequest {
    pub asset_id: String,
    pub data_base64: String,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_material_update(&mut self, update: MaterialUpdate) {
        self.material_updates.push(update);
    }

    pub fn queue_light_update(&mut self, update: LightUpdate) {
        self.light_updates.push(update);
    }

    pub fn queue_ambient_light_update(&mut self, update: AmbientLightUpdate) {
        self.ambient_light_updates.push(update);
    }

    pub fn queue_environment_update(&mut self, update: EnvironmentUpdate) {
        self.environment_updates.push(update);
    }

    pub fn queue_post_processing_update(&mut self, update: PostProcessingUpdate) {
        self.post_processing_updates.push(update);
    }

    pub fn queue_shader_update(&mut self, update: ShaderUpdate) {
        self.shader_updates.push(update);
    }

    pub fn queue_shader_removal(&mut self, removal: ShaderRemoval) {
        self.shader_removals.push(removal);
    }

    pub fn queue_set_skybox(&mut self, request: SetSkyboxRequest) {
        self.set_skybox_requests.push(request);
    }

    pub fn queue_remove_skybox(&mut self, request: RemoveSkyboxRequest) {
        self.remove_skybox_requests.push(request);
    }

    pub fn queue_update_skybox(&mut self, request: UpdateSkyboxRequest) {
        self.update_skybox_requests.push(request);
    }

    pub fn queue_custom_skybox(&mut self, request: SetCustomSkyboxRequest) {
        self.custom_skybox_requests.push(request);
    }
}

// === Bridge Functions ===

pub fn queue_material_update_from_bridge(update: MaterialUpdate) -> bool {
    super::with_pending(|pc| pc.queue_material_update(update)).is_some()
}

pub fn queue_light_update_from_bridge(update: LightUpdate) -> bool {
    super::with_pending(|pc| pc.queue_light_update(update)).is_some()
}

pub fn queue_ambient_light_update_from_bridge(update: AmbientLightUpdate) -> bool {
    super::with_pending(|pc| pc.queue_ambient_light_update(update)).is_some()
}

pub fn queue_environment_update_from_bridge(update: EnvironmentUpdate) -> bool {
    super::with_pending(|pc| pc.queue_environment_update(update)).is_some()
}

pub fn queue_post_processing_update_from_bridge(update: PostProcessingUpdate) -> bool {
    super::with_pending(|pc| pc.queue_post_processing_update(update)).is_some()
}

pub fn queue_shader_update_from_bridge(update: ShaderUpdate) -> bool {
    super::with_pending(|pc| pc.queue_shader_update(update)).is_some()
}

pub fn queue_shader_removal_from_bridge(removal: ShaderRemoval) -> bool {
    super::with_pending(|pc| pc.queue_shader_removal(removal)).is_some()
}

pub fn queue_set_skybox_from_bridge(request: SetSkyboxRequest) -> bool {
    super::with_pending(|pc| pc.queue_set_skybox(request)).is_some()
}

pub fn queue_remove_skybox_from_bridge() -> bool {
    super::with_pending(|pc| pc.queue_remove_skybox(RemoveSkyboxRequest)).is_some()
}

pub fn queue_update_skybox_from_bridge(request: UpdateSkyboxRequest) -> bool {
    super::with_pending(|pc| pc.queue_update_skybox(request)).is_some()
}

pub fn queue_custom_skybox_from_bridge(request: SetCustomSkyboxRequest) -> bool {
    super::with_pending(|pc| pc.queue_custom_skybox(request)).is_some()
}
