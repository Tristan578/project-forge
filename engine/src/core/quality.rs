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

#[cfg(test)]
mod tests {
    use super::*;

    /// Every named preset builds settings tagged with that same preset, so the
    /// `preset` field the editor and scene file persist always matches the
    /// profile the rest of the struct describes.
    #[test]
    fn from_preset_tags_settings_with_its_own_preset() {
        for preset in [
            QualityPreset::Low,
            QualityPreset::Medium,
            QualityPreset::High,
            QualityPreset::Ultra,
        ] {
            assert_eq!(QualitySettings::from_preset(preset.clone()).preset, preset);
        }
    }

    /// The presets are genuinely distinct — a boundary-condition fixture that
    /// switches between them must observe different rendering parameters, not a
    /// relabelled identical struct.
    #[test]
    fn presets_differ_in_their_rendering_parameters() {
        let low = QualitySettings::from_preset(QualityPreset::Low);
        let ultra = QualitySettings::from_preset(QualityPreset::Ultra);
        assert_ne!(low.msaa_samples, ultra.msaa_samples);
        assert!(!low.shadows_enabled && ultra.shadows_enabled);
        assert_ne!(low.particle_density_scale, ultra.particle_density_scale);
    }

    /// Persistence integrity: settings survive a JSON serialize -> deserialize
    /// round-trip in every field. This is the path a preset takes through the
    /// scene file (`SceneFile.quality`), so a field that failed to round-trip
    /// would be silent authoring-data loss on reload.
    #[test]
    fn settings_round_trip_through_json() {
        for preset in [
            QualityPreset::Low,
            QualityPreset::Medium,
            QualityPreset::High,
            QualityPreset::Ultra,
        ] {
            let original = QualitySettings::from_preset(preset);
            let json = serde_json::to_string(&original).expect("serialize");
            let restored: QualitySettings = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(restored.preset, original.preset);
            assert_eq!(restored.msaa_samples, original.msaa_samples);
            assert_eq!(restored.shadows_enabled, original.shadows_enabled);
            assert_eq!(restored.shadows_directional_only, original.shadows_directional_only);
            assert_eq!(restored.bloom_enabled, original.bloom_enabled);
            assert_eq!(restored.chromatic_aberration_enabled, original.chromatic_aberration_enabled);
            assert_eq!(restored.sharpening_enabled, original.sharpening_enabled);
            assert_eq!(restored.particle_density_scale, original.particle_density_scale);
        }
    }

    #[test]
    fn parse_preset_accepts_known_names_and_rejects_others() {
        assert_eq!(QualitySettings::parse_preset("LOW"), Some(QualityPreset::Low));
        assert_eq!(QualitySettings::parse_preset("ultra"), Some(QualityPreset::Ultra));
        assert_eq!(QualitySettings::parse_preset("cinematic"), None);
    }
}
