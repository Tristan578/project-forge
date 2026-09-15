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

/// Maximum serialized scene size accepted by both preflight and load.
pub const MAX_SCENE_JSON_BYTES: usize = 50 * 1024 * 1024;
/// Bound hierarchy validation and scene construction to the editor load limit.
pub const MAX_SCENE_ENTITIES: usize = 10_000;

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
    /// The scene's action vocabulary.
    ///
    /// OMITTING IT MEANS "USE THE DEFAULTS", NOT "NO INPUT". Without
    /// `#[serde(default)]` a file had to state a complete `InputMap` or fail to
    /// load at all, which pushed every producer into writing
    /// `{ actions: {}, preset: null }` — a scene in which no key does anything —
    /// purely to satisfy the parser. `InputMap::default()` is a working
    /// keyboard, so a file that says nothing about input now gets one, and a
    /// file that declares actions gets exactly those.
    #[serde(default)]
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

/// Parse and validate a scene before any editor state is changed.
///
/// Both the synchronous preflight command and the queued loader use this
/// function, so accepting a checkpoint cannot depend on a weaker JSON schema.
pub fn parse_scene_file(json: &str) -> Result<SceneFile, String> {
    if json.len() > MAX_SCENE_JSON_BYTES {
        return Err("Scene JSON exceeds the 50 MiB limit".to_string());
    }
    let scene: SceneFile =
        serde_json::from_str(json).map_err(|error| format!("Invalid scene file: {error}"))?;
    if !(1..=3).contains(&scene.format_version) {
        return Err(format!(
            "Unsupported scene format version: {}",
            scene.format_version
        ));
    }
    if scene.entities.len() > MAX_SCENE_ENTITIES {
        return Err(format!(
            "Scene exceeds the {MAX_SCENE_ENTITIES} entity limit"
        ));
    }
    let mut indices = HashMap::with_capacity(scene.entities.len());
    for (index, entity) in scene.entities.iter().enumerate() {
        if entity.entity_id.trim().is_empty()
            || indices.insert(entity.entity_id.as_str(), index).is_some()
        {
            return Err("Scene entity ids must be nonempty and unique".to_string());
        }
        if !entity
            .transform
            .position
            .iter()
            .chain(&entity.transform.rotation)
            .chain(&entity.transform.scale)
            .all(|value| value.is_finite())
        {
            return Err("Scene transforms must contain finite numbers".to_string());
        }
    }
    // Each entity has at most one parent. Three-state traversal visits each
    // edge once, without recursive calls or quadratic ancestor walks.
    let mut states = vec![0u8; scene.entities.len()];
    for start in 0..scene.entities.len() {
        let mut cursor = Some(start);
        let mut path = Vec::new();
        while let Some(index) = cursor {
            match states[index] {
                2 => break,
                1 => return Err("Scene hierarchy contains a cycle".to_string()),
                _ => {}
            }
            states[index] = 1;
            path.push(index);
            cursor = match scene.entities[index].parent_id.as_deref() {
                None => None,
                Some(parent) => Some(
                    *indices
                        .get(parent)
                        .ok_or("Scene hierarchy references a missing parent")?,
                ),
            };
        }
        for index in path {
            states[index] = 2;
        }
    }
    Ok(scene)
}

#[cfg(test)]
pub(crate) fn test_scene_json() -> String {
    serde_json::to_string(&build_scene_file(
        "Recovery",
        &EnvironmentSettings::default(),
        &GlobalAmbientLight::default(),
        &InputMap::default(),
        HashMap::new(),
        &PostProcessingSettings::default(),
        &AudioBusConfig::default(),
        Vec::new(),
        None,
        None,
    ))
    .unwrap()
}

#[cfg(test)]
mod validation_tests {
    use super::*;
    use crate::core::history::TransformSnapshot;
    use crate::core::pending_commands::EntityType;

    fn entity(id: &str, parent: Option<&str>) -> EntitySnapshot {
        let mut snapshot = EntitySnapshot::new(
            id.into(),
            EntityType::Cube,
            id.into(),
            TransformSnapshot {
                position: [0.0; 3],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0; 3],
            },
        );
        snapshot.parent_id = parent.map(str::to_string);
        snapshot
    }

    fn parse_entities(entities: Vec<EntitySnapshot>) -> Result<SceneFile, String> {
        let mut scene = parse_scene_file(&test_scene_json()).unwrap();
        scene.entities = entities;
        parse_scene_file(&serde_json::to_string(&scene).unwrap())
    }

    #[test]
    fn accepts_exported_scene_and_supported_versions() {
        for version in 1..=3 {
            let mut value: serde_json::Value = serde_json::from_str(&test_scene_json()).unwrap();
            value["formatVersion"] = version.into();
            assert!(parse_scene_file(&value.to_string()).is_ok());
        }
        assert!(parse_entities(vec![entity("child", Some("root")), entity("root", None)]).is_ok());
    }

    #[test]
    fn rejects_invalid_shape_versions_and_limits() {
        for json in ["{}", "[]", "null", r#"{"entities":[]}"#] {
            assert!(parse_scene_file(json).is_err());
        }
        for version in [0, 4] {
            let mut value: serde_json::Value = serde_json::from_str(&test_scene_json()).unwrap();
            value["formatVersion"] = version.into();
            assert!(parse_scene_file(&value.to_string())
                .unwrap_err()
                .contains("version"));
        }
        assert!(parse_scene_file(&" ".repeat(MAX_SCENE_JSON_BYTES + 1))
            .unwrap_err()
            .contains("limit"));
        let entities = (0..=MAX_SCENE_ENTITIES)
            .map(|index| entity(&index.to_string(), None))
            .collect();
        assert!(parse_entities(entities)
            .unwrap_err()
            .contains("entity limit"));
    }

    #[test]
    fn rejects_ambiguous_or_cyclic_hierarchies() {
        for entities in [
            vec![entity(" ", None)],
            vec![entity("same", None), entity("same", None)],
            vec![entity("child", Some("missing"))],
            vec![entity("self", Some("self"))],
            vec![entity("a", Some("b")), entity("b", Some("a"))],
        ] {
            assert!(parse_entities(entities).is_err());
        }
    }

    #[test]
    fn rejects_transform_float_overflow() {
        let mut scene = parse_entities(vec![entity("root", None)]).unwrap();
        scene.entities[0].transform.position[0] = 1.0;
        let mut value = serde_json::to_value(scene).unwrap();
        value["entities"][0]["transform"]["position"][0] = serde_json::json!(1e100);
        assert!(parse_scene_file(&value.to_string()).is_err());
    }

    #[test]
    fn accepts_a_deep_hierarchy_without_recursion() {
        let entities = (0..MAX_SCENE_ENTITIES)
            .map(|index| {
                let parent = (index > 0).then(|| (index - 1).to_string());
                entity(&index.to_string(), parent.as_deref())
            })
            .collect();
        assert!(parse_entities(entities).is_ok());
    }
}
