//! Post-processing settings for scene-wide visual effects.
//!
//! Provides PostProcessingSettings -- a serializable resource that syncs
//! to Bevy's camera components (Bloom, ChromaticAberration, ColorGrading,
//! ContrastAdaptiveSharpening) via a system in bridge/mod.rs.

use bevy::prelude::*;
use bevy::core_pipeline::bloom::{Bloom, BloomCompositeMode, BloomPrefilter};
use bevy::core_pipeline::contrast_adaptive_sharpening::ContrastAdaptiveSharpening;
use bevy::core_pipeline::post_process::ChromaticAberration;
use bevy::render::view::{ColorGrading, ColorGradingGlobal, ColorGradingSection};
use serde::{Serialize, Deserialize};

use super::camera::EditorCamera;

// SSAO import - WebGPU only
#[cfg(feature = "webgpu")]
use bevy::pbr::{ScreenSpaceAmbientOcclusion, ScreenSpaceAmbientOcclusionQualityLevel};

/// Serializable bloom configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BloomSettings {
    pub enabled: bool,
    pub intensity: f32,
    pub low_frequency_boost: f32,
    pub low_frequency_boost_curvature: f32,
    pub high_pass_frequency: f32,
    pub prefilter_threshold: f32,
    pub prefilter_threshold_softness: f32,
    pub composite_mode: BloomMode,
    pub max_mip_dimension: u32,
}

/// Mirror of Bevy's BloomCompositeMode.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BloomMode {
    EnergyConserving,
    Additive,
}

impl Default for BloomSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            intensity: 0.15,
            low_frequency_boost: 0.7,
            low_frequency_boost_curvature: 0.95,
            high_pass_frequency: 1.0,
            prefilter_threshold: 0.0,
            prefilter_threshold_softness: 0.0,
            composite_mode: BloomMode::EnergyConserving,
            max_mip_dimension: 512,
        }
    }
}

/// Serializable chromatic aberration configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaticAberrationSettings {
    pub enabled: bool,
    pub intensity: f32,
    pub max_samples: u32,
}

impl Default for ChromaticAberrationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            intensity: 0.02,
            max_samples: 8,
        }
    }
}

/// Serializable color grading - global section.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGradingGlobalSettings {
    pub exposure: f32,
    pub temperature: f32,
    pub tint: f32,
    pub hue: f32,
    pub post_saturation: f32,
}

impl Default for ColorGradingGlobalSettings {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            temperature: 0.0,
            tint: 0.0,
            hue: 0.0,
            post_saturation: 1.0,
        }
    }
}

/// Serializable color grading - per-range section (shadows/midtones/highlights).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGradingSectionSettings {
    pub saturation: f32,
    pub contrast: f32,
    pub gamma: f32,
    pub gain: f32,
    pub lift: f32,
}

impl Default for ColorGradingSectionSettings {
    fn default() -> Self {
        Self {
            saturation: 1.0,
            contrast: 1.0,
            gamma: 1.0,
            gain: 1.0,
            lift: 0.0,
        }
    }
}

/// Serializable color grading configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGradingSettings {
    pub enabled: bool,
    pub global: ColorGradingGlobalSettings,
    pub shadows: ColorGradingSectionSettings,
    pub midtones: ColorGradingSectionSettings,
    pub highlights: ColorGradingSectionSettings,
}

impl Default for ColorGradingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            global: ColorGradingGlobalSettings::default(),
            shadows: ColorGradingSectionSettings::default(),
            midtones: ColorGradingSectionSettings::default(),
            highlights: ColorGradingSectionSettings::default(),
        }
    }
}

/// Serializable contrast adaptive sharpening configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharpeningSettings {
    pub enabled: bool,
    pub sharpening_strength: f32,
    pub denoise: bool,
}

impl Default for SharpeningSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            sharpening_strength: 0.6,
            denoise: false,
        }
    }
}

/// Serializable SSAO configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsaoSettings {
    pub quality: String,  // "low", "medium", "high", "ultra"
}

