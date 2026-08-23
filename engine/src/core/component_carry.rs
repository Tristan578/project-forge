//! Shared component-carry model: the ONE list of components a newly created
//! entity inherits from an existing one.
//!
//! Four systems build an entity out of another entity's components, and before
//! PF-1193 three of them hand-enumerated their own list. A component wired into
//! only one list silently vanished on the others, and `dispatchCommand` returns
//! void, so nothing anywhere reported the loss (PF-1182 is the same class of
//! defect, one path earlier).
//!
//! What each path shares is deliberately NOT uniform, so state it exactly:
//!
//! - `apply_duplicate_requests`, `apply_array_requests` and
//!   `apply_combine_requests` COLLECT and RE-INSERT through this module
//!   ([`AuxQueries`] + [`build_aux_index`] + [`insert_aux_components`]), so
//!   [`AuxComponentData`] is literally the list they carry.
//! - `entity_factory::spawn_from_snapshot` (the delete/undo restore path) does
//!   NOT call [`insert_aux_components`]. It rebuilds from an [`EntitySnapshot`]
//!   with its own per-`EntityType` arms, because a restored entity also needs
//!   its mesh and material rebuilt, which no component carry can do. It is tied
//!   to this list only at the WRITE end, by [`snapshot_entity`], and its read
//!   end is pinned separately by `snapshot_restore_parity` in
//!   `entity_factory.rs`.
//! - `apply_instantiate_prefab` is not a fifth path: it delegates to
//!   `spawn_from_snapshot` and enumerates nothing of its own.
//!
//! Everything here is driven off a single field list:
//!
//! - [`AuxComponentData`] IS that list.
//! - [`AuxQueries`] + [`build_aux_index`] collect it from the world in one pass.
//! - [`insert_aux_components`] puts it back onto a freshly spawned entity.
//! - [`snapshot_entity`] writes it into an [`EntitySnapshot`] for undo.
//! - [`AuxComponentData::for_combine_result`] and
//!   [`BaseComponentData::for_combine_result`] narrow it for the one carry that
//!   is not 1:1 — combine, where N sources produce a single new entity.
//!
//! Two rules hold across every path and are pinned by `component_carry_parity`,
//! which lives in the sibling `component_carry_tests.rs` (pulled in by `#[path]`
//! at the bottom of this file to stay under the 800-line ceiling):
//!
//! 1. An enablement marker (`AudioEnabled`, `ParticleEnabled`, `TilemapEnabled`,
//!    …) is carried ONLY when the source entity actually had it. Inserting one
//!    unconditionally alongside its data component silently re-enables
//!    something the user switched off.
//! 2. A field that is deliberately NOT carried lives in a reasoned EXEMPT list,
//!    never in a comment, so the parity test can tell "considered and declined"
//!    apart from "forgotten".

use bevy::prelude::*;
use bevy::ecs::system::SystemParam;
use std::collections::HashMap;

use super::animation_clip::AnimationClipData;
use super::asset_manager::AssetRef;
use super::audio::{AudioData, AudioEnabled};
use super::csg;
use super::entity_id::EntityId;
use super::game_camera::{ActiveGameCamera, GameCameraData};
use super::history::{EntitySnapshot, TransformSnapshot};
use super::lighting::LightData;
use super::lod::LodData;
use super::material::MaterialData;
use super::particles::{ParticleData, ParticleEnabled};
use super::pending_commands::EntityType;
use super::physics::{JointData, PhysicsData, PhysicsEnabled};
use super::physics_2d::{Physics2dData, Physics2dEnabled, PhysicsJoint2d};
use super::scripting::ScriptData;
use super::shader_effects::ShaderEffectData;
use super::skeletal_animation2d::SkeletalAnimation2d;
use super::skeleton2d::{SkeletonData2d, SkeletonEnabled2d};
use super::terrain::{TerrainData, TerrainEnabled, TerrainMeshData};
use super::tilemap::{TilemapData, TilemapEnabled};

