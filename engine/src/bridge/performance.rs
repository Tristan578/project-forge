//! Performance and LOD bridge systems.

use bevy::prelude::*;
use bevy::mesh::Mesh;
use crate::core::{
    entity_id::EntityId,
    lod::{LodData, LodMeshes, PerformanceBudget, PerformanceMetrics},
    mesh_simplify,
    pending::PendingCommands,
};
use crate::bridge::events;

/// System that processes pending LOD commands including mesh generation.
#[cfg(not(feature = "runtime"))]
pub fn apply_lod_commands(
    mut commands: Commands,
    mut pending: ResMut<PendingCommands>,
    mut query: Query<(Entity, &EntityId, Option<&mut LodData>)>,
    mesh_query: Query<&Mesh3d>,
    mut meshes: ResMut<Assets<Mesh>>,
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

    // Collect generate_lods requests first to avoid borrow conflicts
    let generate_requests: Vec<_> = pending.generate_lods_requests.drain(..).collect();

    for request in generate_requests {
        // Find entity
        let found = query.iter_mut()
            .find(|(_e, eid, _)| eid.0 == request.entity_id)
            .map(|(entity, _eid, lod_data)| {
                let ratios = if let Some(ref lod) = lod_data {
                    lod.lod_ratios
                } else {
                    [0.5, 0.25, 0.1]
                };
                (entity, ratios)
            });

        if let Some((entity, ratios)) = found {
            // Get mesh handle from entity
            if let Ok(mesh3d) = mesh_query.get(entity) {
                let mesh_handle = mesh3d.0.clone();
                // Clone the original mesh to avoid borrow conflicts when adding new meshes
                let original_mesh_clone = meshes.get(&mesh_handle).cloned();
                if let Some(original_mesh) = original_mesh_clone {
                    // Generate simplified meshes using QEM
                    let mut lod_meshes = LodMeshes::default();
                    lod_meshes.levels[0] = Some(mesh_handle.clone());

                    for (i, &ratio) in ratios.iter().enumerate() {
                        let simplified = mesh_simplify::simplify_mesh(&original_mesh, ratio);
                        let handle = meshes.add(simplified);
                        lod_meshes.levels[i + 1] = Some(handle);
                    }

                    commands.entity(entity).insert(lod_meshes);

                    // Also ensure LodData is set
                    if query.get(entity).map(|(_, _, lod)| lod.is_none()).unwrap_or(false) {
                        commands.entity(entity).insert(LodData {
                            lod_distances: [10.0, 25.0, 50.0],
                            auto_generate: true,
                            lod_ratios: ratios,
                            current_lod: 0,
                        });
                    }

                    tracing::info!("Generated LOD meshes for entity: {}", request.entity_id);
                }
            }
        }
    }

    // Process optimize_scene requests — apply LOD config to all entities with meshes
    for _request in pending.optimize_scene_requests.drain(..) {
        let mut count = 0u32;
        for (entity, _eid, lod_data) in query.iter_mut() {
            if lod_data.is_none() {
                commands.entity(entity).insert(LodData {
                    lod_distances: [15.0, 30.0, 60.0],
                    auto_generate: true,
                    lod_ratios: [1.0, 0.5, 0.25],
                    current_lod: 0,
                });
                count += 1;
            }
        }
        tracing::info!("Scene optimization: added LOD config to {} entities", count);
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
    metrics: Option<Res<PerformanceMetrics>>,
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

    // Process get_performance_stats requests — emit cached metrics
    for _request in pending.get_performance_stats_requests.drain(..) {
        if let Some(ref m) = metrics {
            events::emit_performance_stats(
                m.fps,
                m.frame_time_ms,
                m.entity_count,
                m.triangle_count,
                m.draw_call_estimate,
                m.wasm_heap_bytes,
                m.mesh_memory_bytes,
            );
        } else {
            events::emit_performance_stats(0.0, 0.0, 0, 0, 0, 0, 0);
        }
    }
}

/// Runtime system: update LOD levels based on camera distance and swap meshes.
pub(super) fn update_lod_levels(
    camera_query: Query<&Transform, With<Camera>>,
    mut lod_query: Query<(&EntityId, &Transform, &mut LodData, Option<&LodMeshes>, Option<&mut Mesh3d>)>,
) {
    // Use the first camera found
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation;

    for (entity_id, transform, mut lod, lod_meshes, mesh3d) in lod_query.iter_mut() {
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

            // Swap mesh if LodMeshes is available
            if let (Some(lm), Some(mut m3d)) = (lod_meshes, mesh3d) {
                if let Some(ref handle) = lm.levels[new_lod as usize] {
                    m3d.0 = handle.clone();
                }
            }

            events::emit_lod_changed(&entity_id.0, new_lod, &lod.lod_distances);
        }
    }
}

/// System that collects real performance metrics every N frames.
/// Runs every frame but only collects expensive stats every 10 frames.
pub(super) fn collect_performance_metrics(
    time: Res<Time>,
    mut metrics: ResMut<PerformanceMetrics>,
    entity_query: Query<&EntityId>,
    visible_mesh_query: Query<(&Mesh3d, &Visibility)>,
    mesh_assets: Res<Assets<Mesh>>,
) {
    // Always update FPS (cheap)
    let dt = time.delta_secs();
    metrics.fps = if dt > 0.0 { 1.0 / dt } else { 0.0 };
    metrics.frame_time_ms = dt * 1000.0;

    metrics.frame_counter += 1;

    // Expensive stats every 10 frames
    if metrics.frame_counter % 10 != 0 {
        return;
    }

    metrics.entity_count = entity_query.iter().count() as u32;

    // Count triangles and draw calls from visible mesh entities
    let mut total_triangles: u32 = 0;
    let mut draw_calls: u32 = 0;

    for (mesh3d, visibility) in visible_mesh_query.iter() {
        if *visibility == Visibility::Hidden {
            continue;
        }
        draw_calls += 1;
        if let Some(mesh) = mesh_assets.get(&mesh3d.0) {
            let tri_count = match mesh.indices() {
                Some(indices) => indices.len() as u32 / 3,
                None => {
                    let vert_count = mesh.count_vertices() as u32;
                    vert_count / 3
                }
            };
            total_triangles += tri_count;
        }
    }

    metrics.triangle_count = total_triangles;
    metrics.draw_call_estimate = draw_calls;

    // Read WASM heap size
    #[cfg(target_arch = "wasm32")]
    {
        let memory = wasm_bindgen::memory();
        if let Ok(buffer) = js_sys::Reflect::get(&memory, &wasm_bindgen::JsValue::from_str("buffer")) {
            if let Ok(byte_length) = js_sys::Reflect::get(&buffer, &wasm_bindgen::JsValue::from_str("byteLength")) {
                if let Some(len) = byte_length.as_f64() {
                    metrics.wasm_heap_bytes = len as u64;
                }
            }
        }
    }

    // Estimate mesh memory from all mesh assets
    let mut mesh_mem: u64 = 0;
    for (_id, mesh) in mesh_assets.iter() {
        let vert_count = mesh.count_vertices() as u64;
        // Approximate: position (12) + normal (12) + uv (8) + indices (4 per tri vertex)
        mesh_mem += vert_count * 32;
        if let Some(indices) = mesh.indices() {
            mesh_mem += indices.len() as u64 * 4;
        }
    }
    metrics.mesh_memory_bytes = mesh_mem;
}
