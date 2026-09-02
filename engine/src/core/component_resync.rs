//! Re-reports of component state that changed *without* a command.
//!
//! The browser's Zustand mirror learns engine component state only through
//! bridge emitters, and the per-component emitters are gated on
//! `selection.primary` AND `Changed<T>`. Neither gate can see the two writes
//! that matter most:
//!
//! - an undo or redo of a component on a **non-selected** entity, and
//! - a component **removal** — `Changed<T>` structurally cannot fire for a
//!   component that no longer exists, and there is no `RemovedComponents`
//!   watcher anywhere in `bridge/`.
//!
//! So after an undo the inspector shows a component as missing on an entity
//! that has it (or keeps one the engine dropped), and the next edit sends a
//! full-replace command built from a default — silently discarding whatever the
//! undo restored (#9290, #9291).
//!
//! The arms that do those writes (`core::entity_factory::execute_undo` /
//! `execute_redo`, and `spawn_from_snapshot`) live in `core/` and cannot emit:
//! the bridge is `wasm32`-only. They therefore queue a [`ComponentResync`] on
//! `PendingCommands`, which `bridge::component_resync::apply_component_resyncs`
//! drains and maps onto the existing `events::emit_*` functions.
//!
//! **Every variant carries the state the arm WROTE**, never an entity id to be
//! re-read. `apply_undo_requests` and the drain are separate systems in the same
//! unordered `Update` tuple and both write through a deferred `Commands`, so a
//! re-query in the drain may still observe pre-undo state — exactly the coin
//! flip this module exists to eliminate. It is the same shape as
//! [`crate::core::reverb_zone::ReverbZoneResync`] and
//! [`crate::core::skeleton2d::Skeleton2dResync`], which stay separate: they
//! already work, and folding them in would be churn with a regression surface
//! and no user-visible gain.
//!
//! A resync applies nothing and records no history. The ECS write already
//! happened in the arm; this only re-reports it.

use crate::core::animation_clip::AnimationClipData;
use crate::core::audio::AudioData;
use crate::core::game_components::GameComponentData;
use crate::core::history::{EntitySnapshot, TransformSnapshot};
use crate::core::lighting::LightData;
use crate::core::material::MaterialData;
use crate::core::particles::ParticleData;
use crate::core::physics::{JointData, PhysicsData};
use crate::core::physics_2d::{Physics2dData, PhysicsJoint2d};
use crate::core::scripting::ScriptData;
use crate::core::shader_effects::ShaderEffectData;
use crate::core::sprite::SpriteData;
use crate::core::tilemap::TilemapData;

/// One component kind the browser mirrors, used for assertions and logging.
///
/// A plain `Copy` discriminant so tests can compare what an arm queued without
/// requiring `PartialEq` on a dozen component data structs (most of which do not
/// derive it, and several of whose nested types could not without a cascade).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentResyncKind {
    Transform,
    Material,
    Light,
    Physics,
    Joint,
    Audio,
    Particle,
    Shader,
    Script,
    GameComponents,
    AnimationClip,
    Sprite,
    Physics2d,
    Joint2d,
    Tilemap,
}

