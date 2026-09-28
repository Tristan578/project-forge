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
    // One typed parse, straight from text. `materialData.attenuationDistance`
    // arrives as `null` for every default material (serde_json writes `null`
    // for `f32::INFINITY`); the field-level deserializer on
    // `MaterialData::attenuation_distance` maps it back (#10267), so no
    // `Value` rewrite is needed here — and a rewrite would widen every f32 to
    // its f64 digits and re-sort keys on the way out.
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

    // #10267: `MaterialData::default()` sets `attenuation_distance` to
    // `f32::INFINITY`, which serde_json serializes as `null`. A scene
    // carrying an entity with a default, unmodified material must still
    // save-and-load, end to end through `build_scene_file` /
    // `serde_json::to_string` / `parse_scene_file` — the same derived
    // serializer the bridge export path uses, with the field-level
    // deserializer on `MaterialData::attenuation_distance` doing the work.
    mod attenuation_distance_scene_round_trip {
        use super::*;
        use crate::core::material::MaterialData;

        const NULL_FIELD: &str = "\"attenuationDistance\":null";

        fn scene_with_material(material: MaterialData) -> SceneFile {
            let mut snapshot = entity("root", None);
            snapshot.material_data = Some(material);
            build_scene_file(
                "Recovery",
                &EnvironmentSettings::default(),
                &GlobalAmbientLight::default(),
                &InputMap::default(),
                HashMap::new(),
                &PostProcessingSettings::default(),
                &AudioBusConfig::default(),
                vec![snapshot],
                None,
                None,
            )
        }

        /// The scene's own JSON text, with the single-entity
        /// `attenuationDistance` value swapped for `literal` — asserting the
        /// swap happened, so a renamed key cannot silently turn a test into a
        /// missing-key test.
        fn default_scene_json_with(literal: &str) -> String {
            let json = serde_json::to_string(&scene_with_material(MaterialData::default()))
                .expect("serialize scene");
            assert_eq!(json.matches(NULL_FIELD).count(), 1, "{json}");
            json.replace(NULL_FIELD, &format!("\"attenuationDistance\":{literal}"))
        }

        fn attenuation_of(parsed: &SceneFile, index: usize) -> f32 {
            parsed.entities[index]
                .material_data
                .as_ref()
                .expect("material_data must survive the round trip")
                .attenuation_distance
        }

        fn round_trip(material: MaterialData) -> f32 {
            let json = serde_json::to_string(&scene_with_material(material))
                .expect("serialize scene with a material");
            let parsed = parse_scene_file(&json).expect("a scene with this material must load");
            attenuation_of(&parsed, 0)
        }

        #[test]
        fn default_infinity_material_round_trips() {
            assert_eq!(round_trip(MaterialData::default()), f32::INFINITY);
        }

        #[test]
        fn finite_fractional_value_round_trips() {
            let mut material = MaterialData::default();
            material.attenuation_distance = 4.5;
            assert_eq!(round_trip(material), 4.5);
        }

        #[test]
        fn finite_integer_literal_in_scene_json_loads() {
            // A hand-written or minified scene spells the value `5`, which
            // serde_json parses as an integer — a different `Number` variant
            // from the `5.0` the engine itself would write. Fed as TEXT, not
            // via a Rust `5.0` that would serialize back to a float.
            let json = default_scene_json_with("5");
            assert!(
                json.contains("\"attenuationDistance\":5,")
                    || json.ends_with("\"attenuationDistance\":5}"),
                "{json}"
            );
            let parsed = parse_scene_file(&json).expect("an integer literal must load");
            assert_eq!(attenuation_of(&parsed, 0), 5.0);
        }

        #[test]
        fn legacy_null_attenuation_distance_loads_as_infinity() {
            // The exact shape every scene saved before #10267 held — and,
            // since the wire format is unchanged, every scene saved after it
            // too. Spelled explicitly rather than relying on the serializer
            // so this test keeps meaning `null` even if Serialize changes.
            let json = default_scene_json_with("null");
            let parsed =
                parse_scene_file(&json).expect("a legacy null attenuationDistance must still load");
            assert_eq!(attenuation_of(&parsed, 0), f32::INFINITY);
        }

        #[test]
        fn missing_attenuation_distance_key_defaults_to_infinity() {
            // Scenes saved before the field existed at all.
            let scene_file = scene_with_material(MaterialData::default());
            let mut value = serde_json::to_value(&scene_file).expect("serialize scene to a Value");
            value["entities"][0]["materialData"]
                .as_object_mut()
                .unwrap()
                .remove("attenuationDistance");
            let parsed = parse_scene_file(&value.to_string())
                .expect("a missing attenuationDistance key must still load");
            assert_eq!(attenuation_of(&parsed, 0), f32::INFINITY);
        }

        #[test]
        fn negative_attenuation_distance_is_rejected() {
            // Consistent with "Scene transforms must contain finite numbers":
            // a scene is refused up front, with the field named, rather than
            // loaded with a value the renderer cannot mean anything by.
            let error = parse_scene_file(&default_scene_json_with("-1"))
                .expect_err("a negative attenuationDistance must be rejected");
            assert!(error.starts_with("Invalid scene file:"), "{error}");
            assert!(error.contains("attenuationDistance"), "{error}");
        }

        #[test]
        fn non_finite_and_string_spellings_are_rejected() {
            // `null` is the ONLY spelling of infinity. `1e300` is finite as
            // f64 but `+inf` as f32; the string sentinels are never produced
            // and scene JSON crosses the remix / published-play trust
            // boundary, so none of them may load.
            for literal in ["1e300", "\"Infinity\"", "\"-Infinity\"", "\"NaN\""] {
                parse_scene_file(&default_scene_json_with(literal))
                    .expect_err(&format!("attenuationDistance {literal} must be rejected"));
            }
        }

        // --- Byte-for-byte pins on the scene TEXT ---
        //
        // The export path is `serde_json::to_string(&scene_file)` and nothing
        // else. A `Value` round trip in between would widen every f32 to its
        // f64 digits (`0.35` → `0.3499999940395355`) and re-sort keys, which
        // is a silent change to every saved scene. These tests pin the text.

        fn pinned_scene(attenuation_distance: f32) -> SceneFile {
            let mut snapshot = entity("root", None);
            snapshot.transform.position = [0.1, 0.35, 0.7];
            let mut material = MaterialData::default();
            material.metallic = 0.35;
            material.attenuation_distance = attenuation_distance;
            snapshot.material_data = Some(material);
            build_scene_file(
                "Recovery",
                &EnvironmentSettings::default(),
                &GlobalAmbientLight::default(),
                &InputMap::default(),
                HashMap::new(),
                &PostProcessingSettings::default(),
                &AudioBusConfig::default(),
                vec![snapshot],
                None,
                None,
            )
        }

        /// The scene text from `"entities":` to the end. `inputBindings.actions`
        /// is a `HashMap`, so two serializations of the SAME scene can order
        /// that section differently — nothing in the format promises map
        /// order, and it is not what this pin is about. The entity section is
        /// a `Vec` of derived structs and is byte-stable.
        fn entities_tail(json: &str) -> &str {
            let start = json
                .find("\"entities\":")
                .expect("scene text must carry entities");
            &json[start..]
        }

        #[test]
        fn finite_material_scene_text_keeps_f32_digits_and_round_trips_byte_for_byte() {
            let scene = pinned_scene(4.5);
            let json = serde_json::to_string(&scene).expect("serialize scene");
            assert!(json.contains("\"metallic\":0.35,"), "{json}");
            assert!(json.contains("\"position\":[0.1,0.35,0.7]"), "{json}");
            assert!(json.contains("\"attenuationDistance\":4.5"), "{json}");
            assert!(
                !json.contains("0.3499999940395355"),
                "f64-widened digits leaked: {json}"
            );

            let parsed = parse_scene_file(&json).expect("the pinned scene must load");
            assert_eq!(attenuation_of(&parsed, 0), 4.5);
            let reserialized = serde_json::to_string(&parsed).expect("re-serialize");
            assert_eq!(
                entities_tail(&reserialized),
                entities_tail(&json),
                "load → save must be byte-identical for the entity section"
            );
        }

        #[test]
        fn default_material_scene_text_writes_null_and_round_trips_byte_for_byte() {
            let scene = pinned_scene(f32::INFINITY);
            let json = serde_json::to_string(&scene).expect("serialize scene");
            assert!(json.contains(NULL_FIELD), "{json}");
            assert!(json.contains("\"metallic\":0.35,"), "{json}");
            assert!(
                !json.contains("Infinity"),
                "no string sentinel on the wire: {json}"
            );

            let parsed = parse_scene_file(&json).expect("the default material must load");
            assert_eq!(attenuation_of(&parsed, 0), f32::INFINITY);
            let reserialized = serde_json::to_string(&parsed).expect("re-serialize");
            assert_eq!(
                entities_tail(&reserialized),
                entities_tail(&json),
                "load → save must be byte-identical for the entity section"
            );
        }

        #[test]
        fn bridge_scene_export_serializes_with_the_derived_serializer() {
            // `bridge/` is wasm32-only and cannot be unit-tested natively, so
            // the export call site is pinned textually: exactly one
            // EXECUTABLE (non-comment) line hands `scene_file` to
            // `serde_json::to_string`, and nothing in the file routes it
            // through a `Value` or a scene-specific serializer.
            let source = include_str!("../bridge/scene_io.rs");
            let executable: Vec<&str> = source
                .lines()
                .map(str::trim_start)
                .filter(|line| !line.starts_with("//"))
                .collect();
            let direct = executable
                .iter()
                .filter(|line| line.contains("serde_json::to_string(&scene_file)"))
                .count();
            assert_eq!(
                direct, 1,
                "apply_scene_export must serialize the scene exactly once, directly"
            );
            for forbidden in ["to_value(&scene_file)", "serialize_scene_file"] {
                assert!(
                    !executable.iter().any(|line| line.contains(forbidden)),
                    "scene_io.rs must not route the export through {forbidden}"
                );
            }
        }

        #[test]
        fn sparse_mixed_materials_across_multiple_entities_round_trip_independently() {
            // Entity 0 has no material_data; 1 has a finite value; 2 is a
            // default (null on the wire); 3 is zero. Each must come back on
            // its own entity, with a `null` neighbour never bleeding over.
            let mut without_material = entity("no-material", None);
            without_material.material_data = None;

            let mut finite = entity("finite", Some("no-material"));
            let mut finite_material = MaterialData::default();
            finite_material.attenuation_distance = 10.0;
            finite.material_data = Some(finite_material);

            let mut default = entity("default", Some("no-material"));
            default.material_data = Some(MaterialData::default());

            let mut zero = entity("zero", Some("no-material"));
            let mut zero_material = MaterialData::default();
            zero_material.attenuation_distance = 0.0;
            zero.material_data = Some(zero_material);

            let scene_file = build_scene_file(
                "Recovery",
                &EnvironmentSettings::default(),
                &GlobalAmbientLight::default(),
                &InputMap::default(),
                HashMap::new(),
                &PostProcessingSettings::default(),
                &AudioBusConfig::default(),
                vec![without_material, finite, default, zero],
                None,
                None,
            );

            let json = serde_json::to_string(&scene_file)
                .expect("serialize a scene with sparse, mixed materials");
            assert_eq!(json.matches(NULL_FIELD).count(), 1, "{json}");
            let parsed =
                parse_scene_file(&json).expect("a scene with sparse, mixed materials must load");

            assert!(
                parsed.entities[0].material_data.is_none(),
                "an entity with no material_data must stay that way"
            );
            assert_eq!(attenuation_of(&parsed, 1), 10.0);
            assert_eq!(attenuation_of(&parsed, 2), f32::INFINITY);
            assert_eq!(attenuation_of(&parsed, 3), 0.0);
        }
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
