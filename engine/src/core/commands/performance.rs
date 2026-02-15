//! Performance and LOD command handlers.

use serde::Deserialize;
use serde_json::Value;
use crate::core::pending::{
    SetLodRequest, GenerateLodsRequest, SetPerformanceBudgetRequest,
    GetPerformanceStatsRequest, OptimizeSceneRequest, SetLodDistancesRequest,
    bridge_set_lod, bridge_generate_lods, bridge_set_performance_budget,
    bridge_get_performance_stats, bridge_optimize_scene, bridge_set_lod_distances,
};
use super::CommandResult;

/// Dispatch performance commands.
pub fn dispatch(command: &str, payload: &Value) -> Option<CommandResult> {
    match command {
        "set_lod" => Some(handle_set_lod(payload)),
        "generate_lods" => Some(handle_generate_lods(payload)),
        "set_performance_budget" => Some(handle_set_performance_budget(payload)),
        "get_performance_stats" => Some(handle_get_performance_stats()),
        "optimize_scene" => Some(handle_optimize_scene()),
        "set_lod_distances" => Some(handle_set_lod_distances(payload)),
        _ => None,
    }
}

#[derive(Deserialize)]
struct SetLodPayload {
    #[serde(rename = "entityId")]
    entity_id: String,
    #[serde(rename = "lodDistances")]
    lod_distances: [f32; 3],
    #[serde(rename = "autoGenerate")]
    auto_generate: bool,
    #[serde(rename = "lodRatios")]
    lod_ratios: [f32; 3],
}

fn handle_set_lod(payload: &Value) -> CommandResult {
    let params: SetLodPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_lod payload: {}", e))?;

    #[cfg(target_arch = "wasm32")]
    bridge_set_lod(
        params.entity_id,
        params.lod_distances,
        params.auto_generate,
        params.lod_ratios,
    );

    Ok(())
}

#[derive(Deserialize)]
struct GenerateLodsPayload {
    #[serde(rename = "entityId")]
    entity_id: String,
}

fn handle_generate_lods(payload: &Value) -> CommandResult {
    let params: GenerateLodsPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid generate_lods payload: {}", e))?;

    #[cfg(target_arch = "wasm32")]
    bridge_generate_lods(params.entity_id);

    Ok(())
}

#[derive(Deserialize)]
struct SetPerformanceBudgetPayload {
    #[serde(rename = "maxTriangles")]
    max_triangles: u32,
    #[serde(rename = "maxDrawCalls")]
    max_draw_calls: u32,
    #[serde(rename = "targetFps")]
    target_fps: f32,
    #[serde(rename = "warningThreshold")]
    warning_threshold: f32,
}

fn handle_set_performance_budget(payload: &Value) -> CommandResult {
    let params: SetPerformanceBudgetPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_performance_budget payload: {}", e))?;

    #[cfg(target_arch = "wasm32")]
    bridge_set_performance_budget(
        params.max_triangles,
        params.max_draw_calls,
        params.target_fps,
        params.warning_threshold,
    );

    Ok(())
}

fn handle_get_performance_stats() -> CommandResult {
    #[cfg(target_arch = "wasm32")]
    bridge_get_performance_stats();

    Ok(())
}

fn handle_optimize_scene() -> CommandResult {
    #[cfg(target_arch = "wasm32")]
    bridge_optimize_scene();

    Ok(())
}

#[derive(Deserialize)]
struct SetLodDistancesPayload {
    distances: [f32; 3],
}

fn handle_set_lod_distances(payload: &Value) -> CommandResult {
    let params: SetLodDistancesPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("Invalid set_lod_distances payload: {}", e))?;

    #[cfg(target_arch = "wasm32")]
    bridge_set_lod_distances(params.distances);

    Ok(())
}
