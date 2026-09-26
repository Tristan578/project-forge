//! Material system for per-entity PBR material editing.
//!
//! Provides `MaterialData` — a serializable subset of Bevy's `StandardMaterial`
//! that can be edited via the bridge and synced back to the actual GPU material.

use bevy::prelude::*;
use bevy::math::{Affine2, Mat2, Vec2};
use serde::{Serialize, Deserialize};

use crate::core::asset_manager::TextureHandleMap;

// --- Default helper functions for serde ---
fn default_uv_offset() -> [f32; 2] { [0.0, 0.0] }
fn default_uv_scale() -> [f32; 2] { [1.0, 1.0] }
fn default_parallax_depth_scale() -> f32 { 0.1 }
fn default_parallax_max_layers() -> f32 { 16.0 }
fn default_parallax_relief_steps() -> u32 { 5 }
fn default_clearcoat_roughness() -> f32 { 0.5 }
fn default_ior() -> f32 { 1.5 }
fn default_attenuation_distance() -> f32 { f32::INFINITY }
fn default_attenuation_color() -> [f32; 3] { [1.0, 1.0, 1.0] }

// --- (de)serialization for `attenuation_distance` (#10267) ---
//
// `default_attenuation_distance()` above is `f32::INFINITY`, and JSON has no
// infinity literal. serde_json's default float serialization silently maps
// any non-finite f32/f64 to `null`, so a plain `#[serde(default = ...)]`
// field wrote `"attenuationDistance": null` for every untouched material and
// had no way to read it back: `#[serde(default = ...)]` only substitutes a
// *missing* key, never an explicit `null`, so `parse_scene_file` rejected it
// with "invalid type: null, expected f32". A saved scene where any entity
// carried a default material therefore failed to load.
//
// The fix serializes non-finite values as explicit, self-documenting string
// sentinels ("Infinity" / "-Infinity" / "NaN") instead of `null`, and the
// deserializer accepts those sentinels, plain finite numbers, AND `null`
// (every scene saved before this fix used exactly that shape) — `null` maps
// to `f32::INFINITY`, since infinity was the only non-finite value this
// field was ever assigned before the fix.
fn serialize_attenuation_distance<S>(value: &f32, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if value.is_finite() {
        serializer.serialize_f32(*value)
    } else if *value == f32::INFINITY {
        serializer.serialize_str("Infinity")
    } else if *value == f32::NEG_INFINITY {
        serializer.serialize_str("-Infinity")
    } else {
        // NaN: not physically meaningful for a distance, but keep the round
        // trip lossless rather than silently coercing it to a number.
        serializer.serialize_str("NaN")
    }
}

fn deserialize_attenuation_distance<'de, D>(deserializer: D) -> Result<f32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct AttenuationDistanceVisitor;

    impl<'de> serde::de::Visitor<'de> for AttenuationDistanceVisitor {
        type Value = f32;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str(
                "a finite number, one of the sentinel strings \"Infinity\"/\"-Infinity\"/\"NaN\", or null",
            )
        }

        fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value as f32)
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value as f32)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value as f32)
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            match value {
                "Infinity" => Ok(f32::INFINITY),
                "-Infinity" => Ok(f32::NEG_INFINITY),
                "NaN" => Ok(f32::NAN),
                other => Err(E::custom(format!(
                    "invalid attenuationDistance string: {other:?} (expected \"Infinity\", \"-Infinity\", or \"NaN\")"
                ))),
            }
        }

        // JSON `null` — the pre-fix serialization of `f32::INFINITY`. Every
        // scene saved before this fix uses exactly this shape, so it must
        // keep loading.
        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(f32::INFINITY)
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(f32::INFINITY)
        }
    }

    deserializer.deserialize_any(AttenuationDistanceVisitor)
}

/// Serializable parallax mapping method (mirror of Bevy's `ParallaxMappingMethod`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ParallaxMethod {
    Occlusion,
    Relief,
}

