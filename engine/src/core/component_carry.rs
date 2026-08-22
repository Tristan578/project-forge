//! Shared component-carry model: the ONE list of components a newly created
//! entity inherits from an existing one.
//!
//! Four systems build an entity out of another entity — delete/undo restore,
//! duplicate, array, and combine — and before PF-1193 three of them
//! hand-enumerated their own list. A component wired into only one list
//! silently vanished on the others, and `dispatchCommand` returns void, so
//! nothing anywhere reported the loss (PF-1182 is the same class of defect, one
//! path earlier). Everything here is driven off a single field list:
//!
//! - [`AuxComponentData`] IS that list.
//! - [`AuxQueries`] + [`build_aux_index`] collect it from the world in one pass.
//! - [`insert_aux_components`] puts it back onto a freshly spawned entity.
//! - [`snapshot_entity`] writes it into an [`EntitySnapshot`] for undo.
//! - [`AuxComponentData::for_combine_result`] narrows it for the one carry that
//!   is not 1:1 — combine, where N sources produce a single new entity.
//!
//! Two rules hold across every path and are pinned by `component_carry_parity`
//! at the bottom of this file:
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
use super::physics_2d::{Physics2dData, Physics2dEnabled};
use super::scripting::ScriptData;
use super::shader_effects::ShaderEffectData;
use super::skeleton2d::{SkeletonData2d, SkeletonEnabled2d};
use super::tilemap::{TilemapData, TilemapEnabled};

/// Auxiliary component data collected from secondary queries, keyed by entity ID.
///
/// This is the single source of truth for "which components travel with an
/// entity". Adding a field here without wiring it into [`build_aux_index`],
/// [`insert_aux_components`], [`snapshot_entity`] and
/// [`AuxComponentData::for_combine_result`] fails `component_carry_parity`.
#[derive(Clone)]
pub struct AuxComponentData {
    pub script_data: Option<ScriptData>,
    pub audio_data: Option<AudioData>,
    /// Whether audio playback is enabled. Tracked separately from `audio_data`
    /// because the audio bridge removes `AudioEnabled` while keeping
    /// `AudioData` — an entity the user muted must not come back unmuted.
    pub audio_enabled: bool,
    pub reverb_zone_data: Option<super::reverb_zone::ReverbZoneData>,
    pub reverb_zone_enabled: bool,
    pub particle_data: Option<ParticleData>,
    pub particle_enabled: bool,
    pub shader_effect_data: Option<ShaderEffectData>,
    pub csg_mesh_data: Option<csg::CsgMeshData>,
    pub procedural_mesh_data: Option<super::procedural_mesh::ProceduralMeshData>,
    pub joint_data: Option<JointData>,
    pub game_components: Option<super::game_components::GameComponents>,
    pub animation_clip_data: Option<AnimationClipData>,
    pub game_camera_data: Option<GameCameraData>,
    pub active_game_camera: bool,
    pub sprite_data: Option<super::sprite::SpriteData>,
    pub physics2d_data: Option<Physics2dData>,
    pub physics2d_enabled: bool,
    pub tilemap_data: Option<TilemapData>,
    pub tilemap_enabled: bool,
    pub skeleton2d_data: Option<SkeletonData2d>,
    pub skeleton2d_enabled: bool,
    pub lod_data: Option<LodData>,
}

