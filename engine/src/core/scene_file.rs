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

/// Save/load round trip for a keyframe animation clip (PF-935 / #8887).
///
/// The Bevy 0.19 readiness audit flagged animation as the one save/load path
/// with no coverage, because 0.19 changed how `AnimationTargetId` is computed
/// and "serialized data containing `AnimationTargetId` values" must be
/// recalculated. A `.forge` scene carries none: `AnimationClipData` addresses
/// its channels by our own `PropertyTarget` enum, and glTF skeletal clips are
/// rebuilt from the re-imported asset on every load. What CAN silently lose a
/// clip is this module's serde shape plus `spawn_from_snapshot`, so the test
/// drives the real load path (the call `bridge::scene_io` makes, with the same
/// `ResyncReport::Silent`) and then plays the restored clip.
#[cfg(test)]
mod animation_round_trip_tests {
    use super::*;
    use crate::core::animation_clip::{
        AnimationClipData, Interpolation, PlayMode, PropertyTarget,
    };
    use crate::core::component_resync::ResyncReport;
    use crate::core::entity_factory::spawn_from_snapshot;
    use crate::core::entity_id::EntityId;
    use crate::core::history::TransformSnapshot;
    use crate::core::material::MaterialData;
    use crate::core::pending_commands::EntityType;

    /// Every field is set OFF its `Default` so a restore that inserted a blank
    /// `AnimationClipData::default()` cannot satisfy the equality below.
    fn authored_clip() -> AnimationClipData {
        let mut clip = AnimationClipData::default();
        clip.add_keyframe(PropertyTarget::PositionY, 0.0, 0.0, Interpolation::Linear)
            .unwrap();
        clip.add_keyframe(PropertyTarget::PositionY, 1.0, 10.0, Interpolation::Linear)
            .unwrap();
        clip.add_keyframe(PropertyTarget::MaterialMetallic, 0.0, 0.2, Interpolation::EaseIn)
            .unwrap();
        clip.add_keyframe(PropertyTarget::MaterialMetallic, 2.0, 0.8, Interpolation::Step)
            .unwrap();
        clip.duration = 3.0;
        clip.play_mode = PlayMode::PingPong;
        clip.speed = 1.5;
        clip.autoplay = false;
        clip
    }

    fn save_and_load(clip: &AnimationClipData) -> AnimationClipData {
        let mut snapshot = EntitySnapshot::new(
            "animated".into(),
            EntityType::Cube,
            "Animated".into(),
            TransformSnapshot {
                position: [0.0; 3],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0; 3],
            },
        );
        // No `material_data`: a default `MaterialData` carries
        // `attenuation_distance: f32::INFINITY`, which serde_json writes as `null`
        // and then refuses to read back — a separate, pre-existing save/load
        // defect reported alongside #8887, not something this test is about.
        snapshot.animation_clip_data = Some(clip.clone());

        // Save: the same builder and serializer the export path uses.
        let json = serde_json::to_string(&build_scene_file(
            "Animated",
            &EnvironmentSettings::default(),
            &GlobalAmbientLight::default(),
            &InputMap::default(),
            HashMap::new(),
            &PostProcessingSettings::default(),
            &AudioBusConfig::default(),
            vec![snapshot],
            None,
            None,
        ))
        .unwrap();

        // Load: parse, then rebuild the entity exactly as `bridge::scene_io` does.
        let scene = parse_scene_file(&json).unwrap();
        assert_eq!(scene.entities.len(), 1);
        let loaded = scene.entities[0].clone();
        let mut world = World::new();
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        let mut schedule = Schedule::default();
        schedule.add_systems(
            move |mut commands: Commands,
                  mut meshes: ResMut<Assets<Mesh>>,
                  mut materials: ResMut<Assets<StandardMaterial>>| {
                spawn_from_snapshot(
                    &mut commands,
                    &mut meshes,
                    &mut materials,
                    &loaded,
                    ResyncReport::Silent,
                );
            },
        );
        schedule.run(&mut world);

        let mut restored = world.query::<(&EntityId, &AnimationClipData)>();
        let hits: Vec<_> = restored
            .iter(&world)
            .map(|(id, clip)| (id.0.clone(), clip.clone()))
            .collect();
        assert_eq!(
            hits.len(),
            1,
            "exactly one entity must come back carrying the clip, got {}",
            hits.len()
        );
        assert_eq!(hits[0].0, "animated");
        hits[0].1.clone()
    }

    #[test]
    fn a_saved_clip_is_restored_field_for_field() {
        let authored = authored_clip();
        let restored = save_and_load(&authored);

        // Full-shape comparison through the DERIVED `Debug`: `AnimationClipData`
        // has no `PartialEq`, a hand-written field list would stop covering the
        // next field added, and comparing two serde encodings would be blind to
        // exactly the defect under test — a field serde drops is dropped from
        // both sides of that comparison alike (verified by mutation).
        assert_eq!(format!("{restored:?}"), format!("{authored:?}"));
        // Non-vacuity: the fixture must actually carry tracks and keyframes, or
        // the equality above would hold for two empty clips.
        assert_eq!(restored.tracks.len(), 2);
        assert_eq!(
            restored.tracks.iter().map(|t| t.keyframes.len()).sum::<usize>(),
            4
        );
        assert_eq!(restored.play_mode, PlayMode::PingPong);
    }

    #[test]
    fn a_restored_clip_plays_back_identically_to_the_authored_one() {
        let mut authored = authored_clip();
        let mut restored = save_and_load(&authored);

        for clip in [&mut authored, &mut restored] {
            clip.preview("play", None).unwrap();
            assert!(clip.playing, "preview(\"play\") must start playback");
        }

        // Step both clips through the same frames, including a PingPong bounce
        // off the 3s end, and compare what each writes into the entity.
        let mut sampled_any_motion = false;
        for frame in 0..40 {
            authored.advance(0.1);
            restored.advance(0.1);
            assert_eq!(restored.current_time, authored.current_time, "frame {frame}");

            let (mut t_a, mut t_r) = (Transform::default(), Transform::default());
            let (mut m_a, mut m_r) = (MaterialData::default(), MaterialData::default());
            authored.sample(&mut t_a, Some(&mut m_a), None);
            restored.sample(&mut t_r, Some(&mut m_r), None);
            assert_eq!(t_r.translation, t_a.translation, "frame {frame}");
            assert_eq!(m_r.metallic, m_a.metallic, "frame {frame}");
            sampled_any_motion |= t_r.translation.y > 0.0;
        }
        // Non-vacuity: the channel must actually have moved, or two frozen
        // clips would compare equal on every frame.
        assert!(sampled_any_motion, "the restored clip never animated position.y");

        // One absolute value, so "both halves agree" cannot mean "both are
        // wrong the same way": 0.5s at speed 1.5 is 0.75s, i.e. y = 7.5.
        let mut probe = save_and_load(&authored_clip());
        probe.preview("play", None).unwrap();
        probe.advance(0.5);
        let mut transform = Transform::default();
        probe.sample(&mut transform, None, None);
        assert!((transform.translation.y - 7.5).abs() < 1e-5, "{}", transform.translation.y);
    }
}
