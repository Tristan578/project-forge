//! Scene file serialization for save/load.
//!
//! Defines the `.forge` JSON scene format and provides helper functions.
//! The actual ECS queries live in bridge systems — this module is pure data.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::asset_manager::AssetMetadata;
use super::audio::AudioBusConfig;
use super::custom_wgsl::CustomWgslSource;
use super::environment::EnvironmentSettings;
use super::history::EntitySnapshot;
use super::input::InputMap;
use super::post_processing::PostProcessingSettings;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/// Top-level scene file container.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFile {
    pub format_version: u32,
    pub metadata: SceneMetadata,
    pub environment: EnvironmentSettings,
    pub ambient_light: AmbientLightData,
    pub input_bindings: InputMap,
    #[serde(default)]
    pub assets: HashMap<String, AssetMetadata>,
    #[serde(default)]
    pub post_processing: PostProcessingSettings,
    #[serde(default)]
    pub audio_buses: AudioBusConfig,
    pub entities: Vec<EntitySnapshot>,
    #[serde(default)]
    pub game_ui: Option<String>,
    /// Scene-global custom WGSL shader source (optional, preserved across save/load).
    #[serde(default)]
    pub custom_wgsl_source: Option<CustomWgslSource>,
}

/// Scene metadata (name, timestamps).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneMetadata {
    pub name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub modified_at: String,
}

/// Serializable representation of Bevy's AmbientLight.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbientLightData {
    pub color: [f32; 3],
    pub brightness: f32,
}

impl Default for AmbientLightData {
    fn default() -> Self {
        Self {
            color: [1.0, 1.0, 1.0],
            brightness: 300.0,
        }
    }
}

// ---------------------------------------------------------------------------
// Resource: scene name stored in Bevy world
// ---------------------------------------------------------------------------

/// Resource holding the current scene name.
#[derive(Resource, Debug, Clone)]
pub struct SceneName(pub String);

impl Default for SceneName {
    fn default() -> Self {
        Self("Untitled".to_string())
    }
}

// ---------------------------------------------------------------------------
// Build helper
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_scene_file() -> SceneFile {
        SceneFile {
            format_version: 3,
            metadata: SceneMetadata {
                name: "TestScene".to_string(),
                created_at: "2026-01-01".to_string(),
                modified_at: "2026-01-02".to_string(),
            },
            environment: crate::core::environment::EnvironmentSettings::default(),
            ambient_light: AmbientLightData::default(),
            input_bindings: crate::core::input::InputMap::default(),
            assets: HashMap::new(),
            post_processing: crate::core::post_processing::PostProcessingSettings::default(),
            audio_buses: crate::core::audio::AudioBusConfig::default(),
            entities: Vec::new(),
            game_ui: None,
            custom_wgsl_source: None,
        }
    }

    #[test]
    fn scene_file_serialize_deserialize_round_trip() {
        let original = minimal_scene_file();
        let json = serde_json::to_string(&original).expect("serialization failed");
        let restored: SceneFile = serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(restored.format_version, 3);
        assert_eq!(restored.metadata.name, "TestScene");
        assert!(restored.entities.is_empty());
        assert!(restored.game_ui.is_none());
    }

    #[test]
    fn scene_file_round_trip_preserves_entities_empty() {
        let original = minimal_scene_file();
        let json = serde_json::to_string(&original).unwrap();
        let restored: SceneFile = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.entities.len(), 0);
        assert_eq!(restored.format_version, original.format_version);
    }

    #[test]
    fn scene_file_round_trip_preserves_game_ui() {
        let mut scene = minimal_scene_file();
        scene.game_ui = Some("<div>test</div>".to_string());
        let json = serde_json::to_string(&scene).unwrap();
        let restored: SceneFile = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.game_ui, Some("<div>test</div>".to_string()));
    }

    #[test]
    fn scene_file_game_ui_none_round_trips() {
        let scene = minimal_scene_file();
        assert!(scene.game_ui.is_none());
        let json = serde_json::to_string(&scene).unwrap();
        let restored: SceneFile = serde_json::from_str(&json).unwrap();
        assert!(restored.game_ui.is_none());
    }

    #[test]
    fn ambient_light_data_default_is_white_bright() {
        let light = AmbientLightData::default();
        assert_eq!(light.color, [1.0, 1.0, 1.0]);
        assert!(light.brightness > 0.0);
    }

    #[test]
    fn scene_name_resource_default_is_untitled() {
        let name = SceneName::default();
        assert_eq!(name.0, "Untitled");
    }
}

/// Build a `SceneFile` from pre-collected data.
pub fn build_scene_file(
    scene_name: &str,
    env: &EnvironmentSettings,
    ambient: &GlobalAmbientLight,
    input_map: &InputMap,
    assets: HashMap<String, AssetMetadata>,
    post_processing: &PostProcessingSettings,
    audio_buses: &AudioBusConfig,
    entities: Vec<EntitySnapshot>,
    game_ui: Option<String>,
    custom_wgsl_source: Option<CustomWgslSource>,
) -> SceneFile {
    SceneFile {
        format_version: 3,
        metadata: SceneMetadata {
            name: scene_name.to_string(),
            created_at: String::new(),
            modified_at: String::new(),
        },
        environment: env.clone(),
        ambient_light: AmbientLightData {
            color: [
                ambient.color.to_linear().red,
                ambient.color.to_linear().green,
                ambient.color.to_linear().blue,
            ],
            brightness: ambient.brightness,
        },
        input_bindings: input_map.clone(),
        assets,
        post_processing: post_processing.clone(),
        audio_buses: audio_buses.clone(),
        entities,
        game_ui,
        custom_wgsl_source,
    }
}
