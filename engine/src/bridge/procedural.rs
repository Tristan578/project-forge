//! Procedural mesh generation and CSG operations.

use bevy::prelude::*;
use bevy::render::mesh::Mesh;
use crate::core::{
    self,
    entity_id::{EntityId, EntityName, EntityVisible},
    history::{EntitySnapshot as HistEntitySnapshot, HistoryStack, TransformSnapshot},
    lighting::LightData,
    material::MaterialData,
    audio::AudioData,
    particles::{ParticleData, ParticleEnabled},
    pending_commands::{EntityType, PendingCommands},
    physics::{PhysicsData, PhysicsEnabled},
    scripting::ScriptData,
    selection::{Selection, SelectionChangedEvent},
    shader_effects::ShaderEffectData,
    asset_manager::AssetRef,
};
use wasm_bindgen::prelude::wasm_bindgen;

use super::events;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

/// System that processes pending CSG boolean operation requests (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_csg_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mesh_query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        &EntityVisible,
        Option<&EntityType>,
        Option<&MaterialData>,
        Option<&Mesh3d>,
        Option<&AssetRef>,
    )>,
    // Separate queries for components beyond the 15-tuple limit
    light_query: Query<(&EntityId, Option<&LightData>)>,
    physics_query: Query<(&EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_data_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    mut history: ResMut<HistoryStack>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    for request in pending.csg_requests.drain(..) {
        let operation_name = request.operation;

        // 1. Find both entities
        let entity_a = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_a);
        let entity_b = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_b);

        let (Some(a_data), Some(b_data)) = (entity_a, entity_b) else {
            tracing::warn!("CSG: one or both entities not found");
            events::emit_csg_error("One or both entities not found");
            continue;
        };

        // 2. Get Mesh handles
        let (entity_a_ent, a_eid, a_name, a_transform, a_visible, a_etype,
             a_mat, a_mesh3d, a_asset_ref) = a_data;
        let (entity_b_ent, _b_eid, _b_name, b_transform, _b_visible, _b_etype,
             _b_mat, b_mesh3d, _b_asset_ref) = b_data;

        let Some(a_mesh_handle) = a_mesh3d else {
            tracing::warn!("CSG: entity A has no Mesh3d component");
            events::emit_csg_error("Entity A has no mesh");
            continue;
        };
        let Some(b_mesh_handle) = b_mesh3d else {
            tracing::warn!("CSG: entity B has no Mesh3d component");
            events::emit_csg_error("Entity B has no mesh");
            continue;
        };

        // 3. Get actual Mesh assets
        let Some(a_mesh) = meshes.get(&a_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity A");
            events::emit_csg_error("Could not load mesh for entity A");
            continue;
        };
        let Some(b_mesh) = meshes.get(&b_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity B");
            events::emit_csg_error("Could not load mesh for entity B");
            continue;
        };

        // 4. Convert to csgrs format (world space)
        let csg_a = match core::csg::bevy_mesh_to_csg(a_mesh, a_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity A mesh: {}", e);
                events::emit_csg_error(&format!("Failed to convert mesh A: {}", e));
                continue;
            }
        };
        let csg_b = match core::csg::bevy_mesh_to_csg(b_mesh, b_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity B mesh: {}", e);
                events::emit_csg_error(&format!("Failed to convert mesh B: {}", e));
                continue;
            }
        };

        // 5. Perform CSG operation
        let result_csg = core::csg::perform_csg(&csg_a, &csg_b, operation_name);

        // 6. Convert result back to Bevy Mesh
        let (result_mesh, mesh_data) = match core::csg::csg_to_bevy_mesh(&result_csg) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("CSG: operation produced invalid result: {}", e);
                events::emit_csg_error(&format!("CSG operation failed: {}", e));
                continue;
            }
        };

        // 7. Create result entity
        let result_material = a_mat.cloned().unwrap_or_default();
        let result_entity_id = EntityId::default();
        let result_entity_id_str = result_entity_id.0.clone();
        let result_name = request.result_name.unwrap_or_else(|| {
            let op_name = match operation_name {
                core::csg::CsgOperation::Union => "Union",
                core::csg::CsgOperation::Subtract => "Subtract",
                core::csg::CsgOperation::Intersect => "Intersect",
            };
            format!("{} Result", op_name)
        });

        // Position at identity transform (mesh is already in world space)
        let result_transform = Transform::IDENTITY;

        commands.spawn((
            EntityType::CsgResult,
            result_entity_id.clone(),
            EntityName::new(&result_name),
            EntityVisible::default(),
            result_material.clone(),
            Mesh3d(meshes.add(result_mesh)),
            MeshMaterial3d(materials.add(StandardMaterial::default())),
            result_transform,
            mesh_data.clone(),  // CsgMeshData component
        ));

        // 8. Build helper function for snapshots
        let build_snapshot = |eid: &EntityId, ename: &EntityName, etransform: &Transform,
                              evisible: &EntityVisible, etype: Option<&EntityType>,
                              emat: Option<&MaterialData>, easset: Option<&AssetRef>| -> core::history::EntitySnapshot {
            let light_data = light_query.iter()
                .find(|(lid, _)| lid.0 == eid.0)
                .and_then(|(_, ld)| ld.cloned());

            let (physics_data, physics_enabled) = physics_query.iter()
                .find(|(pid, _, _)| pid.0 == eid.0)
                .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                .unwrap_or((None, false));

            let script_data = script_query.iter()
                .find(|(sid, _)| sid.0 == eid.0)
                .and_then(|(_, sd)| sd.cloned());

            let audio_data = audio_query.iter()
                .find(|(aid, _)| aid.0 == eid.0)
                .and_then(|(_, ad)| ad.cloned());

            let (particle_data, particle_enabled) = particle_query.iter()
                .find(|(pid, _, _)| pid.0 == eid.0)
                .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
                .unwrap_or((None, false));

            let shader_effect_data = shader_query.iter()
                .find(|(sid, _)| sid.0 == eid.0)
                .and_then(|(_, sed)| sed.cloned());

            let csg_mesh_data = csg_data_query.iter()
                .find(|(cid, _)| cid.0 == eid.0)
                .and_then(|(_, cmd)| cmd.cloned());

            let asset_ref = easset.cloned();

            let mut snap = core::history::EntitySnapshot::new(
                eid.0.clone(),
                etype.copied().unwrap_or(EntityType::Cube),
                ename.0.clone(),
                core::history::TransformSnapshot::from(etransform),
            );
            snap.visible = evisible.0;
            snap.material_data = emat.cloned();
            snap.light_data = light_data;
            snap.physics_data = physics_data;
            snap.physics_enabled = physics_enabled;
            snap.asset_ref = asset_ref;
            snap.script_data = script_data;
            snap.audio_data = audio_data;
            snap.particle_data = particle_data;
            snap.particle_enabled = particle_enabled;
            snap.shader_effect_data = shader_effect_data;
            snap.csg_mesh_data = csg_mesh_data;
            snap
        };

        // Build source snapshots if we're deleting them
        let source_a_snapshot = if request.delete_sources {
            Some(build_snapshot(a_eid, a_name, a_transform, a_visible, a_etype, a_mat, a_asset_ref))
        } else {
            None
        };
        let source_b_snapshot = if request.delete_sources {
            // Get b entity data again
            let b_data = mesh_query.iter()
                .find(|(_, eid, ..)| eid.0 == request.entity_id_b)
                .unwrap();
            let (_, b_eid, b_name, b_transform, b_visible, b_etype, b_mat, _, b_asset) = b_data;
            Some(build_snapshot(b_eid, b_name, b_transform, b_visible, b_etype, b_mat, b_asset))
        } else {
            None
        };

        // Build result snapshot
        let result_snapshot = {
            let mut snap = core::history::EntitySnapshot::new(
                result_entity_id_str.clone(),
                EntityType::CsgResult,
                result_name.clone(),
                core::history::TransformSnapshot::from(&result_transform),
            );
            snap.material_data = Some(result_material);
            snap.csg_mesh_data = Some(mesh_data);
            snap
        };

        // 9. Push history action
        history.push(core::history::UndoableAction::CsgOperation {
            source_a_snapshot,
            source_b_snapshot,
            result_snapshot,
            sources_deleted: request.delete_sources,
        });

        // 10. Delete source entities if requested
        if request.delete_sources {
            commands.entity(entity_a_ent).despawn();
            commands.entity(entity_b_ent).despawn();
        }

        // 11. Select the result entity (entity not yet spawned, clear and add ID only)
        selection.clear();
        selection.entity_ids.insert(result_entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![result_entity_id_str.clone()],
            primary_id: Some(result_entity_id_str.clone()),
            primary_name: Some(result_name.clone()),
        });

        // 12. Emit completion event
        events::emit_csg_completed(&result_entity_id_str, &result_name, operation_name);

        tracing::info!("CSG operation completed: {}", result_name);
    }
}