/// Auxiliary component data collected from secondary queries, keyed by entity ID.
///
/// This is the single source of truth for "which components travel with an
/// entity". Adding a field here without wiring it into [`build_aux_index`],
/// [`insert_aux_components`], [`snapshot_entity`] and
/// [`AuxComponentData::for_combine_result`] fails `component_carry_parity`.
#[derive(Default, Clone)]
pub struct AuxComponentData {
    pub script_data: Option<ScriptData>,
    pub audio_data: Option<AudioData>,
    /// Whether `AudioEnabled` was present on the source entity.
    ///
    /// Carried as a bool rather than inferred from `audio_data.is_some()` for
    /// the same reason as every other marker in this struct: the marker and its
    /// data are separate components, so only the source's real marker state can
    /// say whether the copy should play. `bridge/audio.rs` happens to insert and
    /// remove the two together today, so no live command produces
    /// data-without-marker — but `restore_scene` and `spawn_from_snapshot` both
    /// write the pair from a snapshot, and a snapshot is only as truthful as the
    /// field it carries. Inferring the marker would make this the one carried
    /// component whose enablement cannot be turned off.
    pub audio_enabled: bool,
    pub reverb_zone_data: Option<super::reverb_zone::ReverbZoneData>,
    pub reverb_zone_enabled: bool,
    pub particle_data: Option<ParticleData>,
    pub particle_enabled: bool,
    pub shader_effect_data: Option<ShaderEffectData>,
    pub csg_mesh_data: Option<csg::CsgMeshData>,
    pub terrain_data: Option<TerrainData>,
    pub terrain_mesh_data: Option<TerrainMeshData>,
    pub procedural_mesh_data: Option<super::procedural_mesh::ProceduralMeshData>,
    pub joint_data: Option<JointData>,
    pub game_components: Option<super::game_components::GameComponents>,
    pub animation_clip_data: Option<AnimationClipData>,
    pub game_camera_data: Option<GameCameraData>,
    pub active_game_camera: bool,
    pub sprite_data: Option<super::sprite::SpriteData>,
    pub physics2d_data: Option<Physics2dData>,
    pub physics2d_enabled: bool,
    pub joint2d_data: Option<PhysicsJoint2d>,
    pub tilemap_data: Option<TilemapData>,
    pub tilemap_enabled: bool,
    pub skeleton2d_data: Option<SkeletonData2d>,
    pub skeleton2d_enabled: bool,
    /// The source's `SkeletalAnimation2d`, if any. Stored as a `Vec` to match
    /// the `EntitySnapshot` field it is written into; the ECS holds at most
    /// one such component per entity, so the vector is never longer than 1.
    pub skeletal_animations: Option<Vec<SkeletalAnimation2d>>,
    pub lod_data: Option<LodData>,
}

/// Fields of [`AuxComponentData`] that a combine RESULT entity deliberately
/// does NOT inherit from its primary source, each with the reason.
///
/// Combine is the one carry path where the sources and the destination are not
/// 1:1 — N sources are merged into a single new procedural-mesh entity — so it
/// is also the only path that needs a policy beyond "copy everything".
pub const COMBINE_RESULT_EXEMPT: &[(&str, &str)] = &[
    (
        "csg_mesh_data",
        "the result's geometry IS the merged mesh; a CSG recipe copied from one \
         source would rebuild that source's shape over it on the next mesh sync",
    ),
    (
        "procedural_mesh_data",
        "the result is spawned with its own ProceduralMeshData describing the \
         merged geometry — carrying the primary source's would overwrite it",
    ),
    (
        "joint_data",
        "a joint is anchored to the source rigid body and names its other end by \
         entity id; those sources are despawned when delete_sources is set, so a \
         carried joint would reference an entity that no longer exists",
    ),
    (
        "active_game_camera",
        "a newly created entity must never steal the active-camera flag from the \
         entity it was built from (same rule as duplicate)",
    ),
    (
        "terrain_data",
        "terrain generates its own heightmap mesh every time TerrainData changes, \
         so a carried terrain would overwrite the merged geometry — same reason \
         as csg_mesh_data",
    ),
    (
        "terrain_mesh_data",
        "follows terrain_data, which is exempt",
    ),
    (
        "joint2d_data",
        "a 2D joint anchors to a source 2D body that combine never merges and \
         that delete_sources despawns — see joint_data and sprite_data",
    ),
    (
        "skeletal_animations",
        "a 2D skeletal animation deforms sprite geometry the merged 3D mesh does \
         not have — see skeleton2d_data",
    ),
    (
        "sprite_data",
        "combine reads Mesh3d only, so a 2D sprite never contributes geometry and \
         can never be the primary source; attaching one to a 3D procedural mesh \
         would add a renderer with nothing to draw",
    ),
    (
        "physics2d_data",
        "2D physics simulates a body that has no relationship to the merged 3D \
         geometry — see sprite_data",
    ),
    (
        "physics2d_enabled",
        "follows physics2d_data, which is exempt",
    ),
    (
        "tilemap_data",
        "a tilemap renders its own grid geometry and would double-draw over the \
         merged mesh — see sprite_data",
    ),
    ("tilemap_enabled", "follows tilemap_data, which is exempt"),
    (
        "skeleton2d_data",
        "a 2D skeleton deforms sprite geometry that the merged 3D mesh does not \
         have — see sprite_data",
    ),
    (
        "skeleton2d_enabled",
        "follows skeleton2d_data, which is exempt",
    ),
];

