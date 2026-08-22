//! Array, combine, and prefab instantiation systems.

use bevy::prelude::*;
use bevy::mesh::Mesh;
use crate::core::{
    entity_factory,
    entity_id::{EntityId, EntityName, EntityVisible},
    history::{EntitySnapshot as HistEntitySnapshot, HistoryStack},
    lighting::LightData,
    material::MaterialData,
    pending_commands::{EntityType, PendingCommands},
    physics::{PhysicsData, PhysicsEnabled},
    scene_graph::SceneGraphCache,
    selection::{Selection, SelectionChangedEvent},
    asset_manager::AssetRef,
    component_carry::{
        build_aux_index, insert_aux_components, insert_base_components, snapshot_entity,
        AuxComponentData, AuxQueries, BaseComponentData,
    },
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
    // One bundled SystemParam rather than a query per component family: the
    // carry list lives in core::component_carry so this system and the delete /
    // duplicate systems cannot drift apart (PF-1193).
    aux_queries: AuxQueries,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use super::events::{emit_array_completed, emit_procedural_mesh_error};

    let aux_index = build_aux_index(&aux_queries);

    for request in pending.array_requests.drain(..) {
        let Some((src_eid, src_name, src_transform, src_entity_type, mesh_h, mat_h, pl, dl, sl, mat_data, light_data, phys_data, phys_enabled, asset_ref)) = query.iter().find(|(eid, ..)| eid.0 == request.entity_id) else {
            emit_procedural_mesh_error(&format!("Source entity not found: {}", request.entity_id));
            continue;
        };

        // Every auxiliary component the source carries, from the single shared
        // list. `active_game_camera` is cleared so an array copy cannot steal
        // the active-camera flag from its source (same rule as duplicate).
        let mut src_aux = aux_index.get(&src_eid.0).cloned().unwrap_or_default();
        src_aux.active_game_camera = false;

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

        let base = BaseComponentData {
            // Array copies spawn EntityVisible::default() (= true) whatever the
            // source's visibility was, matching duplicate. `base.visible` is only
            // read by snapshot_entity, and it must match what was spawned or redo
            // would restore the copies hidden.
            visible: true,
            material_data: mat_data,
            light_data,
            physics_data: phys_data,
            physics_enabled: phys_enabled.is_some(),
            asset_ref,
        };

        let mut created_snapshots = Vec::new();
        let mut created_ids = Vec::new();
        for offset in offsets {
            let new_pos = src_transform.translation + offset;
            let new_transform = Transform {
                translation: new_pos,
                rotation: src_transform.rotation,
                scale: src_transform.scale,
            };
            let new_name = format!("{} (Array)", src_name.0);
            let new_entity_id = EntityId::default();
            let new_entity_id_str = new_entity_id.0.clone();
            created_ids.push(new_entity_id_str.clone());

            let mut ec = commands.spawn((
                entity_type,
                new_entity_id,
                EntityName::new(&new_name),
                EntityVisible::default(),
                new_transform,
            ));

            // Render handles and material stay hand-written: they are Bevy asset
            // handles the copy shares with its source, not carried component data.
            if let Some(m) = mesh_h { ec.insert(m.clone()); }
            if let Some(mat) = mat_h { ec.insert(mat.clone()); }
            if let Some(p) = pl { ec.insert(*p); }
            if let Some(d) = dl { ec.insert(*d); }
            if let Some(s) = sl { ec.insert(*s); }
            if let Some(md) = mat_data { ec.insert(md.clone()); }
            insert_base_components(&mut ec, base);
            insert_aux_components(&mut ec, &src_aux);

            created_snapshots.push(snapshot_entity(
                &new_entity_id_str,
                entity_type,
                &new_name,
                &new_transform,
                base,
                &src_aux,
            ));
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
        &EntityVisible,
        Option<&EntityType>,
        Option<&Mesh3d>,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
        Option<&AssetRef>,
    )>,
    mut selection: ResMut<Selection>,
    mut selection_events: MessageWriter<SelectionChangedEvent>,
    // Single shared carry list — see core::component_carry (PF-1193).
    aux_queries: AuxQueries,
    texture_handles: Res<crate::core::asset_manager::TextureHandleMap>,
    mut history: ResMut<HistoryStack>,
) {
    use crate::core::history::UndoableAction;
    use super::events::{emit_procedural_mesh_created, emit_procedural_mesh_error};

    let aux_index = build_aux_index(&aux_queries);

    for request in pending.combine_requests.drain(..) {
        let mut mesh_list: Vec<(Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>, Transform)> = Vec::new();
        let mut source_snapshots: Vec<HistEntitySnapshot> = Vec::new();
        // The merged entity inherits from ONE source: the first that actually
        // contributed geometry. N sources cannot all win, and "first with
        // geometry" is the only choice a user can predict from the selection
        // order they made.
        let mut primary_aux: Option<AuxComponentData> = None;
        let mut primary_base: Option<BaseComponentData> = None;

        for entity_id in &request.entity_ids {
            if let Some((entity, eid, ename, transform, visible, entity_type, mesh_handle, mat_data, light_data, phys_data, phys_enabled, asset_ref)) = query.iter().find(|(_, eid, ..)| &eid.0 == entity_id) {
                let mut contributed_geometry = false;
                if let Some(mh) = mesh_handle {
                    if let Some(mesh) = meshes.get(&mh.0) {
                        use bevy::mesh::VertexAttributeValues;
                        let positions: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let normals: Vec<[f32; 3]> = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
                            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
                            _ => vec![],
                        };
                        let indices: Vec<u32> = match mesh.indices() {
                            Some(bevy::mesh::Indices::U32(v)) => v.clone(),
                            Some(bevy::mesh::Indices::U16(v)) => v.iter().map(|i| *i as u32).collect(),
                            None => vec![],
                        };
                        mesh_list.push((positions, normals, indices, *transform));
                        contributed_geometry = true;
                    }
                }

                let src_base = BaseComponentData {
                    visible: visible.0,
                    material_data: mat_data,
                    light_data,
                    physics_data: phys_data,
                    physics_enabled: phys_enabled.is_some(),
                    asset_ref,
                };
                let src_aux = aux_index.get(&eid.0).cloned().unwrap_or_default();
                if contributed_geometry && primary_aux.is_none() {
                    primary_aux = Some(src_aux.clone());
                    primary_base = Some(src_base);
                }

                // Source snapshots take the FULL carry set and the source's real
                // entity type: undoing a combine has to give back the entities
                // that were consumed, not stripped stand-ins.
                source_snapshots.push(snapshot_entity(
                    &eid.0,
                    entity_type.copied().unwrap_or(EntityType::Cube),
                    &ename.0,
                    transform,
                    src_base,
                    &src_aux,
                ));

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

        // What the primary source hands down, minus the two EXEMPT lists.
        let result_aux = primary_aux.unwrap_or_default().for_combine_result();
        let result_base = primary_base.unwrap_or_default().for_combine_result();

        // The merged entity keeps the primary's look. Seed the fresh
        // StandardMaterial from that MaterialData here rather than leaving the
        // default gray for `sync_material_data` to fix: that system only runs on
        // `Changed<MaterialData>`, and a value inserted at spawn is not a change
        // it will ever see, so an unseeded result renders gray forever (PF-1225).
        let result_mat_data = result_base.material_data.cloned().unwrap_or_default();
        let mut result_std = StandardMaterial::default();
        crate::core::material::apply_material_data_to_standard(
            &mut result_std,
            &result_mat_data,
            &texture_handles,
        );

        let mut result_commands = commands.spawn((
            EntityType::ProceduralMesh,
            entity_id,
            EntityName::new(&name),
            // Always visible — see COMBINE_RESULT_BASE_EXEMPT's `visible` entry.
            EntityVisible::default(),
            result_mat_data.clone(),
            mesh_data.clone(),
            Mesh3d(meshes.add(combined_mesh)),
            MeshMaterial3d(materials.add(result_std)),
            Transform::default(),
        ));
        insert_base_components(&mut result_commands, result_base);
        insert_aux_components(&mut result_commands, &result_aux);
        let entity = result_commands.id();

        {
            let result_transform = Transform::default();
            // Snapshot the base the result was actually spawned with, not an
            // empty stand-in: redo has to give back the same entity, physics
            // body and material included.
            let mut result_snap = snapshot_entity(
                &entity_id_str,
                EntityType::ProceduralMesh,
                &name,
                &result_transform,
                BaseComponentData {
                    material_data: Some(&result_mat_data),
                    ..result_base
                },
                &result_aux,
            );
            // The merged geometry is the result's own, not carried from a source
            // (procedural_mesh_data is in COMBINE_RESULT_EXEMPT for that reason).
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
        // Reject oversized payloads before deserializing (1 MB limit)
        const MAX_SNAPSHOT_BYTES: usize = 1_048_576;
        if request.snapshot_json.len() > MAX_SNAPSHOT_BYTES {
            log(&format!(
                "Prefab snapshot too large ({} bytes, limit {} bytes) — skipping",
                request.snapshot_json.len(),
                MAX_SNAPSHOT_BYTES
            ));
            continue;
        }
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