/// System that processes pending extrude requests.
pub(super) fn apply_extrude_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::{emit_procedural_mesh_created, emit_procedural_mesh_error};

    for request in pending.extrude_requests.drain(..) {
        // Parse shape
        let shape = match request.shape.as_str() {
            "circle" => crate::core::procedural_mesh::ExtrudeShape::Circle {
                radius: request.radius,
                segments: request.segments,
            },
            "square" => crate::core::procedural_mesh::ExtrudeShape::Square {
                size: request.size.unwrap_or(1.0),
            },
            "hexagon" => crate::core::procedural_mesh::ExtrudeShape::Hexagon {
                radius: request.radius,
            },
            "star" => crate::core::procedural_mesh::ExtrudeShape::Star {
                outer_radius: request.radius,
                inner_radius: request.inner_radius.unwrap_or(request.radius * 0.5),
                points: request.star_points.unwrap_or(5),
            },
            _ => {
                emit_procedural_mesh_error(&format!("Unknown extrude shape: {}", request.shape));
                continue;
            }
        };

        // Generate mesh
        let mesh = crate::core::procedural_mesh::generate_extrude_mesh(&shape, request.length, request.segments);

        // Extract mesh data for snapshot
        let (positions, normals, uvs, indices) = {
            use bevy::render::mesh::VertexAttributeValues;
            let pos_attr = mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap();
            let norm_attr = mesh.attribute(Mesh::ATTRIBUTE_NORMAL).unwrap();
            let uv_attr = mesh.attribute(Mesh::ATTRIBUTE_UV_0).unwrap();
            let indices = mesh.indices().unwrap();

            let positions: Vec<[f32; 3]> = match pos_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let normals: Vec<[f32; 3]> = match norm_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let uvs: Vec<[f32; 2]> = match uv_attr {
                VertexAttributeValues::Float32x2(v) => v.clone(),
                _ => vec![],
            };
            let indices: Vec<u32> = match indices {
                bevy::render::mesh::Indices::U32(v) => v.clone(),
                bevy::render::mesh::Indices::U16(v) => v.iter().map(|i| *i as u32).collect(),
            };
            (positions, normals, uvs, indices)
        };

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions,
            normals,
            uvs,
            indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Extrude {
                shape: shape.clone(),
                length: request.length,
                segments: request.segments,
            },
        };

        // Create entity
        let name = request.name.unwrap_or_else(|| "Extruded Mesh".to_string());
        let position = request.position.unwrap_or(Vec3::ZERO);
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::from_translation(position),
        )).id();

        // Record in history
        history.push(UndoableAction::ExtrudeShape {
            snapshot: {
                let mut snap = HistEntitySnapshot::new(
                    entity_id_str.clone(),
                    EntityType::ProceduralMesh,
                    name.clone(),
                    TransformSnapshot {
                        position: [position.x, position.y, position.z],
                        rotation: [0.0, 0.0, 0.0, 1.0],
                        scale: [1.0, 1.0, 1.0],
                    },
                );
                snap.material_data = Some(MaterialData::default());
                snap.procedural_mesh_data = Some(mesh_data);
                snap
            },
        });

        // Select the new entity
        selection.entities.clear();
        selection.entity_ids.clear();
        selection.entities.insert(entity);
        selection.entity_ids.insert(entity_id_str.clone());
        selection.primary = Some(entity);
        selection.primary_id = Some(entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![entity_id_str.clone()],
            primary_id: Some(entity_id_str.clone()),
            primary_name: Some(name.clone()),
        });

        emit_procedural_mesh_created(&entity_id_str, &name, "extrude");
    }
}

