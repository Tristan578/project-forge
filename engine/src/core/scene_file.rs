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
use super::material::{decode_scene_attenuation_distance, encode_scene_attenuation_distance};
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

/// Serialize a `SceneFile` to its on-disk JSON form.
///
/// This is the save-side counterpart of [`parse_scene_file`]'s
/// `attenuationDistance` handling (#10267): `MaterialData`'s own `Serialize`
/// impl stays plain (see `core::material`'s comment on the field) so live
/// bridge events keep emitting `null` for a non-finite value, which means a
/// non-finite `attenuation_distance` — usually the default, `f32::INFINITY`
/// — comes out of a plain `serde_json::to_value` as indistinguishable `null`.
/// That is fine for `+Infinity` (the only value `null` ever meant before this
/// fix, and `parse_scene_file` maps it back), but it would silently coerce a
/// `-Infinity` or `NaN` attenuation distance to `+Infinity` on the next load.
/// This function re-encodes just those two edge cases through
/// `encode_scene_attenuation_distance`'s sentinel strings before writing the
/// scene out, scoped to scene persistence only — never touching
/// `MaterialData`'s own (de)serialize impl.
pub fn serialize_scene_file(scene: &SceneFile) -> Result<String, String> {
    let mut value = serde_json::to_value(scene)
        .map_err(|error| format!("Failed to serialize scene: {error}"))?;
    if let Some(entities) = value.get_mut("entities").and_then(|v| v.as_array_mut()) {
        for (index, entity) in scene.entities.iter().enumerate() {
            let Some(material) = entity.material_data.as_ref() else {
                continue;
            };
            if material.attenuation_distance.is_finite() {
                // The plain, unpatched output is already exact.
                continue;
            }
            let Some(material_value) = entities
                .get_mut(index)
                .and_then(|e| e.get_mut("materialData"))
                .and_then(|m| m.as_object_mut())
            else {
                continue;
            };
            material_value.insert(
                "attenuationDistance".to_string(),
                encode_scene_attenuation_distance(material.attenuation_distance),
            );
        }
    }
    serde_json::to_string(&value).map_err(|error| format!("Failed to serialize scene: {error}"))
}

