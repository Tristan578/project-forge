//! Material system for per-entity PBR material editing.
//!
//! Provides `MaterialData` — a serializable subset of Bevy's `StandardMaterial`
//! that can be edited via the bridge and synced back to the actual GPU material.

use bevy::prelude::*;
use serde::{Serialize, Deserialize};

/// Serializable material properties for bridge communication.
/// This is the user-editable subset of StandardMaterial.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialData {
    // --- Core PBR ---
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub perceptual_roughness: f32,
    pub reflectance: f32,

    // --- Emissive ---
    pub emissive: [f32; 4],
    pub emissive_exposure_weight: f32,

    // --- Alpha ---
    pub alpha_mode: MaterialAlphaMode,
    pub alpha_cutoff: f32,

    // --- Rendering ---
    pub double_sided: bool,
    pub unlit: bool,

    // --- Texture references (asset IDs, None = no texture) ---
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_color_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal_map_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metallic_roughness_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emissive_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occlusion_texture: Option<String>,
}

/// Alpha blending mode (serializable mirror of Bevy's AlphaMode).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MaterialAlphaMode {
    Opaque,
    Blend,
    Mask,
}

impl Default for MaterialData {
    fn default() -> Self {
        Self {
            base_color: [0.5, 0.5, 0.5, 1.0],
            metallic: 0.0,
            perceptual_roughness: 0.5,
            reflectance: 0.5,
            emissive: [0.0, 0.0, 0.0, 1.0],
            emissive_exposure_weight: 0.0,
            alpha_mode: MaterialAlphaMode::Opaque,
            alpha_cutoff: 0.5,
            double_sided: false,
            unlit: false,
            base_color_texture: None,
            normal_map_texture: None,
            metallic_roughness_texture: None,
            emissive_texture: None,
            occlusion_texture: None,
        }
    }
}

/// Plugin that registers the material sync system.
pub struct MaterialPlugin;

impl Plugin for MaterialPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, sync_material_data);
    }
}

/// System that applies MaterialData changes to the actual StandardMaterial asset.
fn sync_material_data(
    query: Query<(&MaterialData, &MeshMaterial3d<StandardMaterial>), Changed<MaterialData>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    for (data, handle) in query.iter() {
        if let Some(material) = materials.get_mut(handle) {
            material.base_color = Color::linear_rgba(
                data.base_color[0],
                data.base_color[1],
                data.base_color[2],
                data.base_color[3],
            );
            material.metallic = data.metallic;
            material.perceptual_roughness = data.perceptual_roughness;
            material.reflectance = data.reflectance;
            material.emissive = LinearRgba::new(
                data.emissive[0],
                data.emissive[1],
                data.emissive[2],
                data.emissive[3],
            );
            material.emissive_exposure_weight = data.emissive_exposure_weight;
            material.double_sided = data.double_sided;
            material.unlit = data.unlit;
            material.alpha_mode = match data.alpha_mode {
                MaterialAlphaMode::Opaque => AlphaMode::Opaque,
                MaterialAlphaMode::Blend => AlphaMode::Blend,
                MaterialAlphaMode::Mask => AlphaMode::Mask(data.alpha_cutoff),
            };
        }
    }
}
