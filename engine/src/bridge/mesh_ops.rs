//! Array, combine, and prefab instantiation systems.

use bevy::prelude::*;
use bevy::render::mesh::Mesh;
use crate::core::{
    self,
    entity_factory,
    entity_id::{EntityId, EntityName, EntityVisible},
    history::{EntitySnapshot as HistEntitySnapshot, HistoryStack, TransformSnapshot},
    lighting::LightData,
    material::MaterialData,
    particles::{ParticleData, ParticleEnabled},
    pending_commands::{EntityType, PendingCommands},
    physics::{PhysicsData, PhysicsEnabled},
    scene_graph::SceneGraphCache,
    scripting::ScriptData,
    selection::{Selection, SelectionChangedEvent},
    shader_effects::ShaderEffectData,
    asset_manager::AssetRef,
    audio::{AudioData, AudioEnabled},
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
extern "C" {
    fn log(s: &str);
}

/// System that processes pending array requests (duplicate entity in pattern).
pub(super) fn apply_array_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        Option<&EntityType>,
        Option<&Mesh3d>,
        Option<&MeshMaterial3d<StandardMaterial>>,
        Option<&PointLight>,
        Option<&DirectionalLight>,
        Option<&SpotLight>,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
        Option<&AssetRef>,
    )>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&core::procedural_mesh::ProceduralMeshData>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use super::events::{emit_array_completed, emit_procedural_mesh_error};

    for request in pending.array_requests.drain(..) {
        let source_found = query.iter().find(|(_, eid, ..)| eid.0 == request.entity_id);
        if source_found.is_none() {
            emit_procedural_mesh_error(&format!("Source entity not found: {}", request.entity_id));
            continue;
        }

        let (_src_entity, src_eid, src_name, src_transform, src_entity_type, mesh_h, mat_h, pl, dl, sl, mat_data, light_data, phys_data, phys_enabled, asset_ref) = source_found.unwrap();

        let src_script_data = script_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, sd)| sd.cloned());
        let src_audio_data = audio_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, ad)| ad.cloned());
        let (src_particle_data, src_particle_enabled) = particle_query.iter().find(|(eid, _, _)| eid.0 == src_eid.0).map(|(_, pd, pe)| (pd.cloned(), pe.is_some())).unwrap_or((None, false));
        let src_shader_data = shader_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, sed)| sed.cloned());
        let src_csg_data = csg_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, cmd)| cmd.cloned());
        let src_procedural_mesh_data = procedural_mesh_query.iter().find(|(eid, _)| eid.0 == src_eid.0).and_then(|(_, pmd)| pmd.cloned());

        let entity_type = src_entity_type.copied().unwrap_or(EntityType::Cube);

        let mut offsets: Vec<Vec3> = Vec::new();
        match request.pattern.as_str() {
            "grid" => {
                let count_x = request.count_x.unwrap_or(2).max(1);
                let count_y = request.count_y.unwrap_or(1).max(1);
                let count_z = request.count_z.unwrap_or(2).max(1);
                let spacing_x = request.spacing_x.unwrap_or(2.0);
                let spacing_y = request.spacing_y.unwrap_or(2.0);
                let spacing_z = request.spacing_z.unwrap_or(2.0);

                for x in 0..count_x {
                    for y in 0..count_y {
                        for z in 0..count_z {
                            if x == 0 && y == 0 && z == 0 {
                                continue;
                            }
                            offsets.push(Vec3::new(
                                x as f32 * spacing_x,
                                y as f32 * spacing_y,
                                z as f32 * spacing_z,
                            ));
                        }
                    }
                }
            }
            "circle" => {
                let count = request.circle_count.unwrap_or(8).max(2);
                let radius = request.circle_radius.unwrap_or(5.0);
                for i in 0..count {
                    if i == 0 {
                        continue;
                    }
                    let angle = (i as f32) * std::f32::consts::TAU / (count as f32);
                    offsets.push(Vec3::new(radius * angle.cos(), 0.0, radius * angle.sin()));
                }
            }
            _ => {
                emit_procedural_mesh_error(&format!("Unknown array pattern: {}", request.pattern));
                continue;
            }
        }

        let mut created_snapshots = Vec::new();
        let mut created_ids = Vec::new();
        for offset in offsets {
            let new_pos = src_transform.translation + offset;
            let new_name = format!("{} (Array)", src_name.0);
            let new_entity_id = EntityId::default();
            let new_entity_id_str = new_entity_id.0.clone();
            created_ids.push(new_entity_id_str.clone());

            let mut ec = commands.spawn((
                entity_type,
                new_entity_id,
                EntityName::new(&new_name),
                EntityVisible::default(),
                Transform {
                    translation: new_pos,
                    rotation: src_transform.rotation,
                    scale: src_transform.scale,
                },
            ));

            if let Some(m) = mesh_h { ec.insert(m.clone()); }
            if let Some(mat) = mat_h { ec.insert(mat.clone()); }
            if let Some(p) = pl { ec.insert(p.clone()); }
            if let Some(d) = dl { ec.insert(d.clone()); }
            if let Some(s) = sl { ec.insert(s.clone()); }
            if let Some(md) = mat_data { ec.insert(md.clone()); }
            if let Some(ld) = light_data { ec.insert(ld.clone()); }
            if let Some(pd) = phys_data { ec.insert(pd.clone()); }
            if phys_enabled.is_some() { ec.insert(PhysicsEnabled); }
            if let Some(ar) = asset_ref { ec.insert(ar.clone()); }
            if let Some(ref sd) = src_script_data { ec.insert(sd.clone()); }
            if let Some(ref ad) = src_audio_data { ec.insert(ad.clone()); ec.insert(AudioEnabled); }
            if let Some(ref pd) = src_particle_data { ec.insert(pd.clone()); }
            if src_particle_enabled { ec.insert(ParticleEnabled); }
            if let Some(ref sed) = src_shader_data { ec.insert(sed.clone()); }
            if let Some(ref cmd) = src_csg_data { ec.insert(cmd.clone()); }
            if let Some(ref pmd) = src_procedural_mesh_data { ec.insert(pmd.clone()); }

            {
                let mut snap = HistEntitySnapshot::new(
                    new_entity_id_str,
                    entity_type,
                    new_name,
                    TransformSnapshot {
                        position: [new_pos.x, new_pos.y, new_pos.z],
                        rotation: [src_transform.rotation.x, src_transform.rotation.y, src_transform.rotation.z, src_transform.rotation.w],
                        scale: [src_transform.scale.x, src_transform.scale.y, src_transform.scale.z],
                    },
                );
                snap.material_data = mat_data.cloned();
                snap.light_data = light_data.cloned();
                snap.physics_data = phys_data.cloned();
                snap.physics_enabled = phys_enabled.is_some();
                snap.asset_ref = asset_ref.cloned();
                snap.script_data = src_script_data.clone();
                snap.audio_data = src_audio_data.clone();
                snap.particle_data = src_particle_data.clone();
                snap.particle_enabled = src_particle_enabled;
                snap.shader_effect_data = src_shader_data.clone();
                snap.csg_mesh_data = src_csg_data.clone();
                snap.procedural_mesh_data = src_procedural_mesh_data.clone();
                created_snapshots.push(snap);
            }
        }

        history.push(UndoableAction::ArrayEntity {
            source_id: request.entity_id.clone(),
            created_snapshots,
        });

        emit_array_completed(&request.entity_id, &created_ids);
    }
}