impl AuxComponentData {
    /// Narrow this bundle to what the single entity produced by a combine may
    /// inherit from its primary source (the first source that contributed
    /// geometry). Everything absent here is listed in [`COMBINE_RESULT_EXEMPT`]
    /// with its reason.
    pub fn for_combine_result(&self) -> AuxComponentData {
        AuxComponentData {
            script_data: self.script_data.clone(),
            audio_data: self.audio_data.clone(),
            audio_enabled: self.audio_enabled,
            reverb_zone_data: self.reverb_zone_data.clone(),
            reverb_zone_enabled: self.reverb_zone_enabled,
            particle_data: self.particle_data.clone(),
            particle_enabled: self.particle_enabled,
            shader_effect_data: self.shader_effect_data.clone(),
            game_components: self.game_components.clone(),
            animation_clip_data: self.animation_clip_data.clone(),
            game_camera_data: self.game_camera_data.clone(),
            lod_data: self.lod_data.clone(),
            ..AuxComponentData::default()
        }
    }
}

/// The seven read-only queries that between them see every component in
/// [`AuxComponentData`], bundled into a single system parameter.
///
/// Bundling matters: taking these seven as separate parameters would put
/// `apply_combine_requests` at exactly 16 — Bevy's cap — so the next component
/// added anywhere would break it with an error that names the limit rather than
/// the cause. Bundled, it sits at 10.
#[derive(SystemParam)]
pub struct AuxQueries<'w, 's> {
    pub script_audio: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static ScriptData>,
            Option<&'static AudioData>,
            Option<&'static AudioEnabled>,
        ),
    >,
    pub reverb_particle: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static super::reverb_zone::ReverbZoneData>,
            Option<&'static super::reverb_zone::ReverbZoneEnabled>,
            Option<&'static ParticleData>,
            Option<&'static ParticleEnabled>,
        ),
    >,
    pub shader_csg_terrain: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static ShaderEffectData>,
            Option<&'static csg::CsgMeshData>,
            Option<&'static TerrainData>,
            Option<&'static TerrainMeshData>,
        ),
    >,
    pub procedural_joint: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static super::procedural_mesh::ProceduralMeshData>,
            Option<&'static JointData>,
        ),
    >,
    pub game_anim: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static super::game_components::GameComponents>,
            Option<&'static AnimationClipData>,
            Option<&'static GameCameraData>,
            Option<&'static ActiveGameCamera>,
        ),
    >,
    pub sprite: Query<'w, 's, (&'static EntityId, Option<&'static super::sprite::SpriteData>)>,
    pub physics2d_tilemap_skeleton_lod: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static Physics2dData>,
            Option<&'static Physics2dEnabled>,
            Option<&'static PhysicsJoint2d>,
            Option<&'static TilemapData>,
            Option<&'static TilemapEnabled>,
            Option<&'static SkeletonData2d>,
            Option<&'static SkeletonEnabled2d>,
            Option<&'static SkeletalAnimation2d>,
            Option<&'static LodData>,
        ),
    >,
}

