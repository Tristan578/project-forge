//! Quality presets system for batch-configuring rendering parameters.
//!
//! Provides QualitySettings resource with Low/Medium/High/Ultra presets
//! that control MSAA, shadows, post-processing, and particle density.

use bevy::prelude::*;
use serde::{Serialize, Deserialize};

/// Quality preset levels.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QualityPreset {
    Low,
    Medium,
    High,
    Ultra,
    Custom,
}

impl Default for QualityPreset {
    fn default() -> Self {
        QualityPreset::High
    }
}

/// Global rendering quality settings.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualitySettings {
    pub preset: QualityPreset,
    pub msaa_samples: u8,
    pub shadows_enabled: bool,
    pub shadows_directional_only: bool,
    pub bloom_enabled: bool,
    pub chromatic_aberration_enabled: bool,
    pub sharpening_enabled: bool,
    pub particle_density_scale: f32,
}

impl Default for QualitySettings {
    fn default() -> Self {
        Self::from_preset(QualityPreset::High)
    }
}

impl QualitySettings {
    /// Create settings from a preset.
    pub fn from_preset(preset: QualityPreset) -> Self {
        match preset {
            QualityPreset::Low => Self {
                preset: QualityPreset::Low,
                msaa_samples: 1,
                shadows_enabled: false,
                shadows_directional_only: false,
                bloom_enabled: false,
                chromatic_aberration_enabled: false,
                sharpening_enabled: false,
                particle_density_scale: 0.25,
            },
            QualityPreset::Medium => Self {
                preset: QualityPreset::Medium,
                msaa_samples: 2,
                shadows_enabled: true,
                shadows_directional_only: true,
                bloom_enabled: true,
                chromatic_aberration_enabled: false,
                sharpening_enabled: false,
                particle_density_scale: 0.5,
            },
            QualityPreset::High => Self {
                preset: QualityPreset::High,
                msaa_samples: 4,
                shadows_enabled: true,
                shadows_directional_only: false,
                bloom_enabled: true,
                chromatic_aberration_enabled: true,
                sharpening_enabled: true,
                particle_density_scale: 1.0,
            },
            QualityPreset::Ultra => Self {
                preset: QualityPreset::Ultra,
                msaa_samples: 4,
                shadows_enabled: true,
                shadows_directional_only: false,
                bloom_enabled: true,
                chromatic_aberration_enabled: true,
                sharpening_enabled: true,
                particle_density_scale: 1.5,
            },
            QualityPreset::Custom => Self::default(),
        }
    }

    /// Parse preset name from string.
    pub fn parse_preset(name: &str) -> Option<QualityPreset> {
        match name.to_lowercase().as_str() {
            "low" => Some(QualityPreset::Low),
            "medium" => Some(QualityPreset::Medium),
            "high" => Some(QualityPreset::High),
            "ultra" => Some(QualityPreset::Ultra),
            _ => None,
        }
    }
}
