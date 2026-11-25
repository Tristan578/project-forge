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

/// Field-level deserializer for [`MaterialData::attenuation_distance`] (#10267).
///
/// `default_attenuation_distance()` above is `f32::INFINITY`. JSON has no
/// infinity literal, and serde_json's derived `Serialize` writes `null` for
/// EVERY non-finite float — while `#[serde(default = ...)]` only substitutes
/// a *missing* key, never an explicit `null`. So the derived `Deserialize`
/// rejected every scene carrying a default (untouched) material with
/// `invalid type: null, expected f32`, and nothing mapped the default back.
///
/// What it reads:
/// - `null` → `f32::INFINITY`: the on-disk spelling of the default, both
///   before and after this fix. The wire format is deliberately UNCHANGED.
///   A rolled-back engine (or a lagging CDN prefix) still refuses a
///   default-material scene, exactly as it always refused its own output;
///   nothing written here makes that worse, and nothing here fixes it there.
/// - a finite, non-negative JSON number, integer- or float-formatted (`5`
///   and `5.0` are different `serde_json` number variants; both must work),
///   kept as written.
/// - any OTHER number — negative, or non-finite once narrowed to `f32` (e.g.
///   `1e300`) — loads as the default, `f32::INFINITY`, with a warning. This
///   is TOLERANT on purpose: before #10267 the derived `f32` deserializer
///   loaded these verbatim and `update_material` stored them unchecked, so
///   scenes carrying them exist. Refusing them here would lock a creator out
///   of a scene that opened yesterday. The default is the one value whose
///   meaning ("no attenuation") is well defined; a negative distance has none.
///
/// Anything that is not a number or `null` is still refused, as it always
/// was. No string sentinel (`"Infinity"`, `"-Infinity"`, `"NaN"`) is
/// recognised: scene JSON crosses the remix / published-play trust boundary,
/// nothing produces those spellings, and accepting them would only widen the
/// input domain.
///
/// `Serialize` stays derived on purpose. `null` remains the encoding of
/// `+Infinity`, which is also what the live `MATERIAL_CHANGED` /
/// `QUERY_ENTITY_DETAILS` events emit and what the web side contracts as
/// `attenuationDistance: number | null` — this attribute changes only what
/// the struct ACCEPTS, never what it emits.
///
/// The live `update_material` command stays STRICT about numbers (it refuses
/// anything [`is_valid_attenuation_distance`] refuses), so nothing written
/// from now on is a value this function would have to replace on reload.
fn deserialize_attenuation_distance<'de, D>(deserializer: D) -> Result<f32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match Option::<f32>::deserialize(deserializer)? {
        None => f32::INFINITY,
        Some(value) => attenuation_distance_on_load(value),
    })
}

/// The loader's reading of an explicit `attenuationDistance` number: the value
/// itself when [`is_valid_attenuation_distance`] accepts it, otherwise the
/// default `f32::INFINITY`, with a warning naming the replaced value.
fn attenuation_distance_on_load(value: f32) -> f32 {
    if is_valid_attenuation_distance(value) {
        return value;
    }
    tracing::warn!(
        "Scene material attenuationDistance {} is not a finite number >= 0; loading it as infinity (no attenuation)",
        value
    );
    f32::INFINITY
}

/// The ONE definition of an explicit `attenuation_distance` NUMBER the engine
/// keeps as written: finite and non-negative. The default, `f32::INFINITY`
/// ("no attenuation"), is never spelled as a number — it is `null` in a scene
/// file and `null` on `update_material` — so a value that narrows to `inf`
/// (JSON `1e300`, a JS `Infinity`) fails here too.
///
/// Shared by both boundaries (#10267), which differ only in what they do with
/// a failure: `update_material` refuses it (nothing new gets written), and the
/// scene loader replaces it with the default (nothing already saved is locked
/// out) — see [`attenuation_distance_on_load`].
pub(crate) fn is_valid_attenuation_distance(value: f32) -> bool {
    value.is_finite() && value >= 0.0
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
    // Defaults to `f32::INFINITY`, which the derived `Serialize` writes as
    // `null`. `default = ...` covers a MISSING key; `deserialize_with` is what
    // reads that `null` back as infinity, keeps a finite non-negative number,
    // and loads any other number as infinity with a warning — see
    // `deserialize_attenuation_distance` (#10267). Serialize is left derived so
    // the on-disk `.forge` shape and the live `MATERIAL_CHANGED` /
    // `QUERY_ENTITY_DETAILS` contract (`number | null`) are unchanged.
    #[serde(
        default = "default_attenuation_distance",
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
        if let Some(mut material) = materials.get_mut(handle) {
            apply_material_data_to_standard(&mut material, data, &texture_handles);
        }
    }
}