/// Build a map of auxiliary component data keyed by entity ID.
///
/// One pass over each query instead of an O(n) scan per entity per component.
pub fn build_aux_index(queries: &AuxQueries) -> HashMap<String, AuxComponentData> {
    let mut index: HashMap<String, AuxComponentData> = HashMap::new();

    for (eid, sd, ad, ae) in queries.script_audio.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.script_data = sd.cloned();
        entry.audio_data = ad.cloned();
        entry.audio_enabled = ae.is_some();
    }

    for (eid, rzd, rze, pd, pe) in queries.reverb_particle.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.reverb_zone_data = rzd.cloned();
        entry.reverb_zone_enabled = rze.is_some();
        entry.particle_data = pd.cloned();
        entry.particle_enabled = pe.is_some();
    }

    for (eid, sed, cmd, td, tmd) in queries.shader_csg_terrain.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.shader_effect_data = sed.cloned();
        entry.csg_mesh_data = cmd.cloned();
        entry.terrain_data = td.cloned();
        entry.terrain_mesh_data = tmd.cloned();
    }

    for (eid, pmd, jd) in queries.procedural_joint.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.procedural_mesh_data = pmd.cloned();
        entry.joint_data = jd.cloned();
    }

    for (eid, gc, acd, gcd, agc) in queries.game_anim.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.game_components = gc.cloned();
        entry.animation_clip_data = acd.cloned();
        entry.game_camera_data = gcd.cloned();
        entry.active_game_camera = agc.is_some();
    }

    for (eid, sd) in queries.sprite.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.sprite_data = sd.cloned();
    }

    for (eid, p2d, p2de, j2d, tmd, tme, sk, ske, sa, ld) in
        queries.physics2d_tilemap_skeleton_lod.iter()
    {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.physics2d_data = p2d.cloned();
        entry.physics2d_enabled = p2de.is_some();
        entry.joint2d_data = j2d.cloned();
        entry.tilemap_data = tmd.cloned();
        entry.tilemap_enabled = tme.is_some();
        entry.skeleton2d_data = sk.cloned();
        entry.skeleton2d_enabled = ske.is_some();
        // The ECS holds at most one SkeletalAnimation2d per entity; EntitySnapshot
        // stores a Vec, so wrap rather than widen the snapshot's vocabulary.
        entry.skeletal_animations = sa.cloned().map(|a| vec![a]);
        entry.lod_data = ld.cloned();
    }

    index
}

/// Base (non-auxiliary) components an entity carries. Bundled so the four carry
/// call sites pass one value instead of seven positional arguments that are easy
/// to transpose.
///
/// Two fields here are consumed by [`snapshot_entity`] but NOT by
/// [`insert_base_components`], and both are pinned that way by
/// `base_component_restore_parity`:
///
/// - `visible`: every carry path spawns `EntityVisible::default()` (true) as
///   part of its spawn bundle, so there is nothing left for an insert to do.
/// - `material_data`: the call site owns whether the copy shares the source's
///   `MeshMaterial3d` handle (array, duplicate) or gets a fresh
///   `StandardMaterial` seeded from the data (combine).
#[derive(Default, Clone, Copy)]
pub struct BaseComponentData<'a> {
    pub visible: bool,
    pub material_data: Option<&'a MaterialData>,
    pub light_data: Option<&'a LightData>,
    pub physics_data: Option<&'a PhysicsData>,
    pub physics_enabled: bool,
    pub asset_ref: Option<&'a AssetRef>,
}

/// Fields of [`BaseComponentData`] a combine RESULT entity deliberately does NOT
/// inherit from its primary source, each with the reason. Counterpart to
/// [`COMBINE_RESULT_EXEMPT`] for the base components.
pub const COMBINE_RESULT_BASE_EXEMPT: &[(&str, &str)] = &[
    (
        "asset_ref",
        "an AssetRef names the imported asset that produced the SOURCE's mesh; the \
         merged geometry belongs to no asset, and a carried ref would let an asset \
         reload rebuild the source shape over it — same reason as csg_mesh_data",
    ),
    (
        "visible",
        "the result is spawned with EntityVisible::default() (true) whatever the \
         primary source's state was: combining hidden sources must not produce an \
         entity the user cannot see or find, and the snapshot has to record what \
         was actually spawned or redo would restore it hidden",
    ),
];