impl Default for SsaoSettings {
    fn default() -> Self {
        Self {
            quality: "medium".to_string(),
        }
    }
}

/// Serializable depth of field configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthOfFieldSettings {
    pub mode: String,         // "gaussian" or "bokeh"
    pub focal_distance: f32,
    pub aperture_f_stops: f32,
    pub sensor_height: f32,
    pub max_circle_of_confusion_diameter: f32,
    pub max_depth: f32,
}

impl Default for DepthOfFieldSettings {
    fn default() -> Self {
        Self {
            mode: "gaussian".to_string(),
            focal_distance: 10.0,
            aperture_f_stops: 5.6,
            sensor_height: 0.024,
            max_circle_of_confusion_diameter: 0.1,
            max_depth: 100.0,
        }
    }
}

/// Serializable motion blur configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionBlurSettings {
    pub shutter_angle: f32,
    pub samples: u32,
}

impl Default for MotionBlurSettings {
    fn default() -> Self {
        Self {
            shutter_angle: 0.5,
            samples: 4,
        }
    }
}

/// Top-level post-processing resource that aggregates all effect settings.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostProcessingSettings {
    pub bloom: BloomSettings,
    pub chromatic_aberration: ChromaticAberrationSettings,
    pub color_grading: ColorGradingSettings,
    pub sharpening: SharpeningSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssao: Option<SsaoSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_of_field: Option<DepthOfFieldSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_blur: Option<MotionBlurSettings>,
}

impl Default for PostProcessingSettings {
    fn default() -> Self {
        Self {
            bloom: BloomSettings::default(),
            chromatic_aberration: ChromaticAberrationSettings::default(),
            color_grading: ColorGradingSettings::default(),
            sharpening: SharpeningSettings::default(),
            ssao: None,
            depth_of_field: None,
            motion_blur: None,
        }
    }
}

/// Plugin that registers the PostProcessingSettings resource
/// and the sync system.
pub struct PostProcessingPlugin;

impl Plugin for PostProcessingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PostProcessingSettings>()
            .add_systems(Update, sync_post_processing_settings);
    }
}

