//! Bridge systems for edit mode (polygon modeling).

use bevy::prelude::*;
use bevy::render::mesh::{Indices, VertexAttributeValues};
use crate::core::entity_id::EntityId;
use crate::core::edit_mode::{EditModeData, SelectionMode};
use crate::core::pending_commands::PendingCommands;
use super::events::emit_event;

/// System to apply edit mode requests from pending commands.
#[cfg(not(feature = "runtime"))]
pub fn apply_edit_mode_requests(
    mut commands: Commands,
    mut pending: ResMut<PendingCommands>,
    mut edit_mode_query: Query<(Entity, &EntityId, Option<&mut EditModeData>)>,
    mesh_query: Query<&Mesh3d>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    // Enter edit mode
    for request in pending.enter_edit_mode_requests.drain(..) {
        if let Some((entity, _eid, edit_mode_opt)) = edit_mode_query.iter_mut().find(|(_e, id, _)| id.0 == request.entity_id) {
            if let Some(mut edit_mode) = edit_mode_opt {
                edit_mode.active = true;
                edit_mode.selected_indices.clear();
            } else {
                commands.entity(entity).insert(EditModeData {
                    active: true,
                    ..Default::default()
                });
            }

            // Emit event
            emit_event("edit_mode_entered", &serde_json::json!({ "entityId": request.entity_id }));

            // Get mesh stats and emit
            if let Ok(mesh_handle) = mesh_query.get(entity) {
                if let Some(mesh) = meshes.get(&mesh_handle.0) {
                    let (vertex_count, edge_count, face_count) = get_mesh_stats(mesh);
                    emit_event("edit_mode_mesh_stats", &serde_json::json!({
                        "entityId": request.entity_id,
                        "vertexCount": vertex_count,
                        "edgeCount": edge_count,
                        "faceCount": face_count,
                    }));
                }
            }
        }
    }

    // Exit edit mode
    for request in pending.exit_edit_mode_requests.drain(..) {
        if let Some((_entity, _eid, Some(mut edit_mode))) = edit_mode_query.iter_mut().find(|(_e, id, _)| id.0 == request.entity_id) {
            edit_mode.active = false;
            edit_mode.selected_indices.clear();
            emit_event("edit_mode_exited", &serde_json::json!({ "entityId": request.entity_id }));
        }
    }

    // Set selection mode
    for request in pending.set_selection_mode_requests.drain(..) {
        if let Some((_entity, _eid, Some(mut edit_mode))) = edit_mode_query.iter_mut().find(|(_e, id, _)| id.0 == request.entity_id) {
            let mode = match request.mode.as_str() {
                "vertex" => SelectionMode::Vertex,
                "edge" => SelectionMode::Edge,
                "face" => SelectionMode::Face,
                _ => continue,
            };
            edit_mode.selection_mode = mode;
            edit_mode.selected_indices.clear();
        }
    }

    // Select elements
    for request in pending.select_elements_requests.drain(..) {
        if let Some((_entity, _eid, Some(mut edit_mode))) = edit_mode_query.iter_mut().find(|(_e, id, _)| id.0 == request.entity_id) {
            edit_mode.selected_indices = request.indices;
        }
    }

    // Mesh operations
    for request in pending.mesh_operation_requests.drain(..) {
        let entity_data = edit_mode_query.iter().find(|(_e, id, _)| id.0 == request.entity_id);
        if let Some((entity, _eid, _)) = entity_data {
            if let Ok(mesh_handle) = mesh_query.get(entity) {
                if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
                    let params: serde_json::Value = serde_json::from_str(&request.params).unwrap_or_default();

                    match request.operation.as_str() {
                        "extrude" => {
                            let indices: Vec<u32> = params.get("indices")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect())
                                .unwrap_or_default();
                            let distance = params.get("distance").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
                            let direction = params.get("direction")
                                .and_then(|v| v.as_array())
                                .and_then(|arr| {
                                    if arr.len() == 3 {
                                        Some([
                                            arr[0].as_f64().unwrap_or(0.0) as f32,
                                            arr[1].as_f64().unwrap_or(1.0) as f32,
                                            arr[2].as_f64().unwrap_or(0.0) as f32,
                                        ])
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or([0.0, 1.0, 0.0]);

                            perform_extrude(mesh, &indices, distance, direction);
                        }
                        "subdivide" => {
                            let level = params.get("level").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                            perform_subdivide(mesh, level);
                        }
                        _ => {
                            tracing::warn!("Unknown mesh operation: {}", request.operation);
                        }
                    }
                }
            }
        }
    }

    // Recalculate normals
    for request in pending.recalc_normals_requests.drain(..) {
        let entity_data = edit_mode_query.iter().find(|(_e, id, _)| id.0 == request.entity_id);
        if let Some((entity, _eid, _)) = entity_data {
            if let Ok(mesh_handle) = mesh_query.get(entity) {
                if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
                    if request.smooth {
                        recalculate_smooth_normals(mesh);
                    } else {
                        recalculate_flat_normals(mesh);
                    }
                }
            }
        }
    }
}

