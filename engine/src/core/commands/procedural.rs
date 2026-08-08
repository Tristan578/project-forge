//! CSG, terrain, and procedural mesh command handlers.

use bevy::math::Vec3;
use serde::Deserialize;
use crate::core::csg::CsgOperation;
use crate::core::terrain::{terrain_data_rejection, NoiseType, TerrainData, TerrainDataPatch};
use crate::core::pending::procedural::{
    queue_csg_from_bridge, queue_terrain_spawn_from_bridge, queue_terrain_update_from_bridge,
    queue_terrain_sculpt_from_bridge, queue_extrude_from_bridge, queue_lathe_from_bridge,
    queue_array_from_bridge, queue_combine_from_bridge,
    CsgRequest, TerrainSpawnRequest, TerrainUpdate, TerrainSculpt,
    ExtrudeRequest, LatheRequest, ArrayRequest, CombineRequest,
};
use crate::core::pending::scene::{
    queue_instantiate_prefab_from_bridge, queue_quality_preset_from_bridge,
    InstantiatePrefabRequest, QualityPresetRequest,
};
use crate::core::pending_commands::QueryRequest;

/// Dispatch procedural commands.
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "csg_union" => Some(handle_csg(payload.clone(), CsgOperation::Union)),
        "csg_subtract" => Some(handle_csg(payload.clone(), CsgOperation::Subtract)),
        "csg_intersect" => Some(handle_csg(payload.clone(), CsgOperation::Intersect)),
        "spawn_terrain" => Some(handle_spawn_terrain(payload.clone())),
        "update_terrain" => Some(handle_update_terrain(payload.clone())),
        "sculpt_terrain" => Some(handle_sculpt_terrain(payload.clone())),
        "get_terrain" => {
            let entity_id = payload.get("entityId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(super::handle_query(QueryRequest::TerrainState { entity_id }))
        }
        "extrude_shape" => Some(handle_extrude_shape(payload.clone())),
        "lathe_shape" => Some(handle_lathe_shape(payload.clone())),
        "array_entity" => Some(handle_array_entity(payload.clone())),
        "combine_meshes" => Some(handle_combine_meshes(payload.clone())),
        "instantiate_prefab" => Some(handle_instantiate_prefab(payload.clone())),
        "set_quality_preset" => Some(handle_set_quality_preset(payload.clone())),
        "get_quality_settings" => Some(super::handle_query(QueryRequest::QualitySettings)),
        _ => None,
    }
}

// ===== Handler Functions =====