impl<'a> BaseComponentData<'a> {
    /// Narrow this bundle to what the single entity produced by a combine may
    /// inherit from its primary source. Everything dropped here is listed in
    /// [`COMBINE_RESULT_BASE_EXEMPT`] with its reason.
    pub fn for_combine_result(&self) -> BaseComponentData<'a> {
        BaseComponentData {
            visible: true,
            material_data: self.material_data,
            light_data: self.light_data,
            physics_data: self.physics_data,
            physics_enabled: self.physics_enabled,
            asset_ref: None,
        }
    }
}

/// Build a complete [`EntitySnapshot`] from base query data and pre-indexed
/// auxiliary data.
///
/// Snapshots have NO exemptions: an undo that restores a stripped entity is the
/// bug this whole module exists to prevent.
pub fn snapshot_entity(
    entity_id: &str,
    entity_type: EntityType,
    name: &str,
    transform: &Transform,
    base: BaseComponentData<'_>,
    aux: &AuxComponentData,
) -> EntitySnapshot {
    let mut snapshot = EntitySnapshot::new(
        entity_id.to_string(),
        entity_type,
        name.to_string(),
        TransformSnapshot::from(transform),
    );
    snapshot.visible = base.visible;
    snapshot.material_data = base.material_data.cloned();
    snapshot.light_data = base.light_data.cloned();
    snapshot.physics_data = base.physics_data.cloned();
    snapshot.physics_enabled = base.physics_enabled;
    snapshot.asset_ref = base.asset_ref.cloned();
    snapshot.script_data = aux.script_data.clone();
    snapshot.audio_data = aux.audio_data.clone();
    snapshot.audio_enabled = aux.audio_enabled;
    snapshot.reverb_zone_data = aux.reverb_zone_data.clone();
    snapshot.reverb_zone_enabled = aux.reverb_zone_enabled;
    snapshot.particle_data = aux.particle_data.clone();
    snapshot.particle_enabled = aux.particle_enabled;
    snapshot.shader_effect_data = aux.shader_effect_data.clone();
    snapshot.csg_mesh_data = aux.csg_mesh_data.clone();
    snapshot.terrain_data = aux.terrain_data.clone();
    snapshot.terrain_mesh_data = aux.terrain_mesh_data.clone();
    snapshot.procedural_mesh_data = aux.procedural_mesh_data.clone();
    snapshot.joint_data = aux.joint_data.clone();
    snapshot.game_components = aux.game_components.clone();
    snapshot.animation_clip_data = aux.animation_clip_data.clone();
    snapshot.game_camera_data = aux.game_camera_data.clone();
    snapshot.active_game_camera = aux.active_game_camera;
    snapshot.sprite_data = aux.sprite_data.clone();
    snapshot.physics2d_data = aux.physics2d_data.clone();
    snapshot.physics2d_enabled = aux.physics2d_enabled;
    snapshot.joint2d_data = aux.joint2d_data.clone();
    snapshot.tilemap_data = aux.tilemap_data.clone();
    snapshot.tilemap_enabled = aux.tilemap_enabled;
    snapshot.skeleton2d_data = aux.skeleton2d_data.clone();
    snapshot.skeleton2d_enabled = aux.skeleton2d_enabled;
    snapshot.skeletal_animations = aux.skeletal_animations.clone();
    snapshot.lod_data = aux.lod_data.clone();
    snapshot
}