/// A state re-report for one entity and one component kind.
///
/// Field types mirror what the corresponding `bridge::events::emit_*` takes, so
/// the drain is a pure mapping with no reinterpretation. Where a kind's history
/// action can remove the component, the payload is an `Option` and `None` means
/// *removed*; where no arm can remove it (transform, material, light, 3D
/// physics) the payload is unconditional, because inventing an unreachable
/// removal event would be a phantom nothing emits.
#[derive(Debug, Clone)]
pub enum ComponentResync {
    /// `TRANSFORM_CHANGED`. Carries the snapshot form the arms restore from; the
    /// drain converts the quaternion to the Euler triple the payload uses.
    Transform {
        entity_id: String,
        transform: TransformSnapshot,
    },
    /// `MATERIAL_CHANGED`. `MaterialChange` only ever replaces material data.
    Material {
        entity_id: String,
        data: MaterialData,
    },
    /// `LIGHT_CHANGED`. `LightChange` only ever replaces light data.
    Light {
        entity_id: String,
        data: LightData,
    },
    /// `PHYSICS_CHANGED`. `PhysicsChange` mutates `PhysicsData` in place and
    /// never removes it, so there is no `PHYSICS_REMOVED` to emit.
    ///
    /// `enabled` is read off the entity rather than the action: `PhysicsEnabled`
    /// is a separate marker this action does not record and the arm does not
    /// touch, so the entity's current marker IS the post-state.
    Physics {
        entity_id: String,
        data: PhysicsData,
        enabled: bool,
    },
    /// `JOINT_CHANGED` / `JOINT_REMOVED`.
    Joint {
        entity_id: String,
        data: Option<JointData>,
    },
    /// `AUDIO_CHANGED`. The emitter takes `Option<&AudioData>`, so `None`
    /// already expresses removal and no second event name is needed.
    ///
    /// No `enabled`: `emit_audio_changed`'s payload is `{ entityId, audio }`,
    /// and `AudioEnabled` has never been on the wire. Carrying a field the drain
    /// could not spend would read as coverage that is not there.
    Audio {
        entity_id: String,
        data: Option<AudioData>,
    },
    /// `PARTICLE_CHANGED`, whose payload carries `enabled` alongside an
    /// `Option` particle.
    Particle {
        entity_id: String,
        data: Option<ParticleData>,
        enabled: bool,
    },
    /// `SHADER_CHANGED`, whose payload's `data` is already an `Option`.
    Shader {
        entity_id: String,
        data: Option<ShaderEffectData>,
    },
    /// `SCRIPT_CHANGED`, whose payload's `script` is already an `Option`.
    Script {
        entity_id: String,
        data: Option<ScriptData>,
    },
    /// `GAME_COMPONENT_CHANGED`. The payload is a list, so an EMPTY list is the
    /// removal — that is the shape `emit_game_component_changed` already has.
    GameComponents {
        entity_id: String,
        components: Vec<GameComponentData>,
    },
    /// `ANIMATION_CLIP_CHANGED` / `ANIMATION_CLIP_REMOVED`.
    AnimationClip {
        entity_id: String,
        data: Option<AnimationClipData>,
    },
    /// `SPRITE_CHANGED`, whose payload's `sprite` is already an `Option`.
    Sprite {
        entity_id: String,
        data: Option<SpriteData>,
    },
    /// `PHYSICS2D_CHANGED` / `PHYSICS2D_REMOVED`.
    Physics2d {
        entity_id: String,
        data: Option<Physics2dData>,
        enabled: bool,
    },
    /// `JOINT2D_CHANGED` / `JOINT2D_REMOVED`.
    Joint2d {
        entity_id: String,
        data: Option<PhysicsJoint2d>,
    },
    /// `TILEMAP_CHANGED`, whose payload's `tilemap` is already an `Option`.
    Tilemap {
        entity_id: String,
        data: Option<TilemapData>,
    },
}

impl ComponentResync {
    /// The entity this re-report describes.
    pub fn entity_id(&self) -> &str {
        match self {
            ComponentResync::Transform { entity_id, .. }
            | ComponentResync::Material { entity_id, .. }
            | ComponentResync::Light { entity_id, .. }
            | ComponentResync::Physics { entity_id, .. }
            | ComponentResync::Joint { entity_id, .. }
            | ComponentResync::Audio { entity_id, .. }
            | ComponentResync::Particle { entity_id, .. }
            | ComponentResync::Shader { entity_id, .. }
            | ComponentResync::Script { entity_id, .. }
            | ComponentResync::GameComponents { entity_id, .. }
            | ComponentResync::AnimationClip { entity_id, .. }
            | ComponentResync::Sprite { entity_id, .. }
            | ComponentResync::Physics2d { entity_id, .. }
            | ComponentResync::Joint2d { entity_id, .. }
            | ComponentResync::Tilemap { entity_id, .. } => entity_id,
        }
    }

    /// Which component kind this re-report is for.
    pub fn kind(&self) -> ComponentResyncKind {
        match self {
            ComponentResync::Transform { .. } => ComponentResyncKind::Transform,
            ComponentResync::Material { .. } => ComponentResyncKind::Material,
            ComponentResync::Light { .. } => ComponentResyncKind::Light,
            ComponentResync::Physics { .. } => ComponentResyncKind::Physics,
            ComponentResync::Joint { .. } => ComponentResyncKind::Joint,
            ComponentResync::Audio { .. } => ComponentResyncKind::Audio,
            ComponentResync::Particle { .. } => ComponentResyncKind::Particle,
            ComponentResync::Shader { .. } => ComponentResyncKind::Shader,
            ComponentResync::Script { .. } => ComponentResyncKind::Script,
            ComponentResync::GameComponents { .. } => ComponentResyncKind::GameComponents,
            ComponentResync::AnimationClip { .. } => ComponentResyncKind::AnimationClip,
            ComponentResync::Sprite { .. } => ComponentResyncKind::Sprite,
            ComponentResync::Physics2d { .. } => ComponentResyncKind::Physics2d,
            ComponentResync::Joint2d { .. } => ComponentResyncKind::Joint2d,
            ComponentResync::Tilemap { .. } => ComponentResyncKind::Tilemap,
        }
    }