/// Handle CSG boolean operation commands.
fn handle_csg(payload: serde_json::Value, operation: CsgOperation) -> super::CommandResult {
    let entity_id_a = payload.get("entityIdA")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityIdA")?
        .to_string();
    let entity_id_b = payload.get("entityIdB")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityIdB")?
        .to_string();
    let delete_sources = payload.get("deleteSources")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let result_name = payload.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let request = CsgRequest {
        entity_id_a,
        entity_id_b,
        operation,
        delete_sources,
        result_name,
    };

    if queue_csg_from_bridge(request) {
        tracing::info!("Queued CSG {:?} operation", operation);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for spawn_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnTerrainPayload {
    /// Optional caller-supplied entity id, so JS can reference the new terrain
    /// synchronously instead of waiting for the async SELECTION_CHANGED
    /// round-trip. Validated engine-side; a malformed value is ignored and the
    /// spawn falls back to a generated UUID.
    id: Option<String>,
    name: Option<String>,
    position: Option<[f32; 3]>,
    noise_type: Option<String>,
    octaves: Option<u32>,
    frequency: Option<f64>,
    amplitude: Option<f64>,
    height_scale: Option<f32>,
    seed: Option<u32>,
    resolution: Option<u32>,
    size: Option<f32>,
}

/// Reject a non-finite number before it reaches a clamp.
///
/// Order matters: `f32::max`/`clamp` return the *other* operand when one side is
/// NaN, so `size.max(1.0)` silently turns NaN into 1.0 and a post-clamp
/// finiteness check can never see it. Every raw payload float is screened here
/// FIRST, and only then clamped.
fn reject_non_finite<T: Into<f64> + Copy>(
    command: &str,
    field: &str,
    value: Option<T>,
) -> Result<(), String> {
    match value {
        Some(v) if !v.into().is_finite() => Err(format!(
            "Invalid {} payload: {} must be a finite number",
            command, field
        )),
        _ => Ok(()),
    }
}

fn handle_spawn_terrain(payload: serde_json::Value) -> super::CommandResult {
    let data: SpawnTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid spawn_terrain payload: {}", e))?;

    reject_non_finite("spawn_terrain", "frequency", data.frequency)?;
    reject_non_finite("spawn_terrain", "amplitude", data.amplitude)?;
    reject_non_finite("spawn_terrain", "heightScale", data.height_scale)?;
    reject_non_finite("spawn_terrain", "size", data.size)?;
    if let Some(p) = data.position {
        if p.iter().any(|c| !c.is_finite()) {
            return Err("Invalid spawn_terrain payload: position must be finite".to_string());
        }
    }

    let mut td = TerrainData::default();
    if let Some(ref nt) = data.noise_type {
        td.noise_type = match nt.as_str() {
            "simplex" => NoiseType::Simplex,
            "value" => NoiseType::Value,
            _ => NoiseType::Perlin,
        };
    }
    if let Some(v) = data.octaves {
        td.octaves = v.clamp(1, 8);
    }
    if let Some(v) = data.frequency {
        td.frequency = v;
    }
    if let Some(v) = data.amplitude {
        td.amplitude = v;
    }
    if let Some(v) = data.height_scale {
        td.height_scale = v;
    }
    if let Some(v) = data.seed {
        td.seed = v;
    }
    if let Some(v) = data.resolution {
        td.resolution = match v {
            0..=48 => 32,
            49..=96 => 64,
            97..=192 => 128,
            _ => 256,
        };
    }
    if let Some(v) = data.size {
        td.size = v.max(1.0);
    }

    // Reject rather than silently substitute. `f32::max` returns the *other*
    // operand when one side is NaN, so `v.max(1.0)` above quietly turned a NaN
    // size into 1.0 — but height_scale, frequency and amplitude had no guard at
    // all, and a NaN in any of them makes every noise sample NaN, every vertex
    // position NaN, and the terrain vanish from the render with no error.
    if let Some(reason) = terrain_data_rejection(&td) {
        return Err(format!("Invalid spawn_terrain payload: {}", reason));
    }

    let request = TerrainSpawnRequest {
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
        terrain_data: td,
        id: data.id,
    };

    if queue_terrain_spawn_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTerrainPayload {
    entity_id: String,
    noise_type: Option<String>,
    octaves: Option<u32>,
    frequency: Option<f64>,
    amplitude: Option<f64>,
    height_scale: Option<f32>,
    seed: Option<u32>,
    resolution: Option<u32>,
    size: Option<f32>,
}

fn handle_update_terrain(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_terrain payload: {}", e))?;

    reject_non_finite("update_terrain", "frequency", data.frequency)?;
    reject_non_finite("update_terrain", "amplitude", data.amplitude)?;
    reject_non_finite("update_terrain", "heightScale", data.height_scale)?;
    reject_non_finite("update_terrain", "size", data.size)?;

    // A PATCH, not a replace: carry only what the caller actually sent, so the
    // drain can overlay it on the entity's live config. Building a full
    // TerrainData from ::default() here meant nudging one field silently reset
    // the other seven — a user dragging the height slider on a seed-9001,
    // 256-resolution terrain got a seed-42, 64-resolution one.
    let patch = TerrainDataPatch {
        noise_type: data.noise_type.as_deref().map(|nt| match nt {
            "simplex" => NoiseType::Simplex,
            "value" => NoiseType::Value,
            _ => NoiseType::Perlin,
        }),
        octaves: data.octaves.map(|v| v.clamp(1, 8)),
        frequency: data.frequency,
        amplitude: data.amplitude,
        height_scale: data.height_scale,
        seed: data.seed,
        resolution: data.resolution.map(|v| match v {
            0..=48 => 32,
            49..=96 => 64,
            97..=192 => 128,
            _ => 256,
        }),
        size: data.size.map(|v| v.max(1.0)),
    };

    let update = TerrainUpdate {
        entity_id: data.entity_id,
        patch,
    };

    if queue_terrain_update_from_bridge(update) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for sculpt_terrain command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SculptTerrainPayload {
    entity_id: String,
    position: [f32; 2], // x, z in world space
    radius: f32,
    strength: f32,
}

fn handle_sculpt_terrain(payload: serde_json::Value) -> super::CommandResult {
    let data: SculptTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid sculpt_terrain payload: {}", e))?;

    // Screened BEFORE the clamp: `f32::max` returns the other operand on NaN, so
    // `radius.max(0.1)` would launder a NaN radius into 0.1. A NaN strength or
    // position has no clamp at all and writes NaN straight into the heightmap,
    // where it survives every later mesh rebuild — the terrain disappears and no
    // undo of a subsequent action brings it back.
    reject_non_finite("sculpt_terrain", "radius", Some(data.radius))?;
    reject_non_finite("sculpt_terrain", "strength", Some(data.strength))?;
    if data.position.iter().any(|c| !c.is_finite()) {
        return Err("Invalid sculpt_terrain payload: position must be finite".to_string());
    }

    let sculpt = TerrainSculpt {
        entity_id: data.entity_id,
        position: data.position,
        radius: data.radius.max(0.1),
        strength: data.strength,
    };

    if queue_terrain_sculpt_from_bridge(sculpt) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for extrude_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtrudeShapePayload {
    shape: String,
    radius: f32,
    length: f32,
    segments: u32,
    inner_radius: Option<f32>,
    star_points: Option<u32>,
    size: Option<f32>,
    name: Option<String>,
    position: Option<[f32; 3]>,
}

fn handle_extrude_shape(payload: serde_json::Value) -> super::CommandResult {
    let data: ExtrudeShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid extrude_shape payload: {}", e))?;

    let request = ExtrudeRequest {
        shape: data.shape,
        radius: data.radius.max(0.01),
        length: data.length.max(0.01),
        segments: data.segments.clamp(3, 64),
        inner_radius: data.inner_radius.map(|r| r.max(0.01)),
        star_points: data.star_points.map(|p| p.clamp(3, 16)),
        size: data.size.map(|s| s.max(0.01)),
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_extrude_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for lathe_shape command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatheShapePayload {
    profile: Vec<[f32; 2]>,
    segments: u32,
    name: Option<String>,
    position: Option<[f32; 3]>,
}

fn handle_lathe_shape(payload: serde_json::Value) -> super::CommandResult {
    let data: LatheShapePayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid lathe_shape payload: {}", e))?;

    if data.profile.len() < 2 {
        return Err("Profile must have at least 2 points".to_string());
    }

    let request = LatheRequest {
        profile: data.profile,
        segments: data.segments.clamp(8, 64),
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
    };

    if queue_lathe_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for array_entity command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrayEntityPayload {
    entity_id: String,
    pattern: String,
    count_x: Option<u32>,
    count_y: Option<u32>,
    count_z: Option<u32>,
    spacing_x: Option<f32>,
    spacing_y: Option<f32>,
    spacing_z: Option<f32>,
    circle_count: Option<u32>,
    circle_radius: Option<f32>,
}

fn handle_array_entity(payload: serde_json::Value) -> super::CommandResult {
    let data: ArrayEntityPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid array_entity payload: {}", e))?;

    let request = ArrayRequest {
        entity_id: data.entity_id,
        pattern: data.pattern,
        count_x: data.count_x.map(|c| c.clamp(1, 20)),
        count_y: data.count_y.map(|c| c.clamp(1, 20)),
        count_z: data.count_z.map(|c| c.clamp(1, 20)),
        spacing_x: data.spacing_x,
        spacing_y: data.spacing_y,
        spacing_z: data.spacing_z,
        circle_count: data.circle_count.map(|c| c.clamp(2, 32)),
        circle_radius: data.circle_radius,
    };

    if queue_array_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for combine_meshes command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CombineMeshesPayload {
    entity_ids: Vec<String>,
    delete_sources: bool,
    name: Option<String>,
}

fn handle_combine_meshes(payload: serde_json::Value) -> super::CommandResult {
    let data: CombineMeshesPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid combine_meshes payload: {}", e))?;

    if data.entity_ids.len() < 2 {
        return Err("Must provide at least 2 entities to combine".to_string());
    }

    let request = CombineRequest {
        entity_ids: data.entity_ids,
        delete_sources: data.delete_sources,
        name: data.name,
    };

    if queue_combine_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle instantiate_prefab command.
/// Payload: { snapshot_json: string, position?: [x, y, z], name?: string }
fn handle_instantiate_prefab(payload: serde_json::Value) -> super::CommandResult {
    let snapshot_json = payload.get("snapshot_json")
        .and_then(|v| v.as_str())
        .ok_or("Missing snapshot_json")?
        .to_string();

    let position = payload.get("position").and_then(|v| {
        let arr = v.as_array()?;
        if arr.len() == 3 {
            Some([
                arr[0].as_f64()? as f32,
                arr[1].as_f64()? as f32,
                arr[2].as_f64()? as f32,
            ])
        } else { None }
    });

    let name = payload.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());

    let request = InstantiatePrefabRequest {
        snapshot_json,
        position,
        name,
    };

    if queue_instantiate_prefab_from_bridge(request) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle set_quality_preset command.
/// Payload: { preset: "low" | "medium" | "high" | "ultra" }
fn handle_set_quality_preset(payload: serde_json::Value) -> super::CommandResult {
    let preset = payload.get("preset")
        .and_then(|v| v.as_str())
        .ok_or("Missing preset")?
        .to_string();

    // Validate preset name
    if !matches!(preset.as_str(), "low" | "medium" | "high" | "ultra") {
        return Err(format!("Invalid quality preset: {}. Must be low, medium, high, or ultra", preset));
    }

    if queue_quality_preset_from_bridge(QualityPresetRequest { preset }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[cfg(test)]
mod terrain_command_tests {
    use super::*;
    use crate::core::pending::PendingCommands;
    use serde_json::json;

    /// RAII guard clearing the `PENDING_COMMANDS` thread-local on drop, including
    /// on the panic path. Without it a failing assertion would leave a dangling
    /// pointer to this test's stack-local queue for the next test on the same
    /// harness thread to dereference through `with_pending`'s `unsafe`.
    struct PendingGuard;
    impl Drop for PendingGuard {
        fn drop(&mut self) {
            crate::core::pending::unregister_pending_commands();
        }
    }

    fn queue(command: &str, payload: serde_json::Value) -> PendingCommands {
        let mut pending = PendingCommands::default();
        crate::core::pending::register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .expect("procedural dispatch returned None for a known command");
        assert!(result.is_ok(), "expected {command} to queue, got {result:?}");
        pending
    }

    fn reject(command: &str, payload: serde_json::Value) -> String {
        let mut pending = PendingCommands::default();
        crate::core::pending::register_pending_commands(&mut pending as *mut _);
        let _guard = PendingGuard;
        let result = dispatch(command, &payload)
            .expect("procedural dispatch returned None for a known command");
        result.expect_err("expected the payload to be rejected")
    }

    // === update_terrain is a MERGE, not a replace ===

    /// The whole finding: `update_terrain` built a fresh `TerrainData` from
    /// `TerrainData::default()`, so nudging one field silently reset the other
    /// seven. A user dragging the height slider on a 256-resolution, seed-9001
    /// terrain got a 64-resolution, seed-42 terrain — completely different
    /// landscape, no error.
    #[test]
    fn update_terrain_with_one_field_patches_only_that_field() {
        let pending = queue(
            "update_terrain",
            json!({ "entityId": "terrain-1", "heightScale": 40.0 }),
        );

        assert_eq!(pending.terrain_updates.len(), 1);
        let patch = &pending.terrain_updates[0].patch;
        assert_eq!(patch.height_scale, Some(40.0));
        assert_eq!(patch.seed, None, "an omitted field must stay unpatched");
        assert_eq!(patch.resolution, None);
        assert_eq!(patch.size, None);
        assert_eq!(patch.noise_type, None);
        assert_eq!(patch.octaves, None);
        assert_eq!(patch.frequency, None);
        assert_eq!(patch.amplitude, None);
    }

    #[test]
    fn update_terrain_with_no_fields_produces_an_empty_patch() {
        let pending = queue("update_terrain", json!({ "entityId": "terrain-1" }));
        assert_eq!(
            pending.terrain_updates[0].patch,
            crate::core::terrain::TerrainDataPatch::default(),
        );
    }

    /// Every field must reach the patch — a merge arm wired to the wrong
    /// destination, or a field the payload forgets to carry, is invisible
    /// otherwise.
    #[test]
    fn update_terrain_maps_every_field_into_the_patch() {
        let pending = queue(
            "update_terrain",
            json!({
                "entityId": "terrain-1",
                "noiseType": "simplex",
                "octaves": 6,
                "frequency": 0.5,
                "amplitude": 0.25,
                "heightScale": 12.0,
                "seed": 9001,
                "resolution": 128,
                "size": 80.0,
            }),
        );

        let patch = &pending.terrain_updates[0].patch;
        assert_eq!(patch.noise_type, Some(NoiseType::Simplex));
        assert_eq!(patch.octaves, Some(6));
        assert_eq!(patch.frequency, Some(0.5));
        assert_eq!(patch.amplitude, Some(0.25));
        assert_eq!(patch.height_scale, Some(12.0));
        assert_eq!(patch.seed, Some(9001));
        assert_eq!(patch.resolution, Some(128));
        assert_eq!(patch.size, Some(80.0));
    }

    /// The clamps must survive the move to a patch, or the update path becomes
    /// the way to sneak past limits the spawn path enforces.
    #[test]
    fn update_terrain_still_clamps_octaves_and_snaps_resolution() {
        let pending = queue(
            "update_terrain",
            json!({ "entityId": "terrain-1", "octaves": 99, "resolution": 100000 }),
        );
        let patch = &pending.terrain_updates[0].patch;
        assert_eq!(patch.octaves, Some(8));
        assert_eq!(patch.resolution, Some(256));
    }

    // === non-finite payload rejection ===

    /// MEASUREMENT that fixes the scope of the finiteness guards: a non-finite
    /// float cannot be spelled in JSON at all, so it can never reach a handler as
    /// a `Value::Number`.
    ///
    /// * `json!(f64::NAN)` and `json!(f64::INFINITY)` both evaluate to
    ///   `Value::Null` — `serde_json::Number::from_f64` returns `None` for
    ///   non-finite input and the `Value` visitor maps that to `Null`.
    /// * The text parser refuses an out-of-range literal outright rather than
    ///   saturating to infinity (`1e400` → `Err("number out of range")`), which
    ///   also confirms the `arbitrary_precision` feature is off.
    /// * The bridge deserialises with `serde_wasm_bindgen::from_value::<Value>`,
    ///   which funnels a JS `NaN` through that same `from_f64`, so it lands as
    ///   `Null` there too.
    ///
    /// So `reject_non_finite` is DEFENCE IN DEPTH for a Rust caller that queues a
    /// request directly (`queue_terrain_spawn_from_bridge` and friends are `pub`),
    /// not a live JSON path — and it is therefore tested against the function
    /// itself below, because `dispatch` cannot be handed the input that would
    /// exercise it.
    #[test]
    fn a_non_finite_float_cannot_be_expressed_in_json() {
        assert_eq!(json!(f64::NAN), serde_json::Value::Null);
        assert_eq!(json!(f64::INFINITY), serde_json::Value::Null);
        assert_eq!(json!(f64::NEG_INFINITY), serde_json::Value::Null);
        assert!(
            serde_json::from_str::<serde_json::Value>("1e400").is_err(),
            "an out-of-range literal must be refused, not saturated to infinity",
        );
    }

    /// The corollary: what a JS `NaN` actually delivers is `null`, and `null` on
    /// an optional field means ABSENT. It must not be laundered into a value.
    #[test]
    fn a_null_field_is_absent_not_a_laundered_nan() {
        let pending = queue(
            "update_terrain",
            json!({ "entityId": "terrain-1", "heightScale": null, "size": null }),
        );
        let patch = &pending.terrain_updates[0].patch;
        assert_eq!(patch.height_scale, None);
        assert_eq!(patch.size, None);
    }

    /// The guard itself, exercised with genuine non-finite `f32`/`f64` values.
    ///
    /// Order is the whole point: `f32::max`/`clamp` return the OTHER operand when
    /// one side is NaN, so `size.max(1.0)` turns NaN into 1.0 and a post-clamp
    /// finiteness check can never see it. Every raw float is screened here before
    /// any clamp runs.
    #[test]
    fn reject_non_finite_refuses_non_finite_values_and_admits_finite_ones() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let err = reject_non_finite("spawn_terrain", "size", Some(bad))
                .expect_err("a non-finite f32 must be refused");
            assert_eq!(
                err,
                "Invalid spawn_terrain payload: size must be a finite number",
            );
        }
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(reject_non_finite("update_terrain", "frequency", Some(bad)).is_err());
        }
        for good in [0.0f32, -1.0, 1e30, f32::MIN, f32::MAX] {
            assert!(reject_non_finite("spawn_terrain", "size", Some(good)).is_ok());
        }
        assert!(
            reject_non_finite::<f32>("spawn_terrain", "size", None).is_ok(),
            "an omitted field is not a non-finite one",
        );
    }

    /// A NaN strength would write NaN into the heightmap permanently: every later
    /// mesh rebuild emits NaN vertices, so the terrain is gone and no undo of a
    /// *later* action brings it back. `radius`, `strength` and `position` are all
    /// REQUIRED fields, so the `null` a JS `NaN` decays into is refused by serde
    /// before the handler runs — proven here so the two layers cannot both be
    /// removed on the assumption the other covers it.
    #[test]
    fn sculpt_terrain_rejects_a_null_where_a_number_is_required() {
        let cases = [
            json!({ "entityId": "t", "position": [0.0, 0.0], "radius": 2.0, "strength": null }),
            json!({ "entityId": "t", "position": [0.0, 0.0], "radius": null, "strength": 1.0 }),
            json!({ "entityId": "t", "position": [null, 0.0], "radius": 2.0, "strength": 1.0 }),
        ];
        for payload in cases {
            let err = reject("sculpt_terrain", payload.clone());
            assert!(
                err.starts_with("Invalid sculpt_terrain payload"),
                "expected a validation error for {payload}, got {err}",
            );
        }
    }

    /// And the guard the handler owns, for the values serde WILL accept.
    #[test]
    fn sculpt_terrain_rejects_a_non_finite_radius_before_it_is_clamped() {
        // Reachable only from a Rust caller, for the reason measured in
        // `a_non_finite_float_cannot_be_expressed_in_json`.
        assert!(reject_non_finite("sculpt_terrain", "radius", Some(f32::NAN)).is_err());
        assert!(reject_non_finite("sculpt_terrain", "strength", Some(f32::NAN)).is_err());
    }

    #[test]
    fn sculpt_terrain_queues_a_valid_request_unchanged() {
        let pending = queue(
            "sculpt_terrain",
            json!({
                "entityId": "terrain-1",
                "position": [3.0, -4.0],
                "radius": 2.5,
                "strength": -1.5,
            }),
        );
        assert_eq!(pending.terrain_sculpts.len(), 1);
        let sculpt = &pending.terrain_sculpts[0];
        assert_eq!(sculpt.entity_id, "terrain-1");
        assert_eq!(sculpt.position, [3.0, -4.0]);
        assert_eq!(sculpt.radius, 2.5);
        assert_eq!(sculpt.strength, -1.5);
    }
}