// ---------------------------------------------------------------------------
// #10267: `attenuation_distance` defaults to `f32::INFINITY`, which the
// derived Serialize writes as `null`; `deserialize_attenuation_distance` is
// what reads it back. These tests drive `MaterialData`'s real
// Serialize/Deserialize on JSON TEXT (never a pre-built `Value`), so an
// integer literal is a genuine `5` on the wire. The scene-level round trip
// through `build_scene_file` / `parse_scene_file` lives in `scene_file.rs`.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod attenuation_distance_serde_tests {
    use super::*;

    const NULL_FIELD: &str = "\"attenuationDistance\":null";

    /// The default material's own JSON, with the `attenuationDistance` value
    /// swapped for `literal` — asserting the swap actually happened, so a
    /// renamed key cannot turn every test below into a missing-key test.
    fn default_material_json_with(literal: &str) -> String {
        let json = serde_json::to_string(&MaterialData::default()).expect("serialize default");
        assert_eq!(
            json.matches(NULL_FIELD).count(),
            1,
            "the default material must serialize attenuationDistance as null exactly once: {json}"
        );
        json.replace(NULL_FIELD, &format!("\"attenuationDistance\":{literal}"))
    }

    fn attenuation_from(json: &str) -> Result<f32, serde_json::Error> {
        serde_json::from_str::<MaterialData>(json).map(|m| m.attenuation_distance)
    }

    // --- Wire format: Serialize is derived, `null` is the default's spelling ---

    #[test]
    fn default_material_serializes_attenuation_distance_as_null() {
        // Pinned on purpose: `null` is what every scene saved before #10267
        // holds and what the live MATERIAL_CHANGED / QUERY_ENTITY_DETAILS
        // contract (`number | null`) expects. (A rolled-back engine still
        // refuses it, as it always refused its own output.) Re-attaching a
        // `serialize_with` would turn this red.
        let json = serde_json::to_string(&MaterialData::default()).expect("serialize default");
        assert!(json.contains(NULL_FIELD), "{json}");
    }

    #[test]
    fn default_material_round_trips_through_its_own_json() {
        let json = serde_json::to_string(&MaterialData::default()).expect("serialize default");
        assert_eq!(
            attenuation_from(&json).expect("default must load"),
            f32::INFINITY
        );
    }

    // --- Accepted inputs ---

    #[test]
    fn explicit_null_deserializes_as_infinity() {
        assert_eq!(
            attenuation_from(&default_material_json_with("null")).unwrap(),
            f32::INFINITY
        );
    }

    #[test]
    fn missing_key_deserializes_as_infinity() {
        // `#[serde(default = ...)]` still owns the missing-key case.
        let json = serde_json::to_string(&MaterialData::default())
            .expect("serialize default")
            .replace(&format!(",{NULL_FIELD}"), "");
        assert!(!json.contains("attenuationDistance"), "{json}");
        assert_eq!(attenuation_from(&json).unwrap(), f32::INFINITY);
    }

    #[test]
    fn integer_literal_deserializes() {
        // A hand-written or minified scene writes `5`, which serde_json
        // parses as an integer, not a float; the deserializer must take both.
        assert_eq!(
            attenuation_from(&default_material_json_with("5")).unwrap(),
            5.0
        );
    }

    #[test]
    fn float_literal_deserializes() {
        assert_eq!(
            attenuation_from(&default_material_json_with("4.5")).unwrap(),
            4.5
        );
    }

    #[test]
    fn zero_is_accepted() {
        assert_eq!(
            attenuation_from(&default_material_json_with("0")).unwrap(),
            0.0
        );
    }

    // --- Tolerated on load: a number the live command refuses loads as the default ---
    //
    // Before #10267 the derived `f32` deserializer loaded these verbatim and
    // `update_material` stored them unchecked, so saved scenes can carry them.
    // Refusing them would lock a creator out of a scene that used to open.

    #[test]
    fn negative_number_loads_as_infinity() {
        for literal in ["-1", "-0.5"] {
            assert_eq!(
                attenuation_from(&default_material_json_with(literal)).unwrap_or_else(|e| panic!(
                    "attenuationDistance {literal} must still load: {e}"
                )),
                f32::INFINITY,
                "{literal}"
            );
        }
    }

    #[test]
    fn number_that_overflows_f32_loads_as_infinity() {
        // `1e300` is a legal JSON number and a legal f64, but narrows to
        // `+inf` as f32. It loads as the default rather than locking the
        // scene out; the live command still refuses it (commands/material.rs).
        assert_eq!(
            attenuation_from(&default_material_json_with("1e300")).unwrap(),
            f32::INFINITY
        );
    }

    #[test]
    fn load_reading_keeps_valid_numbers_and_replaces_the_rest() {
        // The predicate split, pinned directly: what the live command accepts
        // is kept as written, what it refuses becomes the default.
        for value in [0.0_f32, 4.5, 10.0, f32::MAX] {
            assert!(is_valid_attenuation_distance(value), "{value}");
            assert_eq!(attenuation_distance_on_load(value), value);
        }
        for value in [
            -1.0_f32,
            -0.0001,
            f32::NEG_INFINITY,
            f32::INFINITY,
            f32::NAN,
        ] {
            assert!(!is_valid_attenuation_distance(value), "{value}");
            assert_eq!(
                attenuation_distance_on_load(value),
                f32::INFINITY,
                "{value}"
            );
        }
    }

    // --- Still refused: anything that is not a number or null ---

    #[test]
    fn string_sentinels_are_rejected() {
        // Nothing writes these, and scene JSON crosses the remix /
        // published-play trust boundary — no domain widening. The derived
        // `f32` deserializer refused them before #10267 too.
        for literal in ["\"Infinity\"", "\"-Infinity\"", "\"NaN\"", "\"10\""] {
            let error = attenuation_from(&default_material_json_with(literal))
                .expect_err(&format!("attenuationDistance {literal} must be rejected"));
            assert!(error.to_string().contains("invalid type"), "{error}");
        }
    }

    #[test]
    fn non_numeric_values_are_rejected() {
        for literal in ["true", "[1]", "{}"] {
            attenuation_from(&default_material_json_with(literal))
                .expect_err(&format!("attenuationDistance {literal} must be rejected"));
        }
    }
}