    /// Whether this re-report says the component is PRESENT (`true`) or GONE
    /// (`false`).
    ///
    /// The kinds whose arms cannot remove the component always answer `true`.
    /// `GameComponents` answers on emptiness, because an empty list is how the
    /// existing wire format expresses "no game components".
    pub fn carries_data(&self) -> bool {
        match self {
            ComponentResync::Transform { .. }
            | ComponentResync::Material { .. }
            | ComponentResync::Light { .. }
            | ComponentResync::Physics { .. } => true,
            ComponentResync::Joint { data, .. } => data.is_some(),
            ComponentResync::Audio { data, .. } => data.is_some(),
            ComponentResync::Particle { data, .. } => data.is_some(),
            ComponentResync::Shader { data, .. } => data.is_some(),
            ComponentResync::Script { data, .. } => data.is_some(),
            ComponentResync::GameComponents { components, .. } => !components.is_empty(),
            ComponentResync::AnimationClip { data, .. } => data.is_some(),
            ComponentResync::Sprite { data, .. } => data.is_some(),
            ComponentResync::Physics2d { data, .. } => data.is_some(),
            ComponentResync::Joint2d { data, .. } => data.is_some(),
            ComponentResync::Tilemap { data, .. } => data.is_some(),
        }
    }
}

/// Every re-report `spawn_from_snapshot` owes the browser for `snapshot`.
///
/// `spawn_from_snapshot` restores a dozen components onto a freshly spawned
/// entity and emits nothing, so undo-of-delete (and redo-of-spawn, prefab
/// instantiation, CSG source restore, combine/array undo — every caller) put the
/// entity back in the engine while the browser kept empty maps for all of it
/// (#9291). The scene-graph event repopulates the entity itself; nothing
/// repopulates its components.
///
/// Only components the snapshot actually CARRIES produce an entry. A snapshot
/// with no audio means the spawned entity has no audio, and the browser has
/// nothing to unlearn — it is a brand-new entity id from the store's point of
/// view — so emitting a removal for every absent component would be a dozen
/// wasted events per restore and a dozen more chances to clear something that
/// was never set.
///
/// Split out of `spawn_from_snapshot` so it is testable: that function needs a
/// live `Commands` and `Assets<Mesh>`, this needs neither.
///
/// Reverb zones and 2D skeletons are deliberately absent — they have their own
/// established resync queues, which `spawn_from_snapshot` pushes to directly.
pub fn resyncs_for_snapshot(snapshot: &EntitySnapshot) -> Vec<ComponentResync> {
    let id = || snapshot.entity_id.clone();
    let mut out: Vec<ComponentResync> = Vec::new();

    // The transform is not optional on a snapshot: every restored entity has
    // one, and the inspector reads it for the selected entity.
    out.push(ComponentResync::Transform {
        entity_id: id(),
        transform: snapshot.transform.clone(),
    });

    if let Some(data) = &snapshot.material_data {
        out.push(ComponentResync::Material {
            entity_id: id(),
            data: data.clone(),
        });
    }
    if let Some(data) = &snapshot.light_data {
        out.push(ComponentResync::Light {
            entity_id: id(),
            data: data.clone(),
        });
    }
    if let Some(data) = &snapshot.physics_data {
        out.push(ComponentResync::Physics {
            entity_id: id(),
            data: data.clone(),
            enabled: snapshot.physics_enabled,
        });
    }
    if let Some(data) = &snapshot.script_data {
        out.push(ComponentResync::Script {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.audio_data {
        out.push(ComponentResync::Audio {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.particle_data {
        out.push(ComponentResync::Particle {
            entity_id: id(),
            data: Some(data.clone()),
            enabled: snapshot.particle_enabled,
        });
    }
    if let Some(data) = &snapshot.shader_effect_data {
        out.push(ComponentResync::Shader {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.joint_data {
        out.push(ComponentResync::Joint {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(gc) = &snapshot.game_components {
        out.push(ComponentResync::GameComponents {
            entity_id: id(),
            components: gc.components.clone(),
        });
    }
    if let Some(data) = &snapshot.animation_clip_data {
        out.push(ComponentResync::AnimationClip {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.sprite_data {
        out.push(ComponentResync::Sprite {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.physics2d_data {
        out.push(ComponentResync::Physics2d {
            entity_id: id(),
            data: Some(data.clone()),
            enabled: snapshot.physics2d_enabled,
        });
    }
    if let Some(data) = &snapshot.joint2d_data {
        out.push(ComponentResync::Joint2d {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }
    if let Some(data) = &snapshot.tilemap_data {
        out.push(ComponentResync::Tilemap {
            entity_id: id(),
            data: Some(data.clone()),
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::game_components::{GameComponentData, GameComponents, HealthData};
    use crate::core::history::EntitySnapshot;
    use crate::core::pending::EntityType;
    use crate::core::scripting::ScriptData;

    fn bare_snapshot() -> EntitySnapshot {
        EntitySnapshot::new(
            "e1".to_string(),
            EntityType::Cube,
            "Cube".to_string(),
            TransformSnapshot {
                position: [0.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        )
    }

    fn script() -> ScriptData {
        ScriptData {
            source: "// noop".to_string(),
            enabled: true,
            template: None,
        }
    }

    fn kinds(resyncs: &[ComponentResync]) -> Vec<ComponentResyncKind> {
        resyncs.iter().map(|r| r.kind()).collect()
    }

    /// A snapshot with nothing on it still owes a transform — and nothing else.
    ///
    /// The "nothing else" half is the one that matters: emitting a removal for
    /// every absent component would clear state on an entity that never had it.
    #[test]
    fn a_bare_snapshot_yields_only_a_transform() {
        let resyncs = resyncs_for_snapshot(&bare_snapshot());
        assert_eq!(kinds(&resyncs), vec![ComponentResyncKind::Transform]);
        assert_eq!(resyncs[0].entity_id(), "e1");
    }

    /// One entry per carried component, every one marked PRESENT.
    #[test]
    fn each_carried_component_yields_one_present_resync() {
        let mut snapshot = bare_snapshot();
        snapshot.material_data = Some(Default::default());
        snapshot.physics_data = Some(Default::default());
        snapshot.physics_enabled = true;
        snapshot.script_data = Some(script());
        snapshot.audio_data = Some(Default::default());
        snapshot.particle_data = Some(Default::default());
        snapshot.particle_enabled = true;
        snapshot.shader_effect_data = Some(Default::default());
        snapshot.animation_clip_data = Some(Default::default());
        snapshot.sprite_data = Some(Default::default());
        snapshot.physics2d_data = Some(Default::default());
        snapshot.physics2d_enabled = true;
        snapshot.tilemap_data = Some(Default::default());
        snapshot.game_components = Some(GameComponents {
            components: vec![GameComponentData::Health(HealthData::default())],
        });

        let resyncs = resyncs_for_snapshot(&snapshot);
        let got = kinds(&resyncs);

        for expected in [
            ComponentResyncKind::Transform,
            ComponentResyncKind::Material,
            ComponentResyncKind::Physics,
            ComponentResyncKind::Script,
            ComponentResyncKind::Audio,
            ComponentResyncKind::Particle,
            ComponentResyncKind::Shader,
            ComponentResyncKind::GameComponents,
            ComponentResyncKind::AnimationClip,
            ComponentResyncKind::Sprite,
            ComponentResyncKind::Physics2d,
            ComponentResyncKind::Tilemap,
        ] {
            assert!(got.contains(&expected), "missing {expected:?} in {got:?}");
        }
        // Absent on this snapshot, so absent from the list.
        assert!(!got.contains(&ComponentResyncKind::Light));
        assert!(!got.contains(&ComponentResyncKind::Joint));
        assert!(!got.contains(&ComponentResyncKind::Joint2d));

        assert!(
            resyncs.iter().all(|r| r.carries_data()),
            "a restore never reports a component as gone",
        );
        assert!(resyncs.iter().all(|r| r.entity_id() == "e1"));
    }

    /// Enablement flags ride along with their data, from the snapshot's own
    /// recorded flag — not from "data is present", which is the PF-1173 bug
    /// shape.
    #[test]
    fn enablement_comes_from_the_snapshot_flag_not_from_data_presence() {
        let mut snapshot = bare_snapshot();
        snapshot.physics_data = Some(Default::default());
        snapshot.physics_enabled = false;
        snapshot.particle_data = Some(Default::default());
        snapshot.particle_enabled = false;
        snapshot.physics2d_data = Some(Default::default());
        snapshot.physics2d_enabled = false;

        for resync in resyncs_for_snapshot(&snapshot) {
            match resync {
                ComponentResync::Physics { enabled, .. }
                | ComponentResync::Particle { enabled, .. }
                | ComponentResync::Physics2d { enabled, .. } => {
                    assert!(!enabled, "disabled component restored as enabled");
                }
                _ => {}
            }
        }
    }

    /// An empty game-component list is the wire's "removed", so `carries_data`
    /// has to agree with it rather than with "the vec exists".
    #[test]
    fn an_empty_game_component_list_reads_as_removed() {
        let removed = ComponentResync::GameComponents {
            entity_id: "e1".to_string(),
            components: Vec::new(),
        };
        assert!(!removed.carries_data());

        let present = ComponentResync::GameComponents {
            entity_id: "e1".to_string(),
            components: vec![GameComponentData::Health(HealthData::default())],
        };
        assert!(present.carries_data());
    }
}