/// System to emit edit mode selection changes.
#[cfg(not(feature = "runtime"))]
pub fn emit_edit_mode_selection(
    query: Query<(&EntityId, &EditModeData), Changed<EditModeData>>,
) {
    for (entity_id, edit_mode) in query.iter() {
        if edit_mode.active {
            emit_event("edit_mode_selection_changed", &serde_json::json!({
                "entityId": entity_id.0,
                "indices": edit_mode.selected_indices,
                "mode": match edit_mode.selection_mode {
                    SelectionMode::Vertex => "vertex",
                    SelectionMode::Edge => "edge",
                    SelectionMode::Face => "face",
                },
            }));
        }
    }
}

// === Helper Functions ===

fn get_mesh_stats(mesh: &Mesh) -> (usize, usize, usize) {
    let vertex_count = mesh.attribute(Mesh::ATTRIBUTE_POSITION)
        .map(|attr| attr.len())
        .unwrap_or(0);

    let face_count = match mesh.indices() {
        Some(Indices::U32(indices)) => indices.len() / 3,
        Some(Indices::U16(indices)) => indices.len() / 3,
        None => 0,
    };

    let edge_count = face_count * 3;

    (vertex_count, edge_count, face_count)
}

fn perform_extrude(mesh: &mut Mesh, indices: &[u32], distance: f32, direction: [f32; 3]) {
    let positions = if let Some(VertexAttributeValues::Float32x3(ref mut pos)) = mesh.attribute_mut(Mesh::ATTRIBUTE_POSITION) {
        pos
    } else {
        return;
    };

    let dir = Vec3::from(direction).normalize_or_zero();
    for &idx in indices {
        if let Some(pos) = positions.get_mut(idx as usize) {
            let v = Vec3::from(*pos);
            let new_v = v + dir * distance;
            *pos = new_v.to_array();
        }
    }
}

fn perform_subdivide(mesh: &mut Mesh, _level: u32) {
    recalculate_smooth_normals(mesh);
}

fn recalculate_smooth_normals(mesh: &mut Mesh) {
    let positions = if let Some(VertexAttributeValues::Float32x3(ref pos)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        pos.clone()
    } else {
        return;
    };

    let mut normals = vec![[0.0f32; 3]; positions.len()];

    let indices = match mesh.indices() {
        Some(Indices::U32(idx)) => idx.iter().map(|&i| i as usize).collect::<Vec<_>>(),
        Some(Indices::U16(idx)) => idx.iter().map(|&i| i as usize).collect::<Vec<_>>(),
        None => return,
    };

    for face in indices.chunks(3) {
        if face.len() != 3 { continue; }
        let (i0, i1, i2) = (face[0], face[1], face[2]);

        let v0 = Vec3::from(positions[i0]);
        let v1 = Vec3::from(positions[i1]);
        let v2 = Vec3::from(positions[i2]);

        let normal = (v1 - v0).cross(v2 - v0).normalize_or_zero();

        for &i in &[i0, i1, i2] {
            let n = Vec3::from(normals[i]);
            normals[i] = (n + normal).to_array();
        }
    }

    for normal in &mut normals {
        let n = Vec3::from(*normal).normalize_or_zero();
        *normal = n.to_array();
    }

    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
}

fn recalculate_flat_normals(mesh: &mut Mesh) {
    let positions = if let Some(VertexAttributeValues::Float32x3(ref pos)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        pos.clone()
    } else {
        return;
    };

    let mut normals = vec![[0.0f32; 3]; positions.len()];

    let indices = match mesh.indices() {
        Some(Indices::U32(idx)) => idx.iter().map(|&i| i as usize).collect::<Vec<_>>(),
        Some(Indices::U16(idx)) => idx.iter().map(|&i| i as usize).collect::<Vec<_>>(),
        None => return,
    };

    for face in indices.chunks(3) {
        if face.len() != 3 { continue; }
        let (i0, i1, i2) = (face[0], face[1], face[2]);

        let v0 = Vec3::from(positions[i0]);
        let v1 = Vec3::from(positions[i1]);
        let v2 = Vec3::from(positions[i2]);

        let normal = (v1 - v0).cross(v2 - v0).normalize_or_zero().to_array();

        normals[i0] = normal;
        normals[i1] = normal;
        normals[i2] = normal;
    }

    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
}