impl Default for ParallaxMethod {
    fn default() -> Self {
        Self::Occlusion
    }
}

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

    // --- UV Transform (E-1a) ---
    #[serde(default = "default_uv_offset")]
    pub uv_offset: [f32; 2],
    #[serde(default = "default_uv_scale")]
    pub uv_scale: [f32; 2],
    #[serde(default)]
    pub uv_rotation: f32,

    // --- Parallax Mapping (E-1b) ---
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_map_texture: Option<String>,
    #[serde(default = "default_parallax_depth_scale")]
    pub parallax_depth_scale: f32,
    #[serde(default)]
    pub parallax_mapping_method: ParallaxMethod,
    #[serde(default = "default_parallax_max_layers")]
    pub max_parallax_layer_count: f32,
    #[serde(default = "default_parallax_relief_steps")]
    pub parallax_relief_max_steps: u32,

    // --- Clearcoat (E-1c) ---
    #[serde(default)]
    pub clearcoat: f32,
    #[serde(default = "default_clearcoat_roughness")]
    pub clearcoat_perceptual_roughness: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearcoat_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearcoat_roughness_texture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearcoat_normal_texture: Option<String>,

    // --- Transmission (E-1d) ---
    #[serde(default)]
    pub specular_transmission: f32,
    #[serde(default)]
    pub diffuse_transmission: f32,
    #[serde(default = "default_ior")]
    pub ior: f32,
    #[serde(default)]
    pub thickness: f32,
    #[serde(
        default = "default_attenuation_distance",
        serialize_with = "serialize_attenuation_distance",
        deserialize_with = "deserialize_attenuation_distance"
    )]
    pub attenuation_distance: f32,
    #[serde(default = "default_attenuation_color")]
    pub attenuation_color: [f32; 3],
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
            // UV Transform defaults (identity)
            uv_offset: default_uv_offset(),
            uv_scale: default_uv_scale(),
            uv_rotation: 0.0,
            // Parallax defaults
            depth_map_texture: None,
            parallax_depth_scale: default_parallax_depth_scale(),
            parallax_mapping_method: ParallaxMethod::default(),
            max_parallax_layer_count: default_parallax_max_layers(),
            parallax_relief_max_steps: default_parallax_relief_steps(),
            // Clearcoat defaults (disabled)
            clearcoat: 0.0,
            clearcoat_perceptual_roughness: default_clearcoat_roughness(),
            clearcoat_texture: None,
            clearcoat_roughness_texture: None,
            clearcoat_normal_texture: None,
            // Transmission defaults (opaque)
            specular_transmission: 0.0,
            diffuse_transmission: 0.0,
            ior: default_ior(),
            thickness: 0.0,
            attenuation_distance: default_attenuation_distance(),
            attenuation_color: default_attenuation_color(),
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

/// Helper function to apply MaterialData fields to a StandardMaterial.
/// Extracted so it can be used by both sync_material_data and sync_extended_material_data.
pub fn apply_material_data_to_standard(
    material: &mut StandardMaterial,
    data: &MaterialData,
    texture_handles: &TextureHandleMap,
) {
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

    // Apply texture handles from the texture handle map
    material.base_color_texture = data.base_color_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();
    material.normal_map_texture = data.normal_map_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();
    material.metallic_roughness_texture = data.metallic_roughness_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();
    material.emissive_texture = data.emissive_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();
    material.occlusion_texture = data.occlusion_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();

    // --- UV Transform (E-1a) ---
    let rotation_mat = Mat2::from_angle(data.uv_rotation);
    let scale_mat = Mat2::from_diagonal(Vec2::new(data.uv_scale[0], data.uv_scale[1]));
    material.uv_transform = Affine2 {
        matrix2: rotation_mat * scale_mat,
        translation: Vec2::new(data.uv_offset[0], data.uv_offset[1]),
    };

    // --- Parallax Mapping (E-1b) ---
    material.parallax_depth_scale = data.parallax_depth_scale;
    material.max_parallax_layer_count = data.max_parallax_layer_count;
    material.parallax_mapping_method = match data.parallax_mapping_method {
        ParallaxMethod::Occlusion => bevy::pbr::ParallaxMappingMethod::Occlusion,
        ParallaxMethod::Relief => bevy::pbr::ParallaxMappingMethod::Relief {
            max_steps: data.parallax_relief_max_steps,
        },
    };
    material.depth_map = data.depth_map_texture.as_ref()
        .and_then(|id| texture_handles.0.get(id))
        .cloned();

    // --- Clearcoat (E-1c) ---
    material.clearcoat = data.clearcoat;
    material.clearcoat_perceptual_roughness = data.clearcoat_perceptual_roughness;
    // Note: Bevy 0.16 StandardMaterial does not expose clearcoat texture fields.
    // The texture asset IDs are stored in MaterialData for future compatibility.

    // --- Transmission (E-1d) ---
    material.specular_transmission = data.specular_transmission;
    material.diffuse_transmission = data.diffuse_transmission;
    material.ior = data.ior;
    material.thickness = data.thickness;
    material.attenuation_distance = data.attenuation_distance;
    material.attenuation_color = Color::linear_rgb(
        data.attenuation_color[0],
        data.attenuation_color[1],
        data.attenuation_color[2],
    );
}