/// Parse and validate a scene before any editor state is changed.
///
/// Both the synchronous preflight command and the queued loader use this
/// function, so accepting a checkpoint cannot depend on a weaker JSON schema.
pub fn parse_scene_file(json: &str) -> Result<SceneFile, String> {
    if json.len() > MAX_SCENE_JSON_BYTES {
        return Err("Scene JSON exceeds the 50 MiB limit".to_string());
    }

    // `attenuationDistance` may arrive as `null` (every scene saved before
    // #10267 — see the comment on `MaterialData::attenuation_distance`) or as
    // one of `serialize_scene_file`'s sentinel strings for a non-finite
    // value. `MaterialData`'s own (plain) Deserialize accepts neither, so
    // decode it here — on a generic `Value`, before the strict, fully-typed
    // parse below — substituting a finite placeholder so that typed parse
    // does not reject the field, then patch the real decoded value back onto
    // the result afterward.
    let mut raw: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("Invalid scene file: {error}"))?;
    let mut decoded_attenuation: Vec<(usize, f32)> = Vec::new();
    if let Some(entities) = raw.get_mut("entities").and_then(|v| v.as_array_mut()) {
        for (index, entity) in entities.iter_mut().enumerate() {
            let Some(material) = entity.get_mut("materialData") else {
                continue;
            };
            let Some(material_obj) = material.as_object_mut() else {
                continue;
            };
            let Some(attenuation) = material_obj.get("attenuationDistance") else {
                continue;
            };
            let decoded = decode_scene_attenuation_distance(attenuation)
                .map_err(|error| format!("Invalid scene file: entity {index}: {error}"))?;
            material_obj.insert("attenuationDistance".to_string(), serde_json::json!(0.0));
            decoded_attenuation.push((index, decoded));
        }
    }

    let mut scene: SceneFile =
        serde_json::from_value(raw).map_err(|error| format!("Invalid scene file: {error}"))?;
    for (index, decoded) in decoded_attenuation {
        if let Some(material) = scene
            .entities
            .get_mut(index)
            .and_then(|entity| entity.material_data.as_mut())
        {
            material.attenuation_distance = decoded;
        }
    }

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
    // `serialize_scene_file` / `parse_scene_file` — the scoped scene-file
    // wire format, not `MaterialData`'s own (unmodified) Serialize/Deserialize.
    mod attenuation_distance_scene_round_trip {
        use super::*;
        use crate::core::material::MaterialData;

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

        fn round_trip(material: MaterialData) -> f32 {
            let scene_file = scene_with_material(material);
            let json = serialize_scene_file(&scene_file).expect("serialize scene with a material");
            let parsed = parse_scene_file(&json)
                .expect("a scene with this material must load");
            parsed.entities[0]
                .material_data
                .as_ref()
                .expect("material_data must survive the round trip")
                .attenuation_distance
        }

        #[test]
        fn default_infinity_material_round_trips() {
            assert_eq!(round_trip(MaterialData::default()), f32::INFINITY);
        }

        #[test]
        fn neg_infinity_round_trips() {
            let mut material = MaterialData::default();
            material.attenuation_distance = f32::NEG_INFINITY;
            assert_eq!(round_trip(material), f32::NEG_INFINITY);
        }

        #[test]
        fn nan_round_trips() {
            let mut material = MaterialData::default();
            material.attenuation_distance = f32::NAN;
            // NaN != NaN under `assert_eq!`.
            assert!(round_trip(material).is_nan());
        }

        #[test]
        fn finite_fractional_value_round_trips() {
            let mut material = MaterialData::default();
            material.attenuation_distance = 4.5;
            assert_eq!(round_trip(material), 4.5);
        }

        #[test]
        fn finite_integer_valued_value_round_trips() {
            // JSON numbers written without a fractional part parse to a
            // different `serde_json::Number` variant than `4.5` above;
            // `decode_scene_attenuation_distance` must handle both.
            let mut material = MaterialData::default();
            material.attenuation_distance = 5.0;
            assert_eq!(round_trip(material), 5.0);
        }

        #[test]
        fn legacy_null_attenuation_distance_loads_as_infinity() {
            // The exact shape every scene saved before #10267 used:
            // `serde_json` wrote `null` for `f32::INFINITY` and nothing
            // mapped it back.
            let scene_file = scene_with_material(MaterialData::default());
            let mut value = serde_json::to_value(&scene_file).expect("serialize scene to a Value");
            value["entities"][0]["materialData"]["attenuationDistance"] = serde_json::Value::Null;
            let parsed = parse_scene_file(&value.to_string())
                .expect("a legacy null attenuationDistance must still load");
            assert_eq!(
                parsed.entities[0].material_data.as_ref().unwrap().attenuation_distance,
                f32::INFINITY
            );
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
            assert_eq!(
                parsed.entities[0].material_data.as_ref().unwrap().attenuation_distance,
                f32::INFINITY
            );
        }

        #[test]
        fn an_unrecognized_sentinel_string_is_rejected() {
            let scene_file = scene_with_material(MaterialData::default());
            let mut value = serde_json::to_value(&scene_file).expect("serialize scene to a Value");
            value["entities"][0]["materialData"]["attenuationDistance"] =
                serde_json::json!("not-a-real-sentinel");
            assert!(parse_scene_file(&value.to_string()).is_err());
        }

        #[test]
        fn material_data_own_serialize_stays_plain_inside_a_scene_too() {
            // `serialize_scene_file` only patches the JSON when the value is
            // non-finite; a finite value must come straight from
            // `MaterialData`'s own Serialize, untouched.
            let mut material = MaterialData::default();
            material.attenuation_distance = 10.0;
            let scene_file = scene_with_material(material);
            let json = serialize_scene_file(&scene_file).expect("serialize scene with a material");
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(
                value["entities"][0]["materialData"]["attenuationDistance"],
                serde_json::json!(10.0)
            );
        }

        #[test]
        fn sparse_mixed_materials_across_multiple_entities_round_trip_independently() {
            // Regression guard for the index-based matching in
            // `serialize_scene_file` (`entities.get_mut(index)`) and
            // `parse_scene_file` (`decoded_attenuation: Vec<(usize, f32)>`).
            // Not every entity carries `material_data` — the loops must skip
            // those by entity index, not by "the next material found" — and
            // a non-finite value on one entity must never leak onto a
            // neighboring entity's slot.
            //
            // Entity 0: no material_data at all (sparse).
            // Entity 1: finite material — must pass through untouched.
            // Entity 2: NEG_INFINITY — must decode back to NEG_INFINITY, not
            //   entity 1's or entity 3's value.
            // Entity 3: NaN — must decode back to NaN, not leak into a
            //   neighboring slot.
            let mut without_material = entity("no-material", None);
            without_material.material_data = None;

            let mut finite = entity("finite", Some("no-material"));
            let mut finite_material = MaterialData::default();
            finite_material.attenuation_distance = 10.0;
            finite.material_data = Some(finite_material);

            let mut neg_infinity = entity("neg-infinity", Some("no-material"));
            let mut neg_infinity_material = MaterialData::default();
            neg_infinity_material.attenuation_distance = f32::NEG_INFINITY;
            neg_infinity.material_data = Some(neg_infinity_material);

            let mut nan = entity("nan", Some("no-material"));
            let mut nan_material = MaterialData::default();
            nan_material.attenuation_distance = f32::NAN;
            nan.material_data = Some(nan_material);

            let scene_file = build_scene_file(
                "Recovery",
                &EnvironmentSettings::default(),
                &GlobalAmbientLight::default(),
                &InputMap::default(),
                HashMap::new(),
                &PostProcessingSettings::default(),
                &AudioBusConfig::default(),
                vec![without_material, finite, neg_infinity, nan],
                None,
                None,
            );

            let json = serialize_scene_file(&scene_file)
                .expect("serialize a scene with sparse, mixed materials");
            let parsed = parse_scene_file(&json)
                .expect("a scene with sparse, mixed materials must load");

            assert!(
                parsed.entities[0].material_data.is_none(),
                "an entity with no material_data must stay that way"
            );
            assert_eq!(
                parsed.entities[1]
                    .material_data
                    .as_ref()
                    .expect("entity 1 must keep its material_data")
                    .attenuation_distance,
                10.0,
                "a finite value must not be disturbed by a neighbor's patch"
            );
            assert_eq!(
                parsed.entities[2]
                    .material_data
                    .as_ref()
                    .expect("entity 2 must keep its material_data")
                    .attenuation_distance,
                f32::NEG_INFINITY,
                "entity 2's own value must not be swapped with entity 3's"
            );
            assert!(
                parsed.entities[3]
                    .material_data
                    .as_ref()
                    .expect("entity 3 must keep its material_data")
                    .attenuation_distance
                    .is_nan(),
                "entity 3's own value must not be swapped with entity 2's"
            );
        }
    }
}
