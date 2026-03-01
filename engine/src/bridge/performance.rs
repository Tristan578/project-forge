//! Performance and LOD bridge systems.

use bevy::prelude::*;
use crate::core::{
    entity_id::EntityId,
    lod::{LodData, PerformanceBudget},
    pending::PendingCommands,
};
use crate::bridge::events;

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

    // Process generate_lods requests — mesh decimation requires an external crate
    for _request in pending.generate_lods_requests.drain(..) {
        tracing::warn!("LOD mesh generation requires a mesh decimation library (e.g. meshopt)");
    }

    // Process optimize_scene requests
    for _request in pending.optimize_scene_requests.drain(..) {
        tracing::warn!("Scene optimization requires mesh decimation support");
    }

    // Process set_lod_distances requests — update all entities with LodData
    for request in pending.set_lod_distances_requests.drain(..) {
        for (_entity, _eid, lod_data) in query.iter_mut() {
            if let Some(mut lod) = lod_data {
                lod.lod_distances = request.distances;
            }
        }
    }
}

/// System that processes performance budget commands.
#[cfg(not(feature = "runtime"))]
pub fn apply_performance_budget_commands(
    mut commands: Commands,
    mut pending: ResMut<PendingCommands>,
    mut budget_query: Query<&mut PerformanceBudget>,
    time: Res<Time>,
    entity_query: Query<&EntityId>,
) {
    // Process set_performance_budget requests
    for request in pending.set_performance_budget_requests.drain(..) {
        if let Ok(mut budget) = budget_query.single_mut() {
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

    // Process get_performance_stats requests — emit real frame stats
    for _request in pending.get_performance_stats_requests.drain(..) {
        let dt = time.delta_secs();
        let fps = if dt > 0.0 { 1.0 / dt } else { 0.0 };
        let frame_time_ms = dt * 1000.0;
        let entity_count = entity_query.iter().count() as u32;
        events::emit_performance_stats(fps, frame_time_ms, entity_count);
    }
}

/// Runtime system: update LOD levels based on camera distance.
/// Runs every frame, comparing each entity's distance to the camera
/// against its lod_distances thresholds.
pub(super) fn update_lod_levels(
    camera_query: Query<&Transform, With<Camera>>,
    mut lod_query: Query<(&EntityId, &Transform, &mut LodData)>,
) {
    // Use the first camera found
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation;

    for (entity_id, transform, mut lod) in lod_query.iter_mut() {
        let distance = camera_pos.distance(transform.translation);

        let new_lod = if distance < lod.lod_distances[0] {
            0 // Full detail
        } else if distance < lod.lod_distances[1] {
            1 // Medium detail
        } else if distance < lod.lod_distances[2] {
            2 // Low detail
        } else {
            3 // Lowest detail
        };

        if new_lod != lod.current_lod {
            lod.current_lod = new_lod;
            events::emit_lod_changed(&entity_id.0, new_lod, &lod.lod_distances);
        }
    }
}