impl Default for AuxComponentData {
    fn default() -> Self {
        Self {
            script_data: None,
            audio_data: None,
            audio_enabled: false,
            reverb_zone_data: None,
            reverb_zone_enabled: false,
            particle_data: None,
            particle_enabled: false,
            shader_effect_data: None,
            csg_mesh_data: None,
            procedural_mesh_data: None,
            joint_data: None,
            game_components: None,
            animation_clip_data: None,
            game_camera_data: None,
            active_game_camera: false,
            sprite_data: None,
            physics2d_data: None,
            physics2d_enabled: false,
            tilemap_data: None,
            tilemap_enabled: false,
            skeleton2d_data: None,
            skeleton2d_enabled: false,
            lod_data: None,
        }
    }
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
/// Bundling matters: `apply_combine_requests` would otherwise sit at 15 of
/// Bevy's 16 system parameters, and the next component added anywhere would
/// break it with an error that names the limit rather than the cause.
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
    pub shader_csg: Query<
        'w,
        's,
        (
            &'static EntityId,
            Option<&'static ShaderEffectData>,
            Option<&'static csg::CsgMeshData>,
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
            Option<&'static TilemapData>,
            Option<&'static TilemapEnabled>,
            Option<&'static SkeletonData2d>,
            Option<&'static SkeletonEnabled2d>,
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

    for (eid, sed, cmd) in queries.shader_csg.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.shader_effect_data = sed.cloned();
        entry.csg_mesh_data = cmd.cloned();
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

    for (eid, p2d, p2de, tmd, tme, sk, ske, ld) in queries.physics2d_tilemap_skeleton_lod.iter() {
        let entry = index.entry(eid.0.clone()).or_default();
        entry.physics2d_data = p2d.cloned();
        entry.physics2d_enabled = p2de.is_some();
        entry.tilemap_data = tmd.cloned();
        entry.tilemap_enabled = tme.is_some();
        entry.skeleton2d_data = sk.cloned();
        entry.skeleton2d_enabled = ske.is_some();
        entry.lod_data = ld.cloned();
    }

    index
}

/// Base (non-auxiliary) components an entity carries. Bundled so the four carry
/// call sites pass one value instead of seven positional arguments that are easy
/// to transpose.
#[derive(Default, Clone, Copy)]
pub struct BaseComponentData<'a> {
    pub visible: bool,
    pub material_data: Option<&'a MaterialData>,
    pub light_data: Option<&'a LightData>,
    pub physics_data: Option<&'a PhysicsData>,
    pub physics_enabled: bool,
    pub asset_ref: Option<&'a AssetRef>,
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
    snapshot.procedural_mesh_data = aux.procedural_mesh_data.clone();
    snapshot.joint_data = aux.joint_data.clone();
    snapshot.game_components = aux.game_components.clone();
    snapshot.animation_clip_data = aux.animation_clip_data.clone();
    snapshot.game_camera_data = aux.game_camera_data.clone();
    snapshot.active_game_camera = aux.active_game_camera;
    snapshot.sprite_data = aux.sprite_data.clone();
    snapshot.physics2d_data = aux.physics2d_data.clone();
    snapshot.physics2d_enabled = aux.physics2d_enabled;
    snapshot.tilemap_data = aux.tilemap_data.clone();
    snapshot.tilemap_enabled = aux.tilemap_enabled;
    snapshot.skeleton2d_data = aux.skeleton2d_data.clone();
    snapshot.skeleton2d_enabled = aux.skeleton2d_enabled;
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
    }
    if aux.audio_enabled {
        entity_commands.insert(AudioEnabled);
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
mod carry_behaviour_tests {
    use super::*;
    use crate::core::audio::AudioData;
    use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled};

    /// Deliberately OFF-default: a fixture built from `Default::default()` is
    /// satisfied by an `insert(default())` mutant that restores nothing real.
    fn cave() -> ReverbZoneData {
        ReverbZoneData {
            preset: "cave".to_string(),
            wet_mix: 0.9,
            ..Default::default()
        }
    }

    /// Also off-default on every field the assertions read.
    fn loud_audio() -> AudioData {
        AudioData {
            volume: 0.375,
            loop_audio: true,
            spatial: true,
            ..Default::default()
        }
    }

    fn restore(aux: &AuxComponentData) -> (World, Entity) {
        let mut world = World::new();
        let entity = world.spawn_empty().id();
        {
            let mut commands = world.commands();
            let mut entity_commands = commands.entity(entity);
            insert_aux_components(&mut entity_commands, aux);
        }
        world.flush();
        (world, entity)
    }

    #[test]
    fn enabled_reverb_zone_is_carried_with_its_marker() {
        let aux = AuxComponentData {
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        let restored = world
            .get::<ReverbZoneData>(entity)
            .expect("reverb zone data should be carried");
        assert_eq!(restored.preset, "cave");
        assert_eq!(restored.wet_mix, 0.9);
        assert!(world.get::<ReverbZoneEnabled>(entity).is_some());
    }

    #[test]
    fn disabled_reverb_zone_stays_disabled() {
        let aux = AuxComponentData {
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: false,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        assert!(world.get::<ReverbZoneData>(entity).is_some());
        assert!(
            world.get::<ReverbZoneEnabled>(entity).is_none(),
            "a disabled reverb zone must not come back enabled"
        );
    }

    #[test]
    fn no_reverb_zone_carries_neither_component() {
        let (world, entity) = restore(&AuxComponentData::default());
        assert!(world.get::<ReverbZoneData>(entity).is_none());
        assert!(world.get::<ReverbZoneEnabled>(entity).is_none());
    }

    #[test]
    fn muted_audio_is_carried_muted() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: false,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        let restored = world
            .get::<AudioData>(entity)
            .expect("audio data should be carried");
        assert_eq!(restored.volume, 0.375);
        assert!(restored.loop_audio);
        assert!(
            world.get::<AudioEnabled>(entity).is_none(),
            "audio the user switched off must not come back playing"
        );
    }

    #[test]
    fn playing_audio_is_carried_playing() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        assert!(world.get::<AudioData>(entity).is_some());
        assert!(world.get::<AudioEnabled>(entity).is_some());
    }

    #[test]
    fn combine_result_keeps_gameplay_components_and_drops_geometry_recipes() {
        use crate::core::procedural_mesh::{ProceduralMeshData, ProceduralOp};

        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: true,
            procedural_mesh_data: Some(ProceduralMeshData {
                positions: vec![[1.0, 2.0, 3.0]],
                normals: vec![[0.0, 1.0, 0.0]],
                uvs: vec![[0.25, 0.75]],
                indices: vec![0],
                operation: ProceduralOp::Lathe { profile: vec![[0.5, 0.0], [0.5, 1.0]], segments: 12 },
            }),
            active_game_camera: true,
            physics2d_enabled: true,
            tilemap_enabled: true,
            ..Default::default()
        };

        let carried = aux.for_combine_result();

        // Carried: gameplay/authoring components travel to the merged entity.
        assert!(carried.audio_data.is_some());
        assert!(carried.audio_enabled);
        assert!(carried.reverb_zone_data.is_some());
        assert!(carried.reverb_zone_enabled);

        // Exempt: geometry recipes and the active-camera flag do not.
        assert!(
            carried.procedural_mesh_data.is_none(),
            "the merged entity carries its own combined geometry"
        );
        assert!(
            !carried.active_game_camera,
            "a new entity must not steal the active-camera flag"
        );
        assert!(!carried.physics2d_enabled);
        assert!(!carried.tilemap_enabled);
    }

    #[test]
    fn combine_result_carry_survives_the_insert_path() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux.for_combine_result());
        assert_eq!(
            world
                .get::<AudioData>(entity)
                .expect("combine result should carry audio")
                .volume,
            0.375
        );
        assert!(world.get::<AudioEnabled>(entity).is_some());
    }
}

