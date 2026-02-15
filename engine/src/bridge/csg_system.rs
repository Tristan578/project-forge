//! CSG system implementation for bridge/mod.rs
//!
//! This is a temporary file to construct the apply_csg_requests system.
//! The content will be integrated into bridge/mod.rs.

use bevy::prelude::*;
use crate::core::{
    csg::{self, CsgMeshData, CsgOperation},
    entity_id::{EntityId, EntityName, EntityVisible},
    history::{EntitySnapshot, HistoryStack, TransformSnapshot, UndoableAction},
    lighting::LightData,
    material::MaterialData,
    pending_commands::{EntityType, PendingCommands},
    physics::{PhysicsData, PhysicsEnabled},
    selection::{Selection, SelectionChangedEvent},
    asset_manager::AssetRef,
    audio::AudioData,
    particles::{ParticleData, ParticleEnabled},
    scripting::ScriptData,
    shader_effects::ShaderEffectData,
};

/// System that processes pending CSG boolean operation requests.
#[cfg(not(feature = "runtime"))]
pub fn apply_csg_requests(
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
    )>,
    // Separate queries for components beyond the 15-tuple limit
    light_query: Query<(&EntityId, Option<&LightData>)>,
    physics_query: Query<(&EntityId, Option<&PhysicsData>, Option<&PhysicsEnabled>)>,
    script_query: Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: Query<(&EntityId, Option<&AudioData>)>,
    particle_query: Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_data_query: Query<(&EntityId, Option<&CsgMeshData>)>,
    asset_ref_query: Query<(&EntityId, Option<&AssetRef>)>,
    mesh_assets: Res<Assets<Mesh>>,
    mut history: ResMut<HistoryStack>,
    mut selection: ResMut<Selection>,
    mut selection_events: EventWriter<SelectionChangedEvent>,
) {
    use crate::bridge::events::{emit_csg_completed, emit_csg_error};

    for request in pending.csg_requests.drain(..) {
        let operation_name = request.operation.clone();

        // 1. Find both entities
        let entity_a = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_a);
        let entity_b = mesh_query.iter()
            .find(|(_, eid, ..)| eid.0 == request.entity_id_b);

        let (Some(a_data), Some(b_data)) = (entity_a, entity_b) else {
            tracing::warn!("CSG: one or both entities not found");
            emit_csg_error("One or both entities not found");
            continue;
        };

        // 2. Get Mesh handles
        let (entity_a_ent, a_eid, a_name, a_transform, a_visible, a_etype,
             a_mat, a_mesh3d) = a_data;
        let (entity_b_ent, b_eid, _b_name, b_transform, _b_visible, _b_etype,
             _b_mat, b_mesh3d) = b_data;

        let Some(a_mesh_handle) = a_mesh3d else {
            tracing::warn!("CSG: entity A has no Mesh3d component");
            emit_csg_error("Entity A has no mesh");
            continue;
        };
        let Some(b_mesh_handle) = b_mesh3d else {
            tracing::warn!("CSG: entity B has no Mesh3d component");
            emit_csg_error("Entity B has no mesh");
            continue;
        };

        // 3. Get actual Mesh assets
        let Some(a_mesh) = mesh_assets.get(&a_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity A");
            emit_csg_error("Could not load mesh for entity A");
            continue;
        };
        let Some(b_mesh) = mesh_assets.get(&b_mesh_handle.0) else {
            tracing::warn!("CSG: could not load mesh asset for entity B");
            emit_csg_error("Could not load mesh for entity B");
            continue;
        };

        // 4. Convert to csgrs format (world space)
        let csg_a = match csg::bevy_mesh_to_csg(a_mesh, a_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity A mesh: {}", e);
                emit_csg_error(&format!("Failed to convert mesh A: {}", e));
                continue;
            }
        };
        let csg_b = match csg::bevy_mesh_to_csg(b_mesh, b_transform) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("CSG: failed to convert entity B mesh: {}", e);
                emit_csg_error(&format!("Failed to convert mesh B: {}", e));
                continue;
            }
        };

        // 5. Perform CSG operation
        let result_csg = csg::perform_csg(&csg_a, &csg_b, request.operation);

        // 6. Convert result back to Bevy Mesh
        let (result_mesh, mesh_data) = match csg::csg_to_bevy_mesh(&result_csg) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("CSG: operation produced invalid result: {}", e);
                emit_csg_error(&format!("CSG operation failed: {}", e));
                continue;
            }
        };

        // 7. Create result entity
        let result_material = a_mat.cloned().unwrap_or_default();
        let result_entity_id = EntityId::default();
        let result_entity_id_str = result_entity_id.0.clone();
        let result_name = request.result_name.unwrap_or_else(|| {
            let op_name = match request.operation {
                CsgOperation::Union => "Union",
                CsgOperation::Subtract => "Subtract",
                CsgOperation::Intersect => "Intersect",
            };
            format!("{} Result", op_name)
        });

        // Position at entity A's location in world space (mesh is already in world coords)
        let result_transform = Transform::IDENTITY;

        let result_entity = commands.spawn((
            EntityType::CsgResult,
            result_entity_id.clone(),
            EntityName::new(&result_name),
            EntityVisible::default(),
            result_material.clone(),
            Mesh3d(meshes.add(result_mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: result_material.base_color(),
                metallic: result_material.metallic,
                perceptual_roughness: result_material.roughness,
                ..default()
            })),
            result_transform,
            mesh_data.clone(),  // CsgMeshData component
        )).id();

        // 8. Build snapshots for history
        let build_snapshot = |eid: &EntityId, ename: &EntityName, etransform: &Transform,
                              evisible: &EntityVisible, etype: Option<&EntityType>,
                              emat: Option<&MaterialData>| -> EntitySnapshot {
            // Look up all optional components
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

            let asset_ref = asset_ref_query.iter()
                .find(|(aid, _)| aid.0 == eid.0)
                .and_then(|(_, ar)| ar.cloned());

            EntitySnapshot {
                entity_id: eid.0.clone(),
                entity_type: etype.copied().unwrap_or(EntityType::Cube),
                name: ename.0.clone(),
                transform: TransformSnapshot::from(etransform),
                parent_id: None,
                visible: evisible.0,
                material_data: emat.cloned(),
                light_data,
                physics_data,
                physics_enabled,
                asset_ref,
                script_data,
                audio_data,
                particle_data,
                particle_enabled,
                shader_effect_data,
                csg_mesh_data,
                terrain_data: None,
                terrain_mesh_data: None,
                procedural_mesh_data: None,
                joint_data: None,
                game_components: None,
                animation_clip_data: None,
                game_camera_data: None,
                active_game_camera: false,
                sprite_data: None,
                physics2d_data: None,
                physics2d_enabled: false,
                joint2d_data: None,
            }
        };

        // Build source snapshots if we're deleting them
        let source_a_snapshot = if request.delete_sources {
            Some(build_snapshot(a_eid, a_name, a_transform, a_visible, a_etype, a_mat))
        } else {
            None
        };
        let source_b_snapshot = if request.delete_sources {
            // Need to get b entity data
            let b_data = mesh_query.iter()
                .find(|(_, eid, ..)| eid.0 == request.entity_id_b)
                .unwrap(); // We already verified it exists above
            let (_, b_eid, b_name, b_transform, b_visible, b_etype, b_mat, _) = b_data;
            Some(build_snapshot(b_eid, b_name, b_transform, b_visible, b_etype, b_mat))
        } else {
            None
        };

        // Build result snapshot
        let result_snapshot = EntitySnapshot {
            entity_id: result_entity_id_str.clone(),
            entity_type: EntityType::CsgResult,
            name: result_name.clone(),
            transform: TransformSnapshot::from(&result_transform),
            parent_id: None,
            visible: true,
            material_data: Some(result_material),
            light_data: None,
            physics_data: None,
            physics_enabled: false,
            asset_ref: None,
            script_data: None,
            audio_data: None,
            particle_data: None,
            particle_enabled: false,
            shader_effect_data: None,
            csg_mesh_data: Some(mesh_data),
            terrain_data: None,
            terrain_mesh_data: None,
            procedural_mesh_data: None,
            joint_data: None,
            game_components: None,
            animation_clip_data: None,
            game_camera_data: None,
            active_game_camera: false,
            sprite_data: None,
            physics2d_data: None,
            physics2d_enabled: false,
            joint2d_data: None,
        };

        // 9. Push history action
        history.push(UndoableAction::CsgOperation {
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

        // 11. Select the result entity
        selection.set_single(result_entity_id_str.clone());
        selection_events.write(SelectionChangedEvent {
            selected_ids: vec![result_entity_id_str.clone()],
            primary_id: Some(result_entity_id_str.clone()),
            primary_name: Some(result_name.clone()),
        });

        // 12. Emit completion event
        emit_csg_completed(&result_entity_id_str, &result_name, operation_name);

        tracing::info!("CSG operation completed: {}", result_name);
    }
}
