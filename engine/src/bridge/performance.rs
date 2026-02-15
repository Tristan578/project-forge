//! Performance and LOD bridge systems.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    lod::{LodData, PerformanceBudget},
    pending::PendingCommands,
};

/// System that processes pending LOD commands.
#[cfg(not(feature = "runtime"))]
pub fn apply_lod_commands(
    mut commands: Commands,
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut LodData>)>,
) {
    // Process set_lod requests
    for request in pending.set_lod_requests.drain(..) {
        if let Some((entity, _eid, lod_data)) = query.iter_mut().find(|(_e, eid, _)| eid.0 == request.entity_id) {
            if let Some(mut lod) = lod_data {
                lod.lod_distances = request.lod_distances;
                lod.auto_generate = request.auto_generate;
                lod.lod_ratios = request.lod_ratios;
            } else {
                commands.entity(entity).insert(LodData {
                    lod_distances: request.lod_distances,
                    auto_generate: request.auto_generate,
                    lod_ratios: request.lod_ratios,
                    current_lod: 0,
                });
            }
        }
    }

    // Process generate_lods requests (stub - TODO: implement mesh decimation)
    for _request in pending.generate_lods_requests.drain(..) {
        tracing::info!("LOD generation requested (not yet implemented)");
    }

    // Process optimize_scene requests (stub)
    for _request in pending.optimize_scene_requests.drain(..) {
        tracing::info!("Scene optimization requested (not yet implemented)");
    }

    // Process set_lod_distances requests (stub - applies global LOD distances)
    for _request in pending.set_lod_distances_requests.drain(..) {
        tracing::info!("Global LOD distances set (not yet implemented)");
    }
}

/// System that processes performance budget commands.
#[cfg(not(feature = "runtime"))]
pub fn apply_performance_budget_commands(
    mut commands: Commands,
    mut pending: ResMut<PendingCommands>,
    mut budget_query: Query<&mut PerformanceBudget>,
) {
    // Process set_performance_budget requests
    for request in pending.set_performance_budget_requests.drain(..) {
        if let Ok(mut budget) = budget_query.get_single_mut() {
            budget.max_triangles = request.max_triangles;
            budget.max_draw_calls = request.max_draw_calls;
            budget.target_fps = request.target_fps;
            budget.warning_threshold = request.warning_threshold;
        } else {
            // Spawn a singleton PerformanceBudget entity
            commands.spawn(PerformanceBudget {
                max_triangles: request.max_triangles,
                max_draw_calls: request.max_draw_calls,
                target_fps: request.target_fps,
                warning_threshold: request.warning_threshold,
            });
        }
    }

    // Process get_performance_stats requests (stub - would emit stats event)
    for _request in pending.get_performance_stats_requests.drain(..) {
        tracing::info!("Performance stats requested (not yet implemented)");
        // TODO: emit_performance_stats() with real metrics
    }
}