/// Source-parity gate for the carry model.
///
/// Behavioural tests only ever prove the component they name. The defect class
/// here is DIVERGENCE — a field added to `AuxComponentData` and wired into some
/// paths but not others — so what has to be pinned is the field list itself.
#[cfg(test)]
mod component_carry_parity {
    const SOURCE: &str = include_str!("component_carry.rs");

    /// Fields `insert_aux_components` deliberately never puts back.
    const RESTORE_EXEMPT: &[(&str, &str)] = &[(
        "active_game_camera",
        "a newly created entity must not steal the active-camera flag from the \
         entity it was copied from; the callers zero it on the snapshot too",
    )];

    /// Floors: a slice that silently returns nothing is what makes this class of
    /// test report green on a broken parser.
    const FIELD_FLOOR: usize = 23;
    const COLLECTED_FLOOR: usize = 23;
    const SNAPSHOT_FLOOR: usize = 23;
    const RESTORED_FLOOR: usize = 22;
    const COMBINE_FLOOR: usize = 12;

    /// Slice the source from `marker` to the first line that is exactly `}`.
    fn block_after(marker: &str) -> &'static str {
        let start = SOURCE
            .find(marker)
            .unwrap_or_else(|| panic!("stale parity marker: {marker} not found in component_carry.rs"));
        let rest = &SOURCE[start..];
        let end = rest
            .find("\n}")
            .unwrap_or_else(|| panic!("stale parity marker: no closing brace after {marker}"));
        &rest[..end]
    }

    /// Every field name declared on `AuxComponentData`.
    fn struct_fields() -> Vec<String> {
        block_after("pub struct AuxComponentData {")
            .lines()
            .skip(1)
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with("//") || trimmed.starts_with("///") {
                    return None;
                }
                let (name, _) = trimmed.split_once(':')?;
                let name = name.trim().strip_prefix("pub ")?.trim();
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                    return None;
                }
                Some(name.to_string())
            })
            .collect()
    }

    /// Field names mentioned as `<prefix><field>` inside the block at `marker`.
    fn fields_used(marker: &str, prefix: &str) -> Vec<String> {
        let body = block_after(marker);
        let fields = struct_fields();
        let mut used: Vec<String> = Vec::new();
        for (idx, _) in body.match_indices(prefix) {
            let tail = &body[idx + prefix.len()..];
            let name: String = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if fields.contains(&name) && !used.contains(&name) {
                used.push(name);
            }
        }
        used
    }

    /// Field names assigned in the `for_combine_result` struct literal.
    fn combine_carried() -> Vec<String> {
        fields_used("pub fn for_combine_result", "self.")
    }

    fn assert_covers(
        what: &str,
        used: &[String],
        exempt: &[(&str, &str)],
        floor: usize,
    ) {
        let fields = struct_fields();
        assert!(
            fields.len() >= FIELD_FLOOR,
            "parsed only {} AuxComponentData fields (floor {}) — the parser is broken, not the code",
            fields.len(),
            FIELD_FLOOR
        );
        assert!(
            used.len() >= floor,
            "{what}: parsed only {} field uses (floor {floor}) — the parser is broken, not the code",
            used.len()
        );
        for name in used {
            assert!(
                fields.contains(name),
                "{what}: `{name}` is not a field of AuxComponentData — reverse check failed"
            );
        }
        let missing: Vec<&String> = fields
            .iter()
            .filter(|f| !used.contains(f) && !exempt.iter().any(|(e, _)| *e == f.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "{what}: these AuxComponentData fields are neither handled nor exempt: {missing:?}"
        );
    }

    #[test]
    fn every_field_is_collected_from_the_world() {
        assert_covers(
            "build_aux_index",
            &fields_used("pub fn build_aux_index", "entry."),
            &[],
            COLLECTED_FLOOR,
        );
    }

    #[test]
    fn every_field_is_written_into_the_undo_snapshot() {
        // No exemptions: an undo that restores a stripped entity is the bug.
        assert_covers(
            "snapshot_entity",
            &fields_used("pub fn snapshot_entity", "aux."),
            &[],
            SNAPSHOT_FLOOR,
        );
    }

    #[test]
    fn every_field_is_restored_onto_new_entities() {
        assert_covers(
            "pub fn insert_aux_components",
            &fields_used("pub fn insert_aux_components", "aux."),
            RESTORE_EXEMPT,
            RESTORED_FLOOR,
        );
    }

    #[test]
    fn every_field_is_decided_for_the_combine_result() {
        assert_covers(
            "for_combine_result",
            &combine_carried(),
            super::COMBINE_RESULT_EXEMPT,
            COMBINE_FLOOR,
        );
    }

    #[test]
    fn exemptions_are_still_accurate() {
        let fields = struct_fields();
        let restored = fields_used("pub fn insert_aux_components", "aux.");
        for (name, reason) in RESTORE_EXEMPT {
            assert!(
                fields.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, which is no longer a field of AuxComponentData"
            );
            assert!(
                !restored.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, but insert_aux_components now restores it — drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }

        let carried = combine_carried();
        for (name, reason) in super::COMBINE_RESULT_EXEMPT {
            assert!(
                fields.contains(&name.to_string()),
                "COMBINE_RESULT_EXEMPT names `{name}`, which is no longer a field of AuxComponentData"
            );
            assert!(
                !carried.contains(&name.to_string()),
                "COMBINE_RESULT_EXEMPT names `{name}`, but for_combine_result now carries it — drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }
    }
}