/// System that processes pending lathe requests.
pub(super) fn apply_lathe_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use events::emit_procedural_mesh_created;

    for request in pending.lathe_requests.drain(..) {
        // Generate mesh
        let mesh = crate::core::procedural_mesh::generate_lathe_mesh(&request.profile, request.segments);

        // Extract mesh data for snapshot
        let (positions, normals, uvs, indices) = {
            use bevy::render::mesh::VertexAttributeValues;
            let pos_attr = mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap();
            let norm_attr = mesh.attribute(Mesh::ATTRIBUTE_NORMAL).unwrap();
            let uv_attr = mesh.attribute(Mesh::ATTRIBUTE_UV_0).unwrap();
            let indices = mesh.indices().unwrap();

            let positions: Vec<[f32; 3]> = match pos_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let normals: Vec<[f32; 3]> = match norm_attr {
                VertexAttributeValues::Float32x3(v) => v.clone(),
                _ => vec![],
            };
            let uvs: Vec<[f32; 2]> = match uv_attr {
                VertexAttributeValues::Float32x2(v) => v.clone(),
                _ => vec![],
            };
            let indices: Vec<u32> = match indices {
                bevy::render::mesh::Indices::U32(v) => v.clone(),
                bevy::render::mesh::Indices::U16(v) => v.iter().map(|i| *i as u32).collect(),
            };
            (positions, normals, uvs, indices)
        };

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions,
            normals,
            uvs,
            indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Lathe {
                profile: request.profile,
                segments: request.segments,
            },
        };

        // Create entity
        let name = request.name.unwrap_or_else(|| "Lathed Mesh".to_string());
        let position = request.position.unwrap_or(Vec3::ZERO);
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::from_translation(position),
        )).id();

        // Record in history
        history.push(UndoableAction::LatheShape {
            snapshot: {
                let mut snap = HistEntitySnapshot::new(
                    entity_id_str.clone(),
                    EntityType::ProceduralMesh,
                    name.clone(),
                    TransformSnapshot {
                        position: [position.x, position.y, position.z],
                        rotation: [0.0, 0.0, 0.0, 1.0],
                        scale: [1.0, 1.0, 1.0],
                    },
                );
                snap.material_data = Some(MaterialData::default());
                snap.procedural_mesh_data = Some(mesh_data);
                snap
            },
        });

        // Select the new entity
        selection.entities.clear();
        selection.entity_ids.clear();
        selection.entities.insert(entity);
        selection.entity_ids.insert(entity_id_str.clone());
        selection.primary = Some(entity);
        selection.primary_id = Some(entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![entity_id_str.clone()],
            primary_id: Some(entity_id_str.clone()),
            primary_name: Some(name.clone()),
        });

        emit_procedural_mesh_created(&entity_id_str, &name, "lathe");
    }
}
