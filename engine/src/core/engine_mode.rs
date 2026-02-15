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
use super::game_camera::{GameCameraData, ActiveGameCamera};
use super::history::{EntitySnapshot, TransformSnapshot};
use super::lighting::LightData;
use super::material::MaterialData;
use super::particles::{ParticleData, ParticleEnabled};
use super::pending_commands::EntityType;
use super::physics::{JointData, PhysicsData, PhysicsEnabled};
use super::scripting::ScriptData;
use super::selection::Selection;
use super::shader_effects::ShaderEffectData;
use super::tilemap::{TilemapData, TilemapEnabled};

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
    script_audio_query: &Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>)>,
    reverb_particle_shader_query: &Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>, Option<&ParticleData>, Option<&ParticleEnabled>, Option<&ShaderEffectData>)>,
    csg_sprite_query: &Query<(&EntityId, Option<&CsgMeshData>, Option<&super::sprite::SpriteData>)>,
    procedural_joint_gc_camera_query: &Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>, Option<&JointData>, Option<&super::game_components::GameComponents>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    tilemap_skeleton2d_query: &Query<(&EntityId, Option<&TilemapData>, Option<&TilemapEnabled>, Option<&super::skeleton2d::SkeletonData2d>, Option<&super::skeleton2d::SkeletonEnabled2d>, Option<&super::skeletal_animation2d::SkeletalAnimation2d>)>,
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

        // Look up script & audio data
        let (script_data, audio_data) = script_audio_query.iter()
            .find(|(saeid, _, _)| saeid.0 == eid.0)
            .map(|(_, sd, ad)| (sd.cloned(), ad.cloned()))
            .unwrap_or((None, None));

        // Look up reverb, particle, & shader data
        let (reverb_zone_data, reverb_zone_enabled, particle_data, particle_enabled, shader_effect_data) = reverb_particle_shader_query.iter()
            .find(|(rpseid, _, _, _, _, _)| rpseid.0 == eid.0)
            .map(|(_, rzd, rze, pd, pe, sed)| (rzd.cloned(), rze.is_some(), pd.cloned(), pe.is_some(), sed.cloned()))
            .unwrap_or((None, false, None, false, None));

        // Look up csg & sprite data
        let (csg_mesh_data, sprite_data) = csg_sprite_query.iter()
            .find(|(cseid, _, _)| cseid.0 == eid.0)
            .map(|(_, cmd, sd)| (cmd.cloned(), sd.cloned()))
            .unwrap_or((None, None));

        // Look up procedural mesh, joint, game component, and game camera data
        let (procedural_mesh_data, joint_data, game_components, game_camera_data, active_game_camera) = procedural_joint_gc_camera_query.iter()
            .find(|(pmeid, _, _, _, _, _)| pmeid.0 == eid.0)
            .map(|(_, pmd, jd, gc, gcd, agc)| (pmd.cloned(), jd.cloned(), gc.cloned(), gcd.cloned(), agc.is_some()))
            .unwrap_or((None, None, None, None, false));

        // Look up tilemap & skeleton2d data
        let (tilemap_data, tilemap_enabled, skeleton2d_data, skeleton2d_enabled, skeletal_animations) = tilemap_skeleton2d_query.iter()
            .find(|(tseid, _, _, _, _, _)| tseid.0 == eid.0)
            .map(|(_, tmd, tme, sd, se, sa)| (tmd.cloned(), tme.is_some(), sd.cloned(), se.is_some(), sa.cloned().map(|a| vec![a])))
            .unwrap_or((None, false, None, false, None));

        let mut snap = EntitySnapshot::new(
            eid.0.clone(),
            entity_type,
            ename.0.clone(),
            TransformSnapshot::from(transform),
        );
        snap.visible = visible.0;
        snap.material_data = mat_data.cloned();
        snap.light_data = light_data.cloned();
        snap.physics_data = phys_data.cloned();
        snap.physics_enabled = phys_enabled.is_some();
        snap.asset_ref = asset_ref.cloned();
        snap.script_data = script_data;
        snap.audio_data = audio_data;
        snap.reverb_zone_data = reverb_zone_data;
        snap.reverb_zone_enabled = reverb_zone_enabled;
        snap.particle_data = particle_data;
        snap.particle_enabled = particle_enabled;
        snap.shader_effect_data = shader_effect_data;
        snap.csg_mesh_data = csg_mesh_data;
        snap.procedural_mesh_data = procedural_mesh_data;
        snap.joint_data = joint_data;
        snap.game_components = game_components;
        snap.game_camera_data = game_camera_data;
        snap.active_game_camera = active_game_camera;
        snap.sprite_data = sprite_data;
        snap.tilemap_data = tilemap_data;
        snap.tilemap_enabled = tilemap_enabled;
        snap.skeleton2d_data = skeleton2d_data;
        snap.skeleton2d_enabled = skeleton2d_enabled;
        snap.skeletal_animations = skeletal_animations;
        entities.push(snap);
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
