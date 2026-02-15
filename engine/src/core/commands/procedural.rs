//! CSG, terrain, and procedural mesh command handlers.

use bevy::math::Vec3;
use serde::Deserialize;
use crate::core::csg::CsgOperation;
use crate::core::terrain::{TerrainData, NoiseType};
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

fn handle_spawn_terrain(payload: serde_json::Value) -> super::CommandResult {
    let data: SpawnTerrainPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid spawn_terrain payload: {}", e))?;

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

    let request = TerrainSpawnRequest {
        name: data.name,
        position: data.position.map(|p| Vec3::new(p[0], p[1], p[2])),
        terrain_data: td,
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

    // Build a full TerrainData from partial payload with defaults.
    // The apply system will merge with existing component data.
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

    let update = TerrainUpdate {
        entity_id: data.entity_id,
        terrain_data: td,
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