/// Insert auxiliary component data onto a freshly spawned entity.
///
/// Used by duplicate, array, and the combine result. Every enablement marker is
/// gated on the source's own flag — see rule 1 in the module docs.
pub fn insert_aux_components(
    entity_commands: &mut bevy::ecs::system::EntityCommands,
    aux: &AuxComponentData,
) {
    if let Some(ref sd) = aux.script_data {
        entity_commands.insert(sd.clone());
    }
    if let Some(ref ad) = aux.audio_data {
        entity_commands.insert(ad.clone());
        // Gated on the DATA as well as the flag: `AudioEnabled` alone marks an
        // entity the audio bridge will look for `AudioData` on, and
        // `EntitySnapshot`'s `audio_enabled` defaults to true for scenes saved
        // before the field existed. Without the `audio_data` guard, every such
        // entity — audio or not — would come back carrying a bare marker.
        if aux.audio_enabled {
            entity_commands.insert(AudioEnabled);
        }
    }
    if let Some(ref rzd) = aux.reverb_zone_data {
        entity_commands.insert(rzd.clone());
    }
    if aux.reverb_zone_enabled {
        entity_commands.insert(super::reverb_zone::ReverbZoneEnabled);
    }
    if let Some(ref pd) = aux.particle_data {
        entity_commands.insert(pd.clone());
    }
    if aux.particle_enabled {
        entity_commands.insert(ParticleEnabled);
    }
    if let Some(ref sed) = aux.shader_effect_data {
        entity_commands.insert(sed.clone());
    }
    if let Some(ref cmd) = aux.csg_mesh_data {
        entity_commands.insert(cmd.clone());
    }
    if let Some(ref td) = aux.terrain_data {
        entity_commands.insert(td.clone());
        // TerrainEnabled is not a user-facing toggle: nothing in the engine ever
        // removes it (grep-verified), and both terrain spawn paths insert it
        // beside TerrainData. Presence of the data IS the marker's source of
        // truth here, which is why there is no terrain_enabled field to carry.
        entity_commands.insert(TerrainEnabled);
    }
    if let Some(ref tmd) = aux.terrain_mesh_data {
        entity_commands.insert(tmd.clone());
    }
    if let Some(ref pmd) = aux.procedural_mesh_data {
        entity_commands.insert(pmd.clone());
    }
    if let Some(ref jd) = aux.joint_data {
        entity_commands.insert(jd.clone());
    }
    if let Some(ref gc) = aux.game_components {
        entity_commands.insert(gc.clone());
    }
    if let Some(ref acd) = aux.animation_clip_data {
        entity_commands.insert(acd.clone());
    }
    if let Some(ref gcd) = aux.game_camera_data {
        entity_commands.insert(gcd.clone());
    }
    if let Some(ref sd) = aux.sprite_data {
        entity_commands.insert(sd.clone());
    }
    if let Some(ref p2d) = aux.physics2d_data {
        entity_commands.insert(p2d.clone());
    }
    if aux.physics2d_enabled {
        entity_commands.insert(Physics2dEnabled);
    }
    if let Some(ref j2d) = aux.joint2d_data {
        entity_commands.insert(j2d.clone());
    }
    if let Some(ref tmd) = aux.tilemap_data {
        entity_commands.insert(tmd.clone());
    }
    if aux.tilemap_enabled {
        entity_commands.insert(TilemapEnabled);
    }
    if let Some(ref sk) = aux.skeleton2d_data {
        entity_commands.insert(sk.clone());
    }
    if aux.skeleton2d_enabled {
        entity_commands.insert(SkeletonEnabled2d);
    }
    // The ECS holds at most one SkeletalAnimation2d, so only the first element
    // can be restored; the Vec exists to match EntitySnapshot's field, not to
    // describe a component the world can hold more than one of.
    if let Some(anim) = aux.skeletal_animations.as_ref().and_then(|a| a.first()) {
        entity_commands.insert(anim.clone());
    }
    if let Some(ref ld) = aux.lod_data {
        entity_commands.insert(ld.clone());
    }
}

/// Insert the base (non-auxiliary) components a carried entity needs.
///
/// `MaterialData` is intentionally NOT handled here: each call site owns whether
/// the new entity reuses the source's mesh/material handles or gets its own.
pub fn insert_base_components(
    entity_commands: &mut bevy::ecs::system::EntityCommands,
    base: BaseComponentData<'_>,
) {
    if let Some(ld) = base.light_data {
        entity_commands.insert(ld.clone());
    }
    if let Some(pd) = base.physics_data {
        entity_commands.insert(pd.clone());
    }
    if base.physics_enabled {
        entity_commands.insert(PhysicsEnabled);
    }
    if let Some(ar) = base.asset_ref {
        entity_commands.insert(ar.clone());
    }
}

#[cfg(test)]
#[path = "component_carry_tests.rs"]
mod component_carry_tests;