/// System that applies MaterialData changes to the actual StandardMaterial asset.
fn sync_material_data(
    query: Query<(&MaterialData, &MeshMaterial3d<StandardMaterial>), Changed<MaterialData>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    texture_handles: Res<TextureHandleMap>,
) {
    for (data, handle) in query.iter() {
        if let Some(material) = materials.get_mut(handle) {
            apply_material_data_to_standard(material, data, &texture_handles);
        }
    }
}

// ---------------------------------------------------------------------------
// #10267: attenuation_distance defaults to f32::INFINITY, JSON has no
// infinity, and serde_json's default float serialization silently writes
// `null` for any non-finite f32/f64. Without a reverse mapping, a scene with
// an untouched (default) material fails `parse_scene_file` with
// "invalid type: null, expected f32" — `#[serde(default = ...)]` only covers
// a *missing* key, never an explicit `null`. These tests pin both directions.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod attenuation_distance_tests {
    use super::*;

    #[test]
    fn default_material_round_trips_through_json() {
        let original = MaterialData::default();
        let json = serde_json::to_string(&original).expect("serialize default material");
        let restored: MaterialData =
            serde_json::from_str(&json).expect("a default material must load");
        assert_eq!(restored.attenuation_distance, f32::INFINITY);
    }

    #[test]
    fn infinity_serializes_to_a_json_safe_sentinel_not_null() {
        let value = serde_json::to_value(&MaterialData::default())
            .expect("serialize default material to a Value");
        assert_eq!(
            value["attenuationDistance"],
            serde_json::json!("Infinity"),
            "attenuationDistance must not silently become JSON null"
        );
    }

    #[test]
    fn explicit_null_attenuation_distance_loads_as_infinity() {
        // The exact shape of every scene saved before this fix: serde_json
        // wrote `null` for `f32::INFINITY` and nothing mapped it back.
        let mut value = serde_json::to_value(&MaterialData::default())
            .expect("serialize default material to a Value");
        value["attenuationDistance"] = serde_json::Value::Null;
        let restored: MaterialData =
            serde_json::from_value(value).expect("a legacy null attenuationDistance must load");
        assert_eq!(restored.attenuation_distance, f32::INFINITY);
    }

    #[test]
    fn finite_attenuation_distance_round_trips_unchanged() {
        let mut original = MaterialData::default();
        original.attenuation_distance = 4.5;
        let json = serde_json::to_string(&original).expect("serialize material");
        let restored: MaterialData =
            serde_json::from_str(&json).expect("a finite attenuationDistance must load");
        assert_eq!(restored.attenuation_distance, 4.5);
    }

    #[test]
    fn missing_attenuation_distance_key_defaults_to_infinity() {
        // Scenes saved before the field existed at all.
        let mut value = serde_json::to_value(&MaterialData::default())
            .expect("serialize default material to a Value");
        value
            .as_object_mut()
            .expect("material is a JSON object")
            .remove("attenuationDistance");
        let restored: MaterialData =
            serde_json::from_value(value).expect("a missing attenuationDistance key must load");
        assert_eq!(restored.attenuation_distance, f32::INFINITY);
    }
}
