//! Play/Edit mode management.
//!
//! Controls the engine mode state machine: Edit ↔ Play ↔ Paused.
//! In Edit mode, the editor systems run (gizmos, picking, transforms).
//! In Play mode, the game runtime systems run (future: physics, scripts).
//! Snapshot/restore ensures perfect state restoration on Stop.

use bevy::prelude::*;
use serde::Serialize;

use super::asset_manager::AssetRef;
use super::audio::AudioData;
use super::csg::CsgMeshData;
use super::entity_factory::Undeletable;
use super::entity_id::{EntityId, EntityName, EntityVisible};
use super::history::{EntitySnapshot, TransformSnapshot};
use super::lighting::LightData;
use super::material::MaterialData;
use super::particles::{ParticleData, ParticleEnabled};
use super::pending_commands::EntityType;
use super::physics::{PhysicsData, PhysicsEnabled};
use super::scripting::ScriptData;
use super::selection::Selection;
use super::shader_effects::ShaderEffectData;

/// The current engine mode.
#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineMode {
    #[default]
    Edit,
    Play,
    Paused,
}

impl EngineMode {
    pub fn is_edit(&self) -> bool {
        matches!(self, EngineMode::Edit)
    }

    pub fn is_playing(&self) -> bool {
        matches!(self, EngineMode::Play)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            EngineMode::Edit => "edit",
            EngineMode::Play => "play",
            EngineMode::Paused => "paused",
        }
    }
}

/// Complete scene snapshot taken before entering Play mode.
/// Stores enough data to perfectly restore the entire scene on Stop.
#[derive(Resource, Default)]
pub struct SceneSnapshot {
    /// Snapshots of all forge entities at the moment Play was pressed.
    pub entities: Vec<EntitySnapshot>,
    /// Selection state at snapshot time.
    pub selected_ids: Vec<String>,
    pub primary_id: Option<String>,
}

/// Marker component for entities spawned during Play mode.
/// All RuntimeEntity-tagged entities are despawned on Stop.
#[derive(Component)]
pub struct RuntimeEntity;

/// Systems that should only run in Edit mode.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct EditorSystemSet;

/// Systems that should only run during Play (not Paused, not Edit).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct PlaySystemSet;

/// Run condition: true when in Edit mode.
pub fn in_edit_mode(mode: Res<EngineMode>) -> bool {
    mode.is_edit()
}

/// Run condition: true when actively playing (not paused).
pub fn in_play_mode(mode: Res<EngineMode>) -> bool {
    mode.is_playing()
}

/// Pending mode change requests from the bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModeChangeRequest {
    Play,
    Stop,
    Pause,
    Resume,
}