/// Watches PostProcessingSettings resource and syncs to Bevy components.
/// Only runs when settings change to avoid per-frame overhead.
fn sync_post_processing_settings(
    settings: Res<PostProcessingSettings>,
    camera_query: Query<Entity, With<EditorCamera>>,
    bloom_query: Query<Entity, (With<EditorCamera>, With<Bloom>)>,
    ca_query: Query<Entity, (With<EditorCamera>, With<ChromaticAberration>)>,
    cas_query: Query<Entity, (With<EditorCamera>, With<ContrastAdaptiveSharpening>)>,
    #[cfg(feature = "webgpu")]
    ssao_query: Query<Entity, (With<EditorCamera>, With<ScreenSpaceAmbientOcclusion>)>,
    mut color_grading_query: Query<&mut ColorGrading, With<EditorCamera>>,
    mut commands: Commands,
) {
    if !settings.is_changed() {
        return;
    }

    // Get camera entity (should exist)
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    // Handle Bloom
    if settings.bloom.enabled {
        let bloom_component = Bloom {
            intensity: settings.bloom.intensity,
            low_frequency_boost: settings.bloom.low_frequency_boost,
            low_frequency_boost_curvature: settings.bloom.low_frequency_boost_curvature,
            high_pass_frequency: settings.bloom.high_pass_frequency,
            prefilter: BloomPrefilter {
                threshold: settings.bloom.prefilter_threshold,
                threshold_softness: settings.bloom.prefilter_threshold_softness,
            },
            composite_mode: match settings.bloom.composite_mode {
                BloomMode::EnergyConserving => BloomCompositeMode::EnergyConserving,
                BloomMode::Additive => BloomCompositeMode::Additive,
            },
            max_mip_dimension: settings.bloom.max_mip_dimension,
            ..Default::default()
        };
        commands.entity(camera_entity).insert(bloom_component);
    } else if bloom_query.single().is_ok() {
        commands.entity(camera_entity).remove::<Bloom>();
    }

    // Handle ChromaticAberration
    if settings.chromatic_aberration.enabled {
        let ca_component = ChromaticAberration {
            intensity: settings.chromatic_aberration.intensity,
            max_samples: settings.chromatic_aberration.max_samples,
            ..Default::default()
        };
        commands.entity(camera_entity).insert(ca_component);
    } else if ca_query.single().is_ok() {
        commands.entity(camera_entity).remove::<ChromaticAberration>();
    }

    // Handle ContrastAdaptiveSharpening
    if settings.sharpening.enabled {
        let cas_component = ContrastAdaptiveSharpening {
            enabled: true,
            sharpening_strength: settings.sharpening.sharpening_strength,
            denoise: settings.sharpening.denoise,
        };
        commands.entity(camera_entity).insert(cas_component);
    } else if cas_query.single().is_ok() {
        commands.entity(camera_entity).remove::<ContrastAdaptiveSharpening>();
    }

    // Handle ColorGrading (modify in place, don't insert/remove)
    if let Ok(mut color_grading) = color_grading_query.single_mut() {
        if settings.color_grading.enabled {
            let global = ColorGradingGlobal {
                exposure: settings.color_grading.global.exposure,
                temperature: settings.color_grading.global.temperature,
                tint: settings.color_grading.global.tint,
                hue: settings.color_grading.global.hue,
                post_saturation: settings.color_grading.global.post_saturation,
                midtones_range: 0.2..0.7,
            };

            let shadows = ColorGradingSection {
                saturation: settings.color_grading.shadows.saturation,
                contrast: settings.color_grading.shadows.contrast,
                gamma: settings.color_grading.shadows.gamma,
                gain: settings.color_grading.shadows.gain,
                lift: settings.color_grading.shadows.lift,
            };

            let midtones = ColorGradingSection {
                saturation: settings.color_grading.midtones.saturation,
                contrast: settings.color_grading.midtones.contrast,
                gamma: settings.color_grading.midtones.gamma,
                gain: settings.color_grading.midtones.gain,
                lift: settings.color_grading.midtones.lift,
            };

            let highlights = ColorGradingSection {
                saturation: settings.color_grading.highlights.saturation,
                contrast: settings.color_grading.highlights.contrast,
                gamma: settings.color_grading.highlights.gamma,
                gain: settings.color_grading.highlights.gain,
                lift: settings.color_grading.highlights.lift,
            };

            *color_grading = ColorGrading {
                global,
                shadows,
                midtones,
                highlights,
            };
        } else {
            // Reset to default
            *color_grading = ColorGrading::default();
        }
    }

    // Handle SSAO (WebGPU only)
    #[cfg(feature = "webgpu")]
    {
        if let Some(ssao_settings) = &settings.ssao {
            let quality_level = match ssao_settings.quality.as_str() {
                "low" => ScreenSpaceAmbientOcclusionQualityLevel::Low,
                "medium" => ScreenSpaceAmbientOcclusionQualityLevel::Medium,
                "high" => ScreenSpaceAmbientOcclusionQualityLevel::High,
                "ultra" => ScreenSpaceAmbientOcclusionQualityLevel::Ultra,
                _ => ScreenSpaceAmbientOcclusionQualityLevel::Medium,
            };
            let ssao_component = ScreenSpaceAmbientOcclusion {
                quality_level,
                ..Default::default()
            };
            commands.entity(camera_entity).insert(ssao_component);
        } else if ssao_query.single().is_ok() {
            commands.entity(camera_entity).remove::<ScreenSpaceAmbientOcclusion>();
        }
    }

    // NOTE: Depth of Field and Motion Blur are not available in Bevy 0.16
    // The settings are stored but not applied to the camera.
    // Future Bevy versions may add these features.
    let _ = settings.depth_of_field;
    let _ = settings.motion_blur;
}
