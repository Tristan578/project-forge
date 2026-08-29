//! Play/Edit mode management.
//!
//! Controls the engine mode state machine: Edit ↔ Play ↔ Paused.
//! In Edit mode, the editor systems run (gizmos, picking, transforms).
//! In Play mode, the game runtime systems run (including physics, scripts).
//! Snapshot/restore ensures perfect state restoration on Stop.

use bevy::prelude::*;
use serde::Serialize;

use super::asset_manager::AssetRef;
use super::audio::{AudioData, AudioEnabled};
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
use super::lod::LodData;
use super::physics_2d::{Physics2dData, Physics2dEnabled, PhysicsJoint2d};
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

/// Editor sub-set for systems that mutate ECS components (runs first).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct EditorApplySet;

/// Editor sub-set for read-only emit/sync systems (runs after EditorApplySet).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct EditorEmitSet;

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
    script_audio_query: &Query<(&EntityId, Option<&ScriptData>, Option<&AudioData>, Option<&AudioEnabled>)>,
    reverb_particle_shader_query: &Query<(&EntityId, Option<&super::reverb_zone::ReverbZoneData>, Option<&super::reverb_zone::ReverbZoneEnabled>, Option<&ParticleData>, Option<&ParticleEnabled>, Option<&ShaderEffectData>)>,
    csg_sprite_physics2d_query: &Query<(&EntityId, Option<&CsgMeshData>, Option<&super::sprite::SpriteData>, Option<&Physics2dData>, Option<&Physics2dEnabled>, Option<&PhysicsJoint2d>)>,
    procedural_joint_gc_camera_query: &Query<(&EntityId, Option<&super::procedural_mesh::ProceduralMeshData>, Option<&JointData>, Option<&super::game_components::GameComponents>, Option<&GameCameraData>, Option<&ActiveGameCamera>)>,
    tilemap_skeleton2d_query: &Query<(&EntityId, Option<&TilemapData>, Option<&TilemapEnabled>, Option<&super::skeleton2d::SkeletonData2d>, Option<&super::skeleton2d::SkeletonEnabled2d>, Option<&super::skeletal_animation2d::SkeletalAnimation2d>, Option<&LodData>)>,
    selection: &Selection,
) -> SceneSnapshot {
    use std::collections::HashMap;

    // Materialize each secondary query into a HashMap keyed by entity-ID string.
    // This converts N×M inner-loop lookups (O(N²)) to O(N) total.
    type ScriptAudioRow = (Option<ScriptData>, Option<AudioData>, bool);
    let script_audio_map: HashMap<&str, ScriptAudioRow> = script_audio_query.iter()
        .map(|(eid, sd, ad, ae)| (eid.0.as_str(), (sd.cloned(), ad.cloned(), ae.is_some())))
        .collect();

    type ReverbParticleShaderRow = (Option<super::reverb_zone::ReverbZoneData>, bool, Option<ParticleData>, bool, Option<ShaderEffectData>);
    let reverb_particle_shader_map: HashMap<&str, ReverbParticleShaderRow> = reverb_particle_shader_query.iter()
        .map(|(eid, rzd, rze, pd, pe, sed)| (eid.0.as_str(), (rzd.cloned(), rze.is_some(), pd.cloned(), pe.is_some(), sed.cloned())))
        .collect();

    type CsgSpritePhysics2dRow = (Option<CsgMeshData>, Option<super::sprite::SpriteData>, Option<Physics2dData>, bool, Option<PhysicsJoint2d>);
    let csg_sprite_physics2d_map: HashMap<&str, CsgSpritePhysics2dRow> = csg_sprite_physics2d_query.iter()
        .map(|(eid, cmd, sd, p2d, p2e, j2d)| (eid.0.as_str(), (cmd.cloned(), sd.cloned(), p2d.cloned(), p2e.is_some(), j2d.cloned())))
        .collect();

    type ProceduralJointGcCameraRow = (Option<super::procedural_mesh::ProceduralMeshData>, Option<JointData>, Option<super::game_components::GameComponents>, Option<GameCameraData>, bool);
    let procedural_joint_gc_camera_map: HashMap<&str, ProceduralJointGcCameraRow> = procedural_joint_gc_camera_query.iter()
        .map(|(eid, pmd, jd, gc, gcd, agc)| (eid.0.as_str(), (pmd.cloned(), jd.cloned(), gc.cloned(), gcd.cloned(), agc.is_some())))
        .collect();

    type TilemapSkeleton2dRow = (Option<TilemapData>, bool, Option<super::skeleton2d::SkeletonData2d>, bool, Option<Vec<super::skeletal_animation2d::SkeletalAnimation2d>>, Option<LodData>);
    let tilemap_skeleton2d_map: HashMap<&str, TilemapSkeleton2dRow> = tilemap_skeleton2d_query.iter()
        .map(|(eid, tmd, tme, sd, se, sa, ld)| (eid.0.as_str(), (tmd.cloned(), tme.is_some(), sd.cloned(), se.is_some(), sa.cloned().map(|a| vec![a]), ld.cloned())))
        .collect();

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

        // O(1) lookups via pre-built HashMaps (was O(N) per entity)
        let (script_data, audio_data, audio_enabled) = script_audio_map.get(eid.0.as_str())
            .map(|(sd, ad, ae)| (sd.clone(), ad.clone(), *ae))
            .unwrap_or((None, None, false));

        let (reverb_zone_data, reverb_zone_enabled, particle_data, particle_enabled, shader_effect_data) = reverb_particle_shader_map.get(eid.0.as_str())
            .map(|(rzd, rze, pd, pe, sed)| (rzd.clone(), *rze, pd.clone(), *pe, sed.clone()))
            .unwrap_or((None, false, None, false, None));

        let (csg_mesh_data, sprite_data, physics2d_data_pre, physics2d_enabled_pre, joint2d_data_pre) = csg_sprite_physics2d_map.get(eid.0.as_str())
            .map(|(cmd, sd, p2d, p2e, j2d)| (cmd.clone(), sd.clone(), p2d.clone(), *p2e, j2d.clone()))
            .unwrap_or((None, None, None, false, None));

        let (procedural_mesh_data, joint_data, game_components, game_camera_data, active_game_camera) = procedural_joint_gc_camera_map.get(eid.0.as_str())
            .map(|(pmd, jd, gc, gcd, agc)| (pmd.clone(), jd.clone(), gc.clone(), gcd.clone(), *agc))
            .unwrap_or((None, None, None, None, false));

        let (tilemap_data, tilemap_enabled, skeleton2d_data, skeleton2d_enabled, skeletal_animations, lod_data) = tilemap_skeleton2d_map.get(eid.0.as_str())
            .map(|(tmd, tme, sd, se, sa, ld)| (tmd.clone(), *tme, sd.clone(), *se, sa.clone(), ld.clone()))
            .unwrap_or((None, false, None, false, None, None));

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
        // EntitySnapshot::new defaults audio_enabled to true (serde back-compat
        // for scenes saved before the field existed), so this assignment is
        // load-bearing: without it a muted entity comes back playing on
        // Play→Stop, the same enablement-marker trap PF-1193 fixed elsewhere.
        snap.audio_enabled = audio_enabled;
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
        snap.lod_data = lod_data;
        snap.physics2d_data = physics2d_data_pre;
        snap.physics2d_enabled = physics2d_enabled_pre;
        snap.joint2d_data = joint2d_data_pre;
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
    entity_query: &mut Query<(
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

    // 4. Restore transforms and base component data for entities that still exist.
    // Build a map from entity_id -> snapshot for O(1) lookups.
    let snapshot_map: std::collections::HashMap<&str, &EntitySnapshot> = snapshot.entities.iter()
        .map(|s| (s.entity_id.as_str(), s))
        .collect();

    for (entity, eid, mut transform, mut name, mut visible, mat_data, light_data, phys_data) in entity_query.iter_mut() {
        if let Some(snap) = snapshot_map.get(eid.0.as_str()) {
            // Restore transform
            *transform = snap.transform.to_transform();
            // Restore name
            name.0 = snap.name.clone();
            // Restore visibility
            visible.0 = snap.visible;

            // Restore material data if present on entity and in snapshot
            if let (Some(mut mat), Some(ref snap_mat)) = (mat_data, &snap.material_data) {
                *mat = snap_mat.clone();
            }
            // Restore light data if present on entity and in snapshot
            if let (Some(mut light), Some(ref snap_light)) = (light_data, &snap.light_data) {
                *light = snap_light.clone();
            }
            // Restore physics data if present on entity and in snapshot
            if let (Some(mut phys), Some(ref snap_phys)) = (phys_data, &snap.physics_data) {
                *phys = snap_phys.clone();
            }
            // For components not in the query (script, audio, particles, etc.),
            // commands.entity().insert() is used to queue the restore.
            if let Some(ref snap_script) = snap.script_data {
                commands.entity(entity).insert(snap_script.clone());
            }
            if let Some(ref snap_audio) = snap.audio_data {
                commands.entity(entity).insert(snap_audio.clone());
            }
            // The marker is a separate component from the data, so it needs the
            // same insert/remove pair every other marker here uses — an entity
            // muted during Play must stay muted after Stop, and one unmuted
            // during Play must not be left with a stale marker.
            if snap.audio_data.is_some() && snap.audio_enabled {
                commands.entity(entity).insert(AudioEnabled);
            } else {
                commands.entity(entity).remove::<AudioEnabled>();
            }
            if let Some(ref snap_particle) = snap.particle_data {
                commands.entity(entity).insert(snap_particle.clone());
            }
            // Restore ParticleEnabled marker (was missing — particles stopped after Play→Stop)
            if snap.particle_enabled {
                commands.entity(entity).insert(ParticleEnabled);
            } else {
                commands.entity(entity).remove::<ParticleEnabled>();
            }
            if let Some(ref rzd) = snap.reverb_zone_data {
                commands.entity(entity).insert(rzd.clone());
            }
            // Restore marker components — insert when enabled, REMOVE when disabled
            // (without remove, components enabled before play but disabled during play
            // would remain enabled after stop, corrupting scene state)
            if snap.reverb_zone_enabled {
                commands.entity(entity).insert(super::reverb_zone::ReverbZoneEnabled);
            } else {
                commands.entity(entity).remove::<super::reverb_zone::ReverbZoneEnabled>();
            }
            if let Some(ref sed) = snap.shader_effect_data {
                commands.entity(entity).insert(sed.clone());
            }
            if let Some(ref jd) = snap.joint_data {
                commands.entity(entity).insert(jd.clone());
            }
            if let Some(ref gc) = snap.game_components {
                commands.entity(entity).insert(gc.clone());
            }
            if let Some(ref gcd) = snap.game_camera_data {
                commands.entity(entity).insert(gcd.clone());
            }
            if snap.active_game_camera {
                commands.entity(entity).insert(ActiveGameCamera);
            } else {
                commands.entity(entity).remove::<ActiveGameCamera>();
            }
            if let Some(ref sd) = snap.sprite_data {
                commands.entity(entity).insert(sd.clone());
            }
            if let Some(ref tmd) = snap.tilemap_data {
                commands.entity(entity).insert(tmd.clone());
            }
            if snap.tilemap_enabled {
                commands.entity(entity).insert(TilemapEnabled);
            } else {
                commands.entity(entity).remove::<TilemapEnabled>();
            }
            if let Some(ref s2d) = snap.skeleton2d_data {
                commands.entity(entity).insert(s2d.clone());
            }
            if snap.skeleton2d_enabled {
                commands.entity(entity).insert(super::skeleton2d::SkeletonEnabled2d);
            } else {
                commands.entity(entity).remove::<super::skeleton2d::SkeletonEnabled2d>();
            }
            // `snapshot_scene` captures `skeletal_animations` above, and every
            // other field materialized from the same query row (tilemap_data,
            // skeleton2d_data, lod_data) is restored here — this one was
            // captured and then dropped, so a rigged 2D entity lost its
            // animation on Play→Stop. Both sibling rebuild paths already carry
            // it (`entity_factory::spawn_from_snapshot`,
            // `component_carry::insert_aux_components`), including the same
            // "the ECS holds at most one, the snapshot stores a Vec to match
            // the file format" contract.
            if let Some(anim) = snap.skeletal_animations.as_ref().and_then(|a| a.first()) {
                commands.entity(entity).insert(anim.clone());
            }
            if let Some(ref ld) = snap.lod_data {
                commands.entity(entity).insert(ld.clone());
            }
            if snap.physics_enabled {
                commands.entity(entity).insert(PhysicsEnabled);
            } else {
                commands.entity(entity).remove::<PhysicsEnabled>();
            }
        }
    }

    // 5. Respawn entities that were deleted during play
    for snap in &snapshot.entities {
        if !existing_ids.contains(&snap.entity_id) {
            super::entity_factory::spawn_from_snapshot(commands, meshes, materials, snap);
        }
    }
}

#[cfg(test)]
mod scene_round_trip_tests {
    //! Behavioural coverage for the Edit → Play → Stop scene round trip.
    //!
    //! [`snapshot_scene`] captures the scene the instant Play is pressed and
    //! [`restore_scene`] rebuilds it on Stop. Anything the pair drops is silent
    //! user data loss that only surfaces *after* someone plays their game, so
    //! every assertion here is on a restored component VALUE, never on an
    //! entity count alone.
    //!
    //! Fixtures are deliberately built OFF the component defaults. A test whose
    //! expected value happens to equal `Default::default()` is satisfied by a
    //! regression that inserts a blank struct, which is exactly the failure mode
    //! this module exists to catch (same warning as
    //! `entity_factory::physics2d_history_tests`).
    //!
    //! Both functions take `&Query<..>` rather than `SystemParam`s, so the tests
    //! drive them through the two thin wrapper systems below — the same shapes
    //! `bridge::core_systems::apply_mode_change_requests` passes at the real
    //! call site.

    use super::*;
    use crate::core::game_camera::GameCameraMode;
    use crate::core::game_components::{
        GameComponentData, GameComponents, HealthData, WinConditionData, WinConditionType,
    };
    use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled};
    use crate::core::skeletal_animation2d::{BoneKeyframe, EasingType2d, SkeletalAnimation2d};
    use crate::core::skeleton2d::{SkeletonData2d, SkeletonEnabled2d};
    use crate::core::sprite::{SpriteAnchor, SpriteData};
    use std::collections::HashMap;

    // ---------------------------------------------------------------------
    // Harness
    // ---------------------------------------------------------------------

    /// Writes the Play-time snapshot into the `SceneSnapshot` resource, exactly
    /// as the bridge does on `ModeChangeRequest::Play`.
    #[allow(clippy::type_complexity, clippy::too_many_arguments)]
    fn snapshot_system(
        query: Query<(
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
        script_audio_query: Query<(
            &EntityId,
            Option<&ScriptData>,
            Option<&AudioData>,
            Option<&AudioEnabled>,
        )>,
        reverb_particle_shader_query: Query<(
            &EntityId,
            Option<&ReverbZoneData>,
            Option<&ReverbZoneEnabled>,
            Option<&ParticleData>,
            Option<&ParticleEnabled>,
            Option<&ShaderEffectData>,
        )>,
        csg_sprite_physics2d_query: Query<(
            &EntityId,
            Option<&CsgMeshData>,
            Option<&SpriteData>,
            Option<&Physics2dData>,
            Option<&Physics2dEnabled>,
            Option<&PhysicsJoint2d>,
        )>,
        procedural_joint_gc_camera_query: Query<(
            &EntityId,
            Option<&crate::core::procedural_mesh::ProceduralMeshData>,
            Option<&JointData>,
            Option<&GameComponents>,
            Option<&GameCameraData>,
            Option<&ActiveGameCamera>,
        )>,
        tilemap_skeleton2d_query: Query<(
            &EntityId,
            Option<&TilemapData>,
            Option<&TilemapEnabled>,
            Option<&SkeletonData2d>,
            Option<&SkeletonEnabled2d>,
            Option<&SkeletalAnimation2d>,
            Option<&LodData>,
        )>,
        selection: Res<Selection>,
        mut out: ResMut<SceneSnapshot>,
    ) {
        *out = snapshot_scene(
            &query,
            &script_audio_query,
            &reverb_particle_shader_query,
            &csg_sprite_physics2d_query,
            &procedural_joint_gc_camera_query,
            &tilemap_skeleton2d_query,
            &selection,
        );
    }

    /// Rebuilds the scene from the stored snapshot, as the bridge does on
    /// `ModeChangeRequest::Stop`.
    #[allow(clippy::type_complexity)]
    fn restore_system(
        mut commands: Commands,
        snapshot: Res<SceneSnapshot>,
        mut entity_query: Query<
            (
                Entity,
                &EntityId,
                &mut Transform,
                &mut EntityName,
                &mut EntityVisible,
                Option<&mut MaterialData>,
                Option<&mut LightData>,
                Option<&mut PhysicsData>,
            ),
            Without<Undeletable>,
        >,
        runtime_query: Query<Entity, With<RuntimeEntity>>,
        mut meshes: ResMut<Assets<Mesh>>,
        mut materials: ResMut<Assets<StandardMaterial>>,
    ) {
        restore_scene(
            &mut commands,
            &snapshot,
            &mut entity_query,
            &runtime_query,
            &mut meshes,
            &mut materials,
        );
    }

    fn test_world() -> World {
        let mut world = World::new();
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world.insert_resource(Selection::default());
        world.insert_resource(SceneSnapshot::default());
        world
    }

    /// Press Play: capture the scene.
    fn press_play(world: &mut World) {
        let mut schedule = Schedule::default();
        schedule.add_systems(snapshot_system);
        schedule.run(world);
    }

    /// Press Stop: rebuild the scene from the captured snapshot.
    fn press_stop(world: &mut World) {
        let mut schedule = Schedule::default();
        schedule.add_systems(restore_system);
        schedule.run(world);
        // `restore_scene` queues respawns and component inserts through
        // `Commands`; the assertions that follow must see them applied.
        world.flush();
    }

    /// Entities are addressed by their string `EntityId`, never their `Entity` —
    /// one deleted during Play comes back with a fresh `Entity` index.
    fn lookup(world: &mut World, id: &str) -> Option<Entity> {
        let mut query = world.query::<(Entity, &EntityId)>();
        query
            .iter(world)
            .find(|(_, eid)| eid.0 == id)
            .map(|(entity, _)| entity)
    }

    fn find(world: &mut World, id: &str) -> Entity {
        lookup(world, id).unwrap_or_else(|| panic!("no entity with EntityId {id}"))
    }

    fn count_with_id(world: &mut World, id: &str) -> usize {
        let mut query = world.query::<&EntityId>();
        query.iter(world).filter(|eid| eid.0 == id).count()
    }

    fn get<T: Component + Clone>(world: &mut World, id: &str) -> Option<T> {
        let entity = find(world, id);
        world.entity(entity).get::<T>().cloned()
    }

    fn has<T: Component>(world: &mut World, id: &str) -> bool {
        let entity = find(world, id);
        world.entity(entity).contains::<T>()
    }

    // ---------------------------------------------------------------------
    // Fixtures — every value below is off its type's Default on purpose.
    // ---------------------------------------------------------------------

    fn authored_transform() -> Transform {
        Transform {
            translation: Vec3::new(1.5, -2.25, 3.75),
            rotation: Quat::from_rotation_y(std::f32::consts::FRAC_PI_3),
            scale: Vec3::new(2.0, 0.5, 4.0),
        }
    }

    fn authored_material() -> MaterialData {
        MaterialData {
            base_color: [0.11, 0.22, 0.33, 0.44],
            metallic: 0.77,
            perceptual_roughness: 0.13,
            emissive: [0.9, 0.1, 0.2, 1.0],
            double_sided: true,
            ..Default::default()
        }
    }

    fn authored_physics() -> PhysicsData {
        PhysicsData {
            restitution: 0.91,
            friction: 0.07,
            density: 4.25,
            gravity_scale: 2.5,
            lock_rotation_y: true,
            is_sensor: true,
            ..Default::default()
        }
    }

    fn authored_script() -> ScriptData {
        ScriptData {
            source: "forge.entity.setPosition(0, 10, 0);".to_string(),
            enabled: true,
            template: Some("patrol".to_string()),
        }
    }

    fn authored_audio() -> AudioData {
        AudioData {
            asset_id: Some("asset-theme".to_string()),
            volume: 0.42,
            pitch: 1.75,
            loop_audio: true,
            spatial: true,
            bus: "music".to_string(),
            ..Default::default()
        }
    }

    fn authored_particles() -> ParticleData {
        ParticleData {
            max_particles: 77,
            lifetime_min: 3.5,
            lifetime_max: 9.5,
            linear_drag: 0.35,
            size_start: 2.5,
            world_space: false,
            ..Default::default()
        }
    }

    fn authored_game_components() -> GameComponents {
        let mut gc = GameComponents::default();
        gc.add(GameComponentData::Health(HealthData {
            max_hp: 55.0,
            current_hp: 55.0,
            invincibility_secs: 1.25,
            respawn_on_death: false,
            respawn_point: [3.0, 4.0, 5.0],
            despawn_on_death: false,
        }));
        gc.add(GameComponentData::WinCondition(WinConditionData {
            condition_type: WinConditionType::Score,
            target_score: Some(37),
            target_entity_id: None,
        }));
        gc
    }

    fn authored_game_camera() -> GameCameraData {
        GameCameraData {
            mode: GameCameraMode::ThirdPersonFollow {
                offset: Vec3::new(1.5, 9.0, -3.25),
                damping: 7.5,
                min_distance: 1.25,
                max_distance: 22.0,
                look_at_target: false,
                collision_avoidance: false,
            },
            target_entity: Some("hero".to_string()),
            ..Default::default()
        }
    }

    fn authored_light() -> LightData {
        LightData {
            intensity: 4_242.0,
            color: [0.25, 0.5, 0.75],
            shadows_enabled: true,
            range: 33.0,
            radius: 1.5,
            ..LightData::point()
        }
    }

    fn authored_skeletal_animation() -> SkeletalAnimation2d {
        let mut tracks = HashMap::new();
        tracks.insert(
            "arm".to_string(),
            vec![BoneKeyframe {
                time: 0.75,
                position: Some([3.0, 4.0]),
                rotation: Some(1.25),
                scale: Some([2.0, 2.0]),
                easing: EasingType2d::EaseInOut,
            }],
        );
        SkeletalAnimation2d {
            name: "wave".to_string(),
            duration: 2.75,
            looping: true,
            tracks,
        }
    }

    fn authored_lod() -> LodData {
        LodData {
            lod_distances: [7.0, 17.0, 27.0],
            auto_generate: true,
            lod_ratios: [0.8, 0.4, 0.2],
            current_lod: 2,
        }
    }

    fn authored_sprite() -> SpriteData {
        SpriteData {
            texture_asset_id: Some("asset-hero-sheet".to_string()),
            color_tint: [0.1, 0.2, 0.3, 0.9],
            flip_x: true,
            flip_y: false,
            custom_size: Some([3.5, 6.5]),
            sorting_layer: "foreground".to_string(),
            sorting_order: 12,
            anchor: SpriteAnchor::TopLeft,
        }
    }

    fn authored_reverb() -> ReverbZoneData {
        ReverbZoneData {
            preset: "cave".to_string(),
            wet_mix: 0.83,
            decay_time: 6.5,
            pre_delay: 45.0,
            blend_radius: 3.25,
            priority: 7,
            ..Default::default()
        }
    }

    /// The full-fat authored entity: everything the round trip is supposed to
    /// carry, on one `EntityType::Cube`.
    fn spawn_hero(world: &mut World) -> Entity {
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world
            .spawn((
                // Bevy caps a flat bundle tuple at 15 elements; the nesting is
                // purely to get past that, not a grouping with any meaning.
                (
                    EntityType::Cube,
                    EntityId("hero".to_string()),
                    EntityName::new("Hero"),
                    EntityVisible(false),
                    authored_transform(),
                    Mesh3d(mesh),
                ),
                (
                    authored_material(),
                    authored_physics(),
                    PhysicsEnabled,
                    authored_script(),
                    authored_audio(),
                    AudioEnabled,
                ),
                (
                    authored_particles(),
                    ParticleEnabled,
                    authored_game_components(),
                    authored_game_camera(),
                    ActiveGameCamera,
                    authored_lod(),
                    authored_skeletal_animation(),
                ),
            ))
            .id()
    }

    fn spawn_lamp(world: &mut World) -> Entity {
        world
            .spawn((
                EntityType::PointLight,
                EntityId("lamp".to_string()),
                EntityName::new("Lamp"),
                EntityVisible(true),
                Transform::from_xyz(-4.0, 6.0, 8.0),
                authored_light(),
                PointLight::default(),
            ))
            .id()
    }

    // ---------------------------------------------------------------------
    // Full round trip
    // ---------------------------------------------------------------------

    #[test]
    fn a_full_scene_round_trips_every_field_through_play_and_stop() {
        let mut world = test_world();
        let hero = spawn_hero(&mut world);
        let lamp = spawn_lamp(&mut world);

        press_play(&mut world);

        // --- Play wrecks the scene, the way a running game does. ---
        {
            let mut hero_mut = world.entity_mut(hero);
            *hero_mut.get_mut::<Transform>().unwrap() = Transform::from_xyz(99.0, 99.0, 99.0);
            hero_mut.get_mut::<EntityName>().unwrap().0 = "Corpse".to_string();
            hero_mut.get_mut::<EntityVisible>().unwrap().0 = true;
            hero_mut.get_mut::<MaterialData>().unwrap().metallic = 0.0;
            hero_mut.get_mut::<PhysicsData>().unwrap().friction = 0.999;
            // Data components the runtime can drop outright.
            hero_mut.remove::<ScriptData>();
            hero_mut.remove::<AudioData>();
            hero_mut.remove::<AudioEnabled>();
            hero_mut.remove::<ParticleData>();
            hero_mut.remove::<ParticleEnabled>();
            hero_mut.remove::<GameComponents>();
            hero_mut.remove::<GameCameraData>();
            hero_mut.remove::<ActiveGameCamera>();
            hero_mut.remove::<PhysicsEnabled>();
            hero_mut.remove::<LodData>();
            hero_mut.remove::<SkeletalAnimation2d>();
        }
        world
            .entity_mut(lamp)
            .get_mut::<LightData>()
            .unwrap()
            .intensity = 1.0;

        press_stop(&mut world);

        // --- Base component set ---
        let restored_transform = get::<Transform>(&mut world, "hero").unwrap();
        let expected = authored_transform();
        assert_eq!(restored_transform.translation, expected.translation);
        assert_eq!(restored_transform.scale, expected.scale);
        assert!(
            restored_transform
                .rotation
                .abs_diff_eq(expected.rotation, 1e-6),
            "rotation must survive the quaternion round trip, got {:?}",
            restored_transform.rotation
        );
        assert_eq!(get::<EntityName>(&mut world, "hero").unwrap().0, "Hero");
        assert!(
            !get::<EntityVisible>(&mut world, "hero").unwrap().0,
            "an entity hidden in the editor must not come back visible"
        );

        // --- Material / physics (restored in place through the mutable query) ---
        assert_eq!(
            get::<MaterialData>(&mut world, "hero").unwrap().metallic,
            authored_material().metallic
        );
        assert_eq!(
            get::<PhysicsData>(&mut world, "hero").unwrap(),
            authored_physics()
        );
        assert!(has::<PhysicsEnabled>(&mut world, "hero"));

        // --- Light data on the second entity ---
        assert_eq!(
            get::<LightData>(&mut world, "lamp").unwrap().intensity,
            authored_light().intensity
        );

        // --- Data components re-inserted through `Commands` ---
        let script = get::<ScriptData>(&mut world, "hero").expect("ScriptData must be restored");
        assert_eq!(script.source, authored_script().source);
        assert_eq!(script.template, authored_script().template);
        assert!(script.enabled);

        let audio = get::<AudioData>(&mut world, "hero").expect("AudioData must be restored");
        assert_eq!(audio.volume, authored_audio().volume);
        assert_eq!(audio.bus, authored_audio().bus);
        assert_eq!(audio.asset_id, authored_audio().asset_id);
        assert!(has::<AudioEnabled>(&mut world, "hero"));

        let particles =
            get::<ParticleData>(&mut world, "hero").expect("ParticleData must be restored");
        assert_eq!(particles.max_particles, authored_particles().max_particles);
        assert_eq!(particles.lifetime_max, authored_particles().lifetime_max);
        assert!(has::<ParticleEnabled>(&mut world, "hero"));

        let gc =
            get::<GameComponents>(&mut world, "hero").expect("GameComponents must be restored");
        match gc.get("health").expect("health component must be restored") {
            GameComponentData::Health(h) => {
                assert_eq!(h.max_hp, 55.0);
                assert_eq!(h.respawn_point, [3.0, 4.0, 5.0]);
                assert!(!h.despawn_on_death);
            }
            other => panic!("expected health, got {other:?}"),
        }
        match gc
            .get("win_condition")
            .expect("win condition must be restored")
        {
            GameComponentData::WinCondition(w) => assert_eq!(w.target_score, Some(37)),
            other => panic!("expected win_condition, got {other:?}"),
        }

        let camera =
            get::<GameCameraData>(&mut world, "hero").expect("GameCameraData must be restored");
        assert_eq!(camera.mode, authored_game_camera().mode);
        assert_eq!(camera.target_entity, authored_game_camera().target_entity);
        assert!(has::<ActiveGameCamera>(&mut world, "hero"));

        let lod = get::<LodData>(&mut world, "hero").expect("LodData must be restored");
        assert_eq!(lod.lod_distances, authored_lod().lod_distances);
        assert_eq!(lod.current_lod, authored_lod().current_lod);

        let anim = get::<SkeletalAnimation2d>(&mut world, "hero")
            .expect("SkeletalAnimation2d is captured by snapshot_scene, so Stop must put it back");
        assert_eq!(anim.name, "wave");
        assert_eq!(anim.duration, 2.75);
        assert!(anim.looping);
        assert_eq!(anim.tracks["arm"][0].rotation, Some(1.25));
    }

    /// Isolated regression for the field `restore_scene` captured and dropped.
    /// The entity survives Play, so `spawn_from_snapshot` (which does carry the
    /// animation) is never reached — only `restore_scene` can put it back.
    #[test]
    fn a_skeletal_animation_survives_play_on_an_entity_that_was_never_despawned() {
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            EntityType::Cube,
            EntityId("rig".to_string()),
            EntityName::new("Rig"),
            EntityVisible(true),
            Transform::default(),
            Mesh3d(mesh),
            authored_skeletal_animation(),
        ));

        press_play(&mut world);
        assert_eq!(
            world.resource::<SceneSnapshot>().entities[0]
                .skeletal_animations
                .as_ref()
                .map(|a| a.len()),
            Some(1),
            "snapshot_scene captures the animation, so restore is obliged to return it"
        );

        let rig = find(&mut world, "rig");
        world.entity_mut(rig).remove::<SkeletalAnimation2d>();

        press_stop(&mut world);

        let anim = get::<SkeletalAnimation2d>(&mut world, "rig")
            .expect("the animation must come back on Stop");
        assert_eq!(anim.name, "wave");
        assert_eq!(anim.tracks["arm"][0].position, Some([3.0, 4.0]));
    }

    // ---------------------------------------------------------------------
    // script_data specifically
    // ---------------------------------------------------------------------

    #[test]
    fn an_edited_script_source_is_reverted_by_stop() {
        let mut world = test_world();
        spawn_hero(&mut world);
        press_play(&mut world);

        let hero = find(&mut world, "hero");
        world.entity_mut(hero).insert(ScriptData {
            source: "// clobbered by the running game".to_string(),
            enabled: false,
            template: None,
        });

        press_stop(&mut world);

        let script = get::<ScriptData>(&mut world, "hero").expect("ScriptData must survive Stop");
        assert_eq!(script.source, authored_script().source);
        assert!(script.enabled);
        assert_eq!(script.template, Some("patrol".to_string()));
    }

    #[test]
    fn a_script_deleted_during_play_is_reinstated_by_stop() {
        let mut world = test_world();
        spawn_hero(&mut world);
        press_play(&mut world);

        let hero = find(&mut world, "hero");
        world.entity_mut(hero).remove::<ScriptData>();
        assert!(!has::<ScriptData>(&mut world, "hero"));

        press_stop(&mut world);

        assert_eq!(
            get::<ScriptData>(&mut world, "hero").unwrap().source,
            authored_script().source,
            "losing a script to Play → Stop destroys work the user cannot get back"
        );
    }

    #[test]
    fn a_script_survives_a_delete_and_respawn_across_play() {
        // The other path: the entity itself is gone at Stop time, so the script
        // has to come back through `spawn_from_snapshot`, not the in-place
        // restore.
        let mut world = test_world();
        spawn_hero(&mut world);
        press_play(&mut world);

        let hero = find(&mut world, "hero");
        world.entity_mut(hero).despawn();

        press_stop(&mut world);

        assert_eq!(
            get::<ScriptData>(&mut world, "hero").unwrap().source,
            authored_script().source
        );
    }

    // ---------------------------------------------------------------------
    // Spawn / delete during Play
    // ---------------------------------------------------------------------

    #[test]
    fn entities_spawned_during_play_do_not_survive_stop() {
        let mut world = test_world();
        spawn_hero(&mut world);
        press_play(&mut world);

        // A marked runtime spawn (projectiles, spawner output).
        world.spawn((
            RuntimeEntity,
            EntityType::Sphere,
            EntityId("bullet".to_string()),
            EntityName::new("Bullet"),
            EntityVisible(true),
            Transform::default(),
        ));
        // An UNmarked spawn — caught only by the "not in the snapshot" sweep.
        world.spawn((
            EntityType::Sphere,
            EntityId("stray".to_string()),
            EntityName::new("Stray"),
            EntityVisible(true),
            Transform::default(),
        ));

        press_stop(&mut world);

        assert!(
            lookup(&mut world, "bullet").is_none(),
            "a RuntimeEntity spawn must be despawned on Stop"
        );
        assert!(
            lookup(&mut world, "stray").is_none(),
            "an entity absent from the snapshot must not leak back into Edit mode"
        );
        assert!(lookup(&mut world, "hero").is_some());
    }

    #[test]
    fn an_entity_deleted_during_play_comes_back_with_its_data() {
        let mut world = test_world();
        spawn_hero(&mut world);
        spawn_lamp(&mut world);
        press_play(&mut world);

        let hero = find(&mut world, "hero");
        world.entity_mut(hero).despawn();
        assert!(lookup(&mut world, "hero").is_none());

        press_stop(&mut world);

        assert_eq!(
            count_with_id(&mut world, "hero"),
            1,
            "the entity must be respawned exactly once, not duplicated"
        );
        let transform = get::<Transform>(&mut world, "hero").unwrap();
        assert_eq!(transform.translation, authored_transform().translation);
        assert_eq!(transform.scale, authored_transform().scale);
        assert_eq!(get::<EntityName>(&mut world, "hero").unwrap().0, "Hero");
        assert!(!get::<EntityVisible>(&mut world, "hero").unwrap().0);
        assert_eq!(
            get::<EntityType>(&mut world, "hero").unwrap(),
            EntityType::Cube
        );
        assert_eq!(
            get::<PhysicsData>(&mut world, "hero").unwrap(),
            authored_physics()
        );
        assert!(has::<PhysicsEnabled>(&mut world, "hero"));
        assert_eq!(
            get::<MaterialData>(&mut world, "hero").unwrap().metallic,
            authored_material().metallic
        );
        assert!(has::<AudioEnabled>(&mut world, "hero"));
        assert!(has::<ActiveGameCamera>(&mut world, "hero"));
        assert_eq!(
            get::<SkeletalAnimation2d>(&mut world, "hero").unwrap().name,
            "wave"
        );
        // The lamp was never touched — it must not be duplicated by the respawn pass.
        assert_eq!(count_with_id(&mut world, "lamp"), 1);
    }

    #[test]
    fn a_surviving_entity_is_never_respawned_as_a_duplicate() {
        let mut world = test_world();
        spawn_hero(&mut world);
        press_play(&mut world);
        press_stop(&mut world);
        assert_eq!(count_with_id(&mut world, "hero"), 1);
    }

    // ---------------------------------------------------------------------
    // Enablement markers — both directions
    // ---------------------------------------------------------------------

    #[test]
    fn markers_switched_on_during_play_are_switched_back_off_by_stop() {
        // The insert-only half of a marker restore is the trap PF-1193 fixed:
        // an entity the user had switched OFF must not come back switched ON.
        // Everything here starts DISABLED.
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            EntityType::Cube,
            EntityId("muted".to_string()),
            EntityName::new("Muted"),
            EntityVisible(true),
            Transform::default(),
            Mesh3d(mesh),
            authored_audio(),
            authored_particles(),
            authored_physics(),
            authored_reverb(),
            TilemapData::default(),
            SkeletonData2d::default(),
            authored_game_camera(),
        ));

        press_play(&mut world);

        let muted = find(&mut world, "muted");
        world.entity_mut(muted).insert((
            AudioEnabled,
            ParticleEnabled,
            PhysicsEnabled,
            ReverbZoneEnabled,
            TilemapEnabled,
            SkeletonEnabled2d,
            ActiveGameCamera,
        ));

        press_stop(&mut world);

        assert!(!has::<AudioEnabled>(&mut world, "muted"), "audio");
        assert!(!has::<ParticleEnabled>(&mut world, "muted"), "particles");
        assert!(!has::<PhysicsEnabled>(&mut world, "muted"), "physics");
        assert!(!has::<ReverbZoneEnabled>(&mut world, "muted"), "reverb");
        assert!(!has::<TilemapEnabled>(&mut world, "muted"), "tilemap");
        assert!(!has::<SkeletonEnabled2d>(&mut world, "muted"), "skeleton2d");
        assert!(
            !has::<ActiveGameCamera>(&mut world, "muted"),
            "active game camera"
        );
        // The DATA behind each marker is still restored.
        assert_eq!(
            get::<AudioData>(&mut world, "muted").unwrap().bus,
            authored_audio().bus
        );
        assert_eq!(
            get::<ReverbZoneData>(&mut world, "muted").unwrap().preset,
            "cave"
        );
    }

    #[test]
    fn markers_switched_off_during_play_are_switched_back_on_by_stop() {
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            EntityType::Cube,
            EntityId("loud".to_string()),
            EntityName::new("Loud"),
            EntityVisible(true),
            Transform::default(),
            Mesh3d(mesh),
            authored_audio(),
            AudioEnabled,
            authored_particles(),
            ParticleEnabled,
            authored_reverb(),
            ReverbZoneEnabled,
            authored_physics(),
            PhysicsEnabled,
        ));

        press_play(&mut world);

        let loud = find(&mut world, "loud");
        world
            .entity_mut(loud)
            .remove::<AudioEnabled>()
            .remove::<ParticleEnabled>()
            .remove::<ReverbZoneEnabled>()
            .remove::<PhysicsEnabled>();

        press_stop(&mut world);

        assert!(has::<AudioEnabled>(&mut world, "loud"));
        assert!(has::<ParticleEnabled>(&mut world, "loud"));
        assert!(has::<ReverbZoneEnabled>(&mut world, "loud"));
        assert!(has::<PhysicsEnabled>(&mut world, "loud"));
    }

    #[test]
    fn an_entity_carrying_no_audio_is_not_given_a_bare_audio_enabled_marker() {
        // `EntitySnapshot::new` defaults `audio_enabled` to true for serde
        // back-compat, so an ungated restore would hand every silent entity in
        // the scene a marker with no `AudioData` under it.
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            EntityType::Cube,
            EntityId("silent".to_string()),
            EntityName::new("Silent"),
            EntityVisible(true),
            Transform::default(),
            Mesh3d(mesh),
        ));

        press_play(&mut world);
        assert!(!world.resource::<SceneSnapshot>().entities[0].audio_enabled);

        press_stop(&mut world);

        assert!(!has::<AudioEnabled>(&mut world, "silent"));
        assert!(get::<AudioData>(&mut world, "silent").is_none());
    }

    // ---------------------------------------------------------------------
    // Boundary cases
    // ---------------------------------------------------------------------

    #[test]
    fn an_empty_scene_snapshots_and_restores_without_panicking() {
        let mut world = test_world();

        press_play(&mut world);
        assert!(world.resource::<SceneSnapshot>().entities.is_empty());
        assert!(world.resource::<SceneSnapshot>().selected_ids.is_empty());
        assert!(world.resource::<SceneSnapshot>().primary_id.is_none());

        press_stop(&mut world);

        let mut query = world.query::<&EntityId>();
        assert_eq!(query.iter(&world).count(), 0);
    }

    #[test]
    fn stopping_into_an_empty_snapshot_clears_a_scene_built_during_play() {
        // Play was pressed on an empty scene, so every entity that exists at
        // Stop time is "not in the snapshot".
        let mut world = test_world();
        press_play(&mut world);
        spawn_hero(&mut world);

        press_stop(&mut world);

        assert!(lookup(&mut world, "hero").is_none());
    }

    #[test]
    fn a_single_entity_scene_round_trips() {
        let mut world = test_world();
        world.spawn((
            EntityType::Sphere,
            EntityId("only".to_string()),
            EntityName::new("Only"),
            EntityVisible(true),
            Transform::from_xyz(6.5, 7.5, 8.5),
        ));

        press_play(&mut world);
        assert_eq!(world.resource::<SceneSnapshot>().entities.len(), 1);

        let only = find(&mut world, "only");
        *world.entity_mut(only).get_mut::<Transform>().unwrap() =
            Transform::from_xyz(0.0, 0.0, 0.0);

        press_stop(&mut world);

        assert_eq!(count_with_id(&mut world, "only"), 1);
        assert_eq!(
            get::<Transform>(&mut world, "only").unwrap().translation,
            Vec3::new(6.5, 7.5, 8.5)
        );
    }

    // ---------------------------------------------------------------------
    // Snapshot shape
    // ---------------------------------------------------------------------

    #[test]
    fn the_snapshot_records_the_selection_and_skips_non_forge_entities() {
        let mut world = test_world();
        let hero = spawn_hero(&mut world);
        // No EntityType, no mesh and no light — the editor-camera shape, which
        // `snapshot_scene` deliberately skips.
        world.spawn((
            EntityId("editor-camera".to_string()),
            EntityName::new("Main Camera"),
            EntityVisible(true),
            Transform::default(),
            Undeletable,
        ));
        world
            .resource_mut::<Selection>()
            .select_one(hero, "hero".to_string());

        press_play(&mut world);

        let snapshot = world.resource::<SceneSnapshot>();
        assert_eq!(snapshot.entities.len(), 1);
        assert_eq!(snapshot.entities[0].entity_id, "hero");
        assert_eq!(snapshot.selected_ids, vec!["hero".to_string()]);
        assert_eq!(snapshot.primary_id, Some("hero".to_string()));
    }

    #[test]
    fn the_snapshot_infers_an_entity_type_from_the_rendering_components() {
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            EntityId("mesh-only".to_string()),
            EntityName::new("Mesh Only"),
            EntityVisible(true),
            Transform::default(),
            Mesh3d(mesh),
        ));
        world.spawn((
            EntityId("spot-only".to_string()),
            EntityName::new("Spot Only"),
            EntityVisible(true),
            Transform::default(),
            SpotLight::default(),
        ));

        press_play(&mut world);

        let snapshot = world.resource::<SceneSnapshot>();
        let by_id = |id: &str| {
            snapshot
                .entities
                .iter()
                .find(|s| s.entity_id == id)
                .unwrap_or_else(|| panic!("{id} missing from snapshot"))
        };
        assert_eq!(by_id("mesh-only").entity_type, EntityType::Cube);
        assert_eq!(by_id("spot-only").entity_type, EntityType::SpotLight);
    }

    #[test]
    fn the_snapshot_carries_every_component_family_it_queries() {
        // Guards the capture half: a field dropped from `snapshot_scene` cannot
        // be caught by a restore assertion on an entity that never left.
        let mut world = test_world();
        let mesh = world.resource_mut::<Assets<Mesh>>().add(Cuboid::default());
        world.spawn((
            // Nested only to clear Bevy's 15-element bundle-tuple cap.
            (
                EntityType::Cube,
                EntityId("kitchen-sink".to_string()),
                EntityName::new("Kitchen Sink"),
                EntityVisible(false),
                authored_transform(),
                Mesh3d(mesh),
            ),
            (
                authored_material(),
                authored_physics(),
                PhysicsEnabled,
                authored_script(),
                authored_audio(),
                AudioEnabled,
            ),
            (
                authored_particles(),
                ParticleEnabled,
                authored_game_components(),
                authored_game_camera(),
                ActiveGameCamera,
            ),
            (
                authored_sprite(),
                authored_reverb(),
                ReverbZoneEnabled,
                authored_lod(),
                authored_skeletal_animation(),
            ),
        ));

        press_play(&mut world);

        let snap = &world.resource::<SceneSnapshot>().entities[0];
        assert_eq!(snap.entity_id, "kitchen-sink");
        assert_eq!(snap.name, "Kitchen Sink");
        assert!(!snap.visible);
        assert_eq!(snap.transform.position, [1.5, -2.25, 3.75]);
        assert_eq!(snap.transform.scale, [2.0, 0.5, 4.0]);
        assert_eq!(
            snap.material_data.as_ref().unwrap().metallic,
            authored_material().metallic
        );
        assert_eq!(snap.physics_data.as_ref().unwrap(), &authored_physics());
        assert!(snap.physics_enabled);
        assert_eq!(
            snap.script_data.as_ref().unwrap().source,
            authored_script().source
        );
        assert_eq!(snap.audio_data.as_ref().unwrap().bus, authored_audio().bus);
        assert!(snap.audio_enabled);
        assert_eq!(
            snap.particle_data.as_ref().unwrap().max_particles,
            authored_particles().max_particles
        );
        assert!(snap.particle_enabled);
        assert!(snap.game_components.as_ref().unwrap().has("health"));
        assert_eq!(
            snap.game_camera_data.as_ref().unwrap().mode,
            authored_game_camera().mode
        );
        assert!(snap.active_game_camera);
        assert_eq!(
            snap.sprite_data.as_ref().unwrap().sorting_layer,
            authored_sprite().sorting_layer
        );
        assert_eq!(snap.reverb_zone_data.as_ref().unwrap().preset, "cave");
        assert!(snap.reverb_zone_enabled);
        assert_eq!(
            snap.lod_data.as_ref().unwrap().lod_distances,
            authored_lod().lod_distances
        );
        assert_eq!(
            snap.skeletal_animations.as_ref().unwrap()[0].name,
            "wave",
            "the ECS holds one animation; the snapshot stores it as a one-element Vec"
        );
    }

    #[test]
    fn engine_mode_predicates_and_labels_agree() {
        assert!(EngineMode::Edit.is_edit());
        assert!(!EngineMode::Play.is_edit());
        assert!(!EngineMode::Paused.is_edit());
        assert!(EngineMode::Play.is_playing());
        assert!(!EngineMode::Paused.is_playing());
        assert!(!EngineMode::Edit.is_playing());
        assert_eq!(EngineMode::Edit.as_str(), "edit");
        assert_eq!(EngineMode::Play.as_str(), "play");
        assert_eq!(EngineMode::Paused.as_str(), "paused");
        assert_eq!(EngineMode::default(), EngineMode::Edit);
    }
}