/// System that processes pending combine mesh requests.
pub(super) fn apply_combine_requests(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    query: Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        Option<&Mesh3d>,
        Option<&MaterialData>,
    )>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: Query<(&EntityId, Option<&core::csg::CsgMeshData>)>,
    procedural_mesh_query: Query<(&EntityId, Option<&core::procedural_mesh::ProceduralMeshData>)>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use super::events::{emit_procedural_mesh_created, emit_procedural_mesh_error};

    for request in pending.combine_requests.drain(..) {
        let mut mesh_list: Vec<(Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>, Transform)> = Vec::new();
        let mut source_snapshots: Vec<HistEntitySnapshot> = Vec::new();

        for entity_id in &request.entity_ids {
            if let Some((entity, eid, ename, transform, mesh_handle, mat_data)) = query.iter().find(|(_, eid, ..)| &eid.0 == entity_id) {
                if let Some(mh) = mesh_handle {
                    if let Some(mesh) = meshes.get(&mh.0) {
                        use bevy::render::mesh::VertexAttributeValues;
                        let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let normals: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let indices: Vec<u32> = match mesh.indices() {
                            Some(bevy::render::mesh::Indices::U32(v)) => v.clone(),
                            Some(bevy::render::mesh::Indices::U16(v)) => v.iter().map(|i| *i as u32).collect(),
                            None => vec![],
                        };
                        mesh_list.push((positions, normals, indices, *transform));
                    }
                }

                let src_script_data = script_query.iter().find(|(sid, _)| sid.0 == eid.0).and_then(|(_, sd)| sd.cloned());
                let src_audio_data = audio_query.iter().find(|(aid, _)| aid.0 == eid.0).and_then(|(_, ad)| ad.cloned());
                let (src_particle_data, src_particle_enabled) = particle_query.iter().find(|(pid, _, _)| pid.0 == eid.0).map(|(_, pd, pe)| (pd.cloned(), pe.is_some())).unwrap_or((None, false));
                let src_shader_data = shader_query.iter().find(|(sid, _)| sid.0 == eid.0).and_then(|(_, sed)| sed.cloned());
                let src_csg_data = csg_query.iter().find(|(cid, _)| cid.0 == eid.0).and_then(|(_, cmd)| cmd.cloned());
                let src_procedural_mesh_data = procedural_mesh_query.iter().find(|(pid, _)| pid.0 == eid.0).and_then(|(_, pmd)| pmd.cloned());

                {
                    let mut snap = HistEntitySnapshot::new(
                        eid.0.clone(),
                        EntityType::Cube,
                        ename.0.clone(),
                        TransformSnapshot::from(transform),
                    );
                    snap.material_data = mat_data.cloned();
                    snap.script_data = src_script_data;
                    snap.audio_data = src_audio_data;
                    snap.particle_data = src_particle_data;
                    snap.particle_enabled = src_particle_enabled;
                    snap.shader_effect_data = src_shader_data;
                    snap.csg_mesh_data = src_csg_data;
                    snap.procedural_mesh_data = src_procedural_mesh_data;
                    source_snapshots.push(snap);
                }

                if request.delete_sources {
                    commands.entity(entity).despawn();
                    selection.entities.remove(&entity);
                    selection.entity_ids.remove(entity_id);
                }
            }
        }

        if mesh_list.is_empty() {
            emit_procedural_mesh_error("No valid meshes to combine");
            continue;
        }

        let (combined_positions, combined_normals, combined_indices) = crate::core::procedural_mesh::combine_meshes_data(mesh_list);
        let uv_count = combined_normals.len();

        let mesh_data = crate::core::procedural_mesh::ProceduralMeshData {
            positions: combined_positions,
            normals: combined_normals,
            uvs: vec![[0.0, 0.0]; uv_count],
            indices: combined_indices,
            operation: crate::core::procedural_mesh::ProceduralOp::Combine,
        };

        let combined_mesh = crate::core::procedural_mesh::rebuild_procedural_mesh(&mesh_data);

        let name = request.name.unwrap_or_else(|| "Combined Mesh".to_string());
        let entity_id = EntityId::default();
        let entity_id_str = entity_id.0.clone();

        let entity = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            EntityVisible::default(),
            MaterialData::default(),
            mesh_data.clone(),
            Mesh3d(meshes.add(combined_mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.5, 0.5, 0.5),
                ..default()
            })),
            Transform::default(),
        )).id();

        {
            let mut result_snap = HistEntitySnapshot::new(
                entity_id_str.clone(),
                EntityType::ProceduralMesh,
                name.clone(),
                TransformSnapshot {
                    position: [0.0, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                },
            );
            result_snap.material_data = Some(MaterialData::default());
            result_snap.procedural_mesh_data = Some(mesh_data);
            history.push(UndoableAction::CombineMeshes {
                source_snapshots,
                result_snapshot: result_snap,
            });
        }

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

        emit_procedural_mesh_created(&entity_id_str, &name, "combine");
    }
}

/// System that processes pending instantiate prefab requests.
pub(super) fn apply_instantiate_prefab(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut cache: ResMut<SceneGraphCache>,
) {
    for request in pending.instantiate_prefab_requests.drain(..) {
        // Deserialize the snapshot JSON
        let snapshot: HistEntitySnapshot = match serde_json::from_str(&request.snapshot_json) {
            Ok(s) => s,
            Err(e) => {
                log(&format!("Failed to deserialize prefab snapshot: {}", e));
                continue;
            }
        };

        // Create a mutable copy to apply overrides
        let mut modified_snapshot = snapshot;

        // Override position if provided
        if let Some(pos) = request.position {
            modified_snapshot.transform.position = pos;
        }

        // Override name if provided
        if let Some(name) = request.name {
            modified_snapshot.name = name;
        }

        // Spawn the entity from the snapshot
        let _entity = entity_factory::spawn_from_snapshot(
            &mut commands,
            &mut meshes,
            &mut materials,
            &modified_snapshot,
        );

        // Mark scene graph as dirty to trigger update event
        cache.dirty = true;
    }
}