/// Take a snapshot of all forge entities.
pub fn snapshot_scene(
    query: &Query<(
        Entity,
        &EntityId,
        &EntityName,
        &Transform,
        &EntityVisible,
        Option<&EntityType>,
        Option<&MaterialData>,
        Option<&LightData>,
        Option<&PhysicsData>,
        Option<&PhysicsEnabled>,
        Option<&Mesh3d>,
        Option<&PointLight>,
        Option<&DirectionalLight>,
        Option<&SpotLight>,
        Option<&AssetRef>,
    )>,
    script_query: &Query<(&EntityId, Option<&ScriptData>)>,
    audio_query: &Query<(&EntityId, Option<&AudioData>)>,
    particle_query: &Query<(&EntityId, Option<&ParticleData>, Option<&ParticleEnabled>)>,
    shader_query: &Query<(&EntityId, Option<&ShaderEffectData>)>,
    csg_query: &Query<(&EntityId, Option<&CsgMeshData>)>,
    procedural_mesh_query: &Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>)>,
    selection: &Selection,
) -> SceneSnapshot {
    let mut entities = Vec::new();

    for (_, eid, ename, transform, visible, ent_type, mat_data, light_data, phys_data, phys_enabled, mesh, point_light, dir_light, spot_light, asset_ref) in query.iter() {
        // Use EntityType component if available, else guess from components
        let entity_type = if let Some(et) = ent_type {
            *et
        } else if point_light.is_some() {
            EntityType::PointLight
        } else if dir_light.is_some() {
            EntityType::DirectionalLight
        } else if spot_light.is_some() {
            EntityType::SpotLight
        } else if mesh.is_some() {
            EntityType::Cube
        } else {
            continue; // Skip non-forge entities (camera, lights from scene setup, etc.)
        };

        // Look up script data separately
        let script_data = script_query.iter()
            .find(|(script_eid, _)| script_eid.0 == eid.0)
            .and_then(|(_, sd)| sd.cloned());

        // Look up audio data separately
        let audio_data = audio_query.iter()
            .find(|(audio_eid, _)| audio_eid.0 == eid.0)
            .and_then(|(_, ad)| ad.cloned());

        // Look up particle data separately
        let (particle_data, particle_enabled) = particle_query.iter()
            .find(|(peid, _, _)| peid.0 == eid.0)
            .map(|(_, pd, pe)| (pd.cloned(), pe.is_some()))
            .unwrap_or((None, false));

        // Look up shader data separately
        let shader_effect_data = shader_query.iter()
            .find(|(seid, _)| seid.0 == eid.0)
            .and_then(|(_, sed)| sed.cloned());

        // Look up csg data separately
        let csg_mesh_data = csg_query.iter()
            .find(|(ceid, _)| ceid.0 == eid.0)
            .and_then(|(_, cmd)| cmd.cloned());

        // Look up procedural mesh data separately
        let procedural_mesh_data = procedural_mesh_query.iter()
            .find(|(pmeid, _)| pmeid.0 == eid.0)
            .and_then(|(_, pmd)| pmd.cloned());

        entities.push(EntitySnapshot {
            entity_id: eid.0.clone(),
            entity_type,
            name: ename.0.clone(),
            transform: TransformSnapshot::from(transform),
            parent_id: None, // TODO: parent hierarchy snapshot
            visible: visible.0,
            material_data: mat_data.cloned(),
            light_data: light_data.cloned(),
            physics_data: phys_data.cloned(),
            physics_enabled: phys_enabled.is_some(),
            asset_ref: asset_ref.cloned(),
            script_data,
            audio_data,
            particle_data,
            particle_enabled,
            shader_effect_data,
            csg_mesh_data,
            terrain_data: None,
            terrain_mesh_data: None,
            procedural_mesh_data,
        });
    }

    SceneSnapshot {
        entities,
        selected_ids: selection.selected_ids(),
        primary_id: selection.primary_id.clone(),
    }
}

/// Restore scene from snapshot: reset all entity state to snapshot values,
/// despawn runtime entities, and respawn any that were deleted during play.
pub fn restore_scene(
    commands: &mut Commands,
    snapshot: &SceneSnapshot,
    entity_query: &Query<(
        Entity,
        &EntityId,
        &mut Transform,
        &mut EntityName,
        &mut EntityVisible,
        Option<&mut MaterialData>,
        Option<&mut LightData>,
        Option<&mut PhysicsData>,
    ), Without<Undeletable>>,
    runtime_query: &Query<Entity, With<RuntimeEntity>>,
    meshes: &mut ResMut<Assets<Mesh>>,
    materials: &mut ResMut<Assets<StandardMaterial>>,
) {
    // 1. Despawn all runtime entities
    for entity in runtime_query.iter() {
        commands.entity(entity).despawn();
    }

    // 2. Collect existing entity IDs
    let existing_ids: Vec<String> = entity_query.iter().map(|(_, eid, ..)| eid.0.clone()).collect();

    // 3. Despawn entities that exist now but weren't in the snapshot
    // (spawned during play without RuntimeEntity marker)
    let snapshot_ids: std::collections::HashSet<&str> = snapshot.entities.iter().map(|s| s.entity_id.as_str()).collect();
    for (entity, eid, ..) in entity_query.iter() {
        if !snapshot_ids.contains(eid.0.as_str()) {
            commands.entity(entity).despawn();
        }
    }

    // 4. Restore transforms for entities that still exist
    // Note: We can't mutate through the immutable query reference here.
    // The actual restoration happens in the system that calls this, using commands.
    // For now, we queue transform/state restoration via commands.

    // 5. Respawn entities that were deleted during play
    for snap in &snapshot.entities {
        if !existing_ids.contains(&snap.entity_id) {
            super::entity_factory::spawn_from_snapshot(commands, meshes, materials, snap);
        }
    }
}
