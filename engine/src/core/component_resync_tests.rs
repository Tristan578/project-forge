#![cfg(test)]
//! Coverage for the component re-report path (#9290, #9291).
//!
//! Two halves, which fail in different ways:
//!
//! - **Runtime** — run each history arm against a real `World` with a live
//!   `PendingCommands` and assert the queue holds exactly the re-report the arm
//!   owes, in BOTH directions. This is the half that can prove the payload
//!   carries the post-state.
//! - **Source parity** — parse EVERY `UndoableAction` arm out of
//!   `entity_factory.rs` and require each one to queue a re-report or to appear
//!   in `EXEMPT_ARMS` with a written reason. Iterating the parsed arms rather
//!   than a list of names is what makes this the half that catches the NEXT arm,
//!   the one nobody wrote a runtime test for: a table-driven loop only examines
//!   the rows someone remembered to add.
//!
//! The file lives in `core/` because that is the only place `cargo test`
//! compiles: `bridge/` is `wasm32`-only, so a test there matches zero cases and
//! reports green while covering nothing.

use bevy::prelude::*;

use crate::core::animation_clip::AnimationClipData;
use crate::core::audio::AudioData;
use crate::core::component_resync::{ComponentResync, ComponentResyncKind};
use crate::core::entity_factory::{apply_redo_requests, apply_undo_requests};
use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
use crate::core::game_components::{GameComponentData, GameComponents, HealthData};
use crate::core::history::{
    queue_redo_from_bridge, queue_undo_from_bridge, HistoryStack, TransformSnapshot, UndoableAction,
};
use crate::core::lighting::LightData;
use crate::core::material::MaterialData;
use crate::core::particles::{ParticleData, ParticleEnabled};
use crate::core::physics::{JointData, PhysicsData, PhysicsEnabled};
use crate::core::physics_2d::{Physics2dData, Physics2dEnabled, PhysicsJoint2d};
use crate::core::scripting::ScriptData;
use crate::core::shader_effects::ShaderEffectData;
use crate::core::sprite::SpriteData;
use crate::core::tilemap::TilemapData;

const ENTITY: &str = "e1";

/// Run `body` with a live pending queue registered, and hand back the component
/// resyncs it collected.
///
/// The registration is not ceremony. `with_pending` reaches a thread-local raw
/// pointer that only the bridge's `Startup` system sets in production, so an
/// unregistered push is a SILENT no-op — a test that skipped this would assert
/// an empty queue and pass no matter what the arms did.
fn resyncs_from(body: impl FnOnce()) -> Vec<ComponentResync> {
    struct PendingGuard;
    impl Drop for PendingGuard {
        fn drop(&mut self) {
            crate::core::pending::unregister_pending_commands();
        }
    }

    let mut pending = crate::core::pending::PendingCommands::default();
    crate::core::pending::register_pending_commands(&mut pending as *mut _);
    let guard = PendingGuard;
    body();
    // Clear the pointer before `pending` is moved out of this frame, and even if
    // `body` unwound.
    drop(guard);
    pending.component_resyncs
}

/// A world with one entity carrying every component the arms' queries require.
///
/// The arms find their target by iterating a query, so an entity missing (say)
/// `MaterialData` is simply never visited and `MaterialChange` queues nothing —
/// which would read as "the arm does not report" when it actually means "the
/// fixture is wrong".
fn loaded_world() -> World {
    let mut world = World::new();
    world.insert_resource(HistoryStack::default());
    world.insert_resource(Assets::<Mesh>::default());
    world.insert_resource(Assets::<StandardMaterial>::default());
    world.spawn((
        EntityId(ENTITY.to_string()),
        EntityName(ENTITY.to_string()),
        EntityVisible(true),
        Transform::default(),
        MaterialData::default(),
        LightData::point(),
        PhysicsData::default(),
    ));
    world
}

macro_rules! run_system {
    ($world:expr, $system:expr) => {{
        let mut schedule = Schedule::default();
        schedule.add_systems($system);
        schedule.run($world);
    }};
}

fn undo(world: &mut World) {
    queue_undo_from_bridge();
    run_system!(world, apply_undo_requests);
}

fn redo(world: &mut World) {
    queue_redo_from_bridge();
    run_system!(world, apply_redo_requests);
}

fn transform_at(x: f32) -> TransformSnapshot {
    TransformSnapshot {
        position: [x, 0.0, 0.0],
        rotation: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0],
    }
}

fn script(source: &str) -> ScriptData {
    ScriptData {
        source: source.to_string(),
        enabled: true,
        template: None,
    }
}

/// `JointData` has no `Default`, and a joint that names no partner entity would
/// be a shape the editor cannot produce.
fn joint() -> JointData {
    JointData {
        joint_type: crate::core::physics::JointType::Fixed,
        connected_entity_id: "e2".to_string(),
        anchor_self: [0.0; 3],
        anchor_other: [0.0; 3],
        axis: [0.0, 1.0, 0.0],
        limits: None,
        motor: None,
    }
}

fn health() -> GameComponents {
    GameComponents {
        components: vec![GameComponentData::Health(HealthData::default())],
    }
}

/// One row of the arm table: the action to replay, the kind of re-report it
/// owes, and whether that re-report should say PRESENT for undo and for redo.
struct ArmCase {
    label: &'static str,
    action: UndoableAction,
    kind: ComponentResyncKind,
    undo_present: bool,
    redo_present: bool,
}

fn arm_cases() -> Vec<ArmCase> {
    let id = || ENTITY.to_string();
    vec![
        ArmCase {
            label: "TransformChange",
            action: UndoableAction::TransformChange {
                entity_id: id(),
                old_transform: transform_at(1.0),
                new_transform: transform_at(2.0),
            },
            kind: ComponentResyncKind::Transform,
            undo_present: true,
            redo_present: true,
        },
        ArmCase {
            label: "MultiTransformChange",
            action: UndoableAction::MultiTransformChange {
                transforms: vec![(id(), transform_at(1.0), transform_at(2.0))],
            },
            kind: ComponentResyncKind::Transform,
            undo_present: true,
            redo_present: true,
        },
        ArmCase {
            label: "MaterialChange",
            action: UndoableAction::MaterialChange {
                entity_id: id(),
                old_material: MaterialData::default(),
                new_material: MaterialData::default(),
            },
            kind: ComponentResyncKind::Material,
            undo_present: true,
            redo_present: true,
        },
        ArmCase {
            label: "LightChange",
            action: UndoableAction::LightChange {
                entity_id: id(),
                old_light: LightData::point(),
                new_light: LightData::point(),
            },
            kind: ComponentResyncKind::Light,
            undo_present: true,
            redo_present: true,
        },
        ArmCase {
            label: "PhysicsChange",
            action: UndoableAction::PhysicsChange {
                entity_id: id(),
                old_physics: PhysicsData::default(),
                new_physics: PhysicsData::default(),
            },
            kind: ComponentResyncKind::Physics,
            undo_present: true,
            redo_present: true,
        },
        // The removal direction is the one no `Changed<T>` watcher can ever see,
        // so every kind whose action can express a removal is exercised with one.
        ArmCase {
            label: "ScriptChange (creation undone)",
            action: UndoableAction::ScriptChange {
                entity_id: id(),
                old_script: None,
                new_script: Some(script("forge.log('hi')")),
            },
            kind: ComponentResyncKind::Script,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "AudioChange (creation undone)",
            action: UndoableAction::AudioChange {
                entity_id: id(),
                old_audio: None,
                new_audio: Some(AudioData::default()),
            },
            kind: ComponentResyncKind::Audio,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "ParticleChange (creation undone)",
            action: UndoableAction::ParticleChange {
                entity_id: id(),
                old_particle: None,
                new_particle: Some(ParticleData::default()),
            },
            kind: ComponentResyncKind::Particle,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "ShaderChange (creation undone)",
            action: UndoableAction::ShaderChange {
                entity_id: id(),
                old_shader: None,
                new_shader: Some(ShaderEffectData::default()),
            },
            kind: ComponentResyncKind::Shader,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "JointChange (removal undone)",
            action: UndoableAction::JointChange {
                entity_id: id(),
                old_joint: Some(joint()),
                new_joint: None,
            },
            kind: ComponentResyncKind::Joint,
            undo_present: true,
            redo_present: false,
        },
        ArmCase {
            label: "GameComponentChange (creation undone)",
            action: UndoableAction::GameComponentChange {
                entity_id: id(),
                old_components: None,
                new_components: Some(health()),
            },
            kind: ComponentResyncKind::GameComponents,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "AnimationClipChange (creation undone)",
            action: UndoableAction::AnimationClipChange {
                entity_id: id(),
                old_clip: None,
                new_clip: Some(AnimationClipData::default()),
            },
            kind: ComponentResyncKind::AnimationClip,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "SpriteChange (creation undone)",
            action: UndoableAction::SpriteChange {
                entity_id: id(),
                old_sprite: None,
                new_sprite: Some(SpriteData::default()),
            },
            kind: ComponentResyncKind::Sprite,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "Physics2dChange (creation undone)",
            action: UndoableAction::Physics2dChange {
                entity_id: id(),
                old_physics: None,
                new_physics: Some(Physics2dData::default()),
            },
            kind: ComponentResyncKind::Physics2d,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "Physics2dToggle (enable undone)",
            action: UndoableAction::Physics2dToggle {
                entity_id: id(),
                old_physics: None,
                new_physics: Some(Physics2dData::default()),
                old_enabled: false,
                new_enabled: true,
            },
            kind: ComponentResyncKind::Physics2d,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "Joint2dChange (creation undone)",
            action: UndoableAction::Joint2dChange {
                entity_id: id(),
                old_joint: None,
                new_joint: Some(PhysicsJoint2d::default()),
            },
            kind: ComponentResyncKind::Joint2d,
            undo_present: false,
            redo_present: true,
        },
        ArmCase {
            label: "TilemapChange (creation undone)",
            action: UndoableAction::TilemapChange {
                entity_id: id(),
                old_tilemap: None,
                new_tilemap: Some(TilemapData::default()),
            },
            kind: ComponentResyncKind::Tilemap,
            undo_present: false,
            redo_present: true,
        },
    ]
}

/// Every arm queues EXACTLY ONE re-report per direction, of the right kind,
/// saying what that direction actually wrote.
///
/// "Exactly one" matters as much as "at least one": a duplicate is a second
/// event the browser applies, and for the flattened payloads that is a second
/// full-replace on the inspector's editing buffer.
#[test]
fn every_arm_queues_its_post_state_in_both_directions() {
    let cases = arm_cases();
    // Floor: a table that silently shrank would make this test pass vacuously.
    assert!(
        cases.len() >= 17,
        "the arm table has shrunk to {} rows — arms were removed from coverage, \
         not from the engine",
        cases.len(),
    );

    for case in cases {
        let mut world = loaded_world();
        world.resource_mut::<HistoryStack>().push(case.action.clone());

        let undone = resyncs_from(|| undo(&mut world));
        assert_eq!(
            undone.len(),
            1,
            "{}: undo queued {} re-reports, expected exactly 1",
            case.label,
            undone.len(),
        );
        assert_eq!(undone[0].kind(), case.kind, "{}: wrong kind on undo", case.label);
        assert_eq!(undone[0].entity_id(), ENTITY, "{}: wrong entity", case.label);
        assert_eq!(
            undone[0].carries_data(),
            case.undo_present,
            "{}: undo reported the component as {}, expected {}",
            case.label,
            if undone[0].carries_data() { "present" } else { "gone" },
            if case.undo_present { "present" } else { "gone" },
        );

        let redone = resyncs_from(|| redo(&mut world));
        assert_eq!(
            redone.len(),
            1,
            "{}: redo queued {} re-reports, expected exactly 1",
            case.label,
            redone.len(),
        );
        assert_eq!(redone[0].kind(), case.kind, "{}: wrong kind on redo", case.label);
        assert_eq!(
            redone[0].carries_data(),
            case.redo_present,
            "{}: redo reported the component as {}, expected {}",
            case.label,
            if redone[0].carries_data() { "present" } else { "gone" },
            if case.redo_present { "present" } else { "gone" },
        );
    }
}

/// The arm table reaches every kind the enum declares.
///
/// Without this a kind could be added to `ComponentResync`, wired into an arm,
/// and never exercised — and the parity gate below only proves a marker is
/// PRESENT in the source, not that the arm runs.
#[test]
fn the_arm_table_covers_every_component_kind() {
    let covered: Vec<ComponentResyncKind> = arm_cases().into_iter().map(|c| c.kind).collect();
    for kind in [
        ComponentResyncKind::Transform,
        ComponentResyncKind::Material,
        ComponentResyncKind::Light,
        ComponentResyncKind::Physics,
        ComponentResyncKind::Joint,
        ComponentResyncKind::Audio,
        ComponentResyncKind::Particle,
        ComponentResyncKind::Shader,
        ComponentResyncKind::Script,
        ComponentResyncKind::GameComponents,
        ComponentResyncKind::AnimationClip,
        ComponentResyncKind::Sprite,
        ComponentResyncKind::Physics2d,
        ComponentResyncKind::Joint2d,
        ComponentResyncKind::Tilemap,
    ] {
        assert!(
            covered.contains(&kind),
            "{kind:?} is a ComponentResync variant with no arm case exercising it",
        );
    }
}

/// The payload carries what the arm WROTE, not what the ECS happens to hold.
///
/// The drain runs in a different system and `Commands` are deferred, so a
/// re-query there can still observe pre-undo state. Reading the restored source
/// text off the resync is what proves the state travelled with it.
#[test]
fn the_payload_carries_the_restored_state_not_a_default() {
    let mut world = loaded_world();
    world
        .resource_mut::<HistoryStack>()
        .push(UndoableAction::ScriptChange {
            entity_id: ENTITY.to_string(),
            old_script: Some(script("// the original")),
            new_script: Some(script("// the edit")),
        });

    let undone = resyncs_from(|| undo(&mut world));
    match &undone[0] {
        ComponentResync::Script { data, .. } => {
            assert_eq!(
                data.as_ref().map(|s| s.source.as_str()),
                Some("// the original"),
                "undo re-reported something other than the source it restored",
            );
        }
        other => panic!("expected a Script resync, got {other:?}"),
    }

    let redone = resyncs_from(|| redo(&mut world));
    match &redone[0] {
        ComponentResync::Script { data, .. } => {
            assert_eq!(data.as_ref().map(|s| s.source.as_str()), Some("// the edit"));
        }
        other => panic!("expected a Script resync, got {other:?}"),
    }
}

/// Enablement rides on the resync, and a removal reports `enabled: false`.
///
/// The 2D physics undo arm used to emit `Physics2dData::default()` on removal
/// because its payload could not say "gone" — the browser then merged that
/// default into its map, so undoing "add a 2D body" left a default body behind.
#[test]
fn a_2d_physics_removal_reports_gone_and_disabled() {
    let mut world = loaded_world();
    world
        .resource_mut::<HistoryStack>()
        .push(UndoableAction::Physics2dToggle {
            entity_id: ENTITY.to_string(),
            old_physics: None,
            new_physics: Some(Physics2dData::default()),
            old_enabled: false,
            new_enabled: true,
        });

    let undone = resyncs_from(|| undo(&mut world));
    match &undone[0] {
        ComponentResync::Physics2d { data, enabled, .. } => {
            assert!(data.is_none(), "a removal must not carry a default body");
            assert!(!enabled, "a removed body cannot be enabled");
        }
        other => panic!("expected a Physics2d resync, got {other:?}"),
    }
}

/// A property edit on a DISABLED entity must not re-report it as enabled.
///
/// `PhysicsChange` records no enablement, so the value has to come off the live
/// marker. Guessing "data present means enabled" is the PF-1173 shape, and here
/// it would switch physics on in the inspector for an entity the user disabled.
#[test]
fn enablement_is_read_from_the_marker_not_inferred() {
    for enabled in [false, true] {
        let mut world = loaded_world();
        if enabled {
            let entity = world
                .query_filtered::<Entity, With<EntityId>>()
                .iter(&world)
                .next()
                .expect("the fixture entity");
            world.entity_mut(entity).insert(PhysicsEnabled);
        }
        world
            .resource_mut::<HistoryStack>()
            .push(UndoableAction::PhysicsChange {
                entity_id: ENTITY.to_string(),
                old_physics: PhysicsData::default(),
                new_physics: PhysicsData::default(),
            });

        let undone = resyncs_from(|| undo(&mut world));
        match &undone[0] {
            ComponentResync::Physics { enabled: reported, .. } => {
                assert_eq!(*reported, enabled, "physics enablement was invented, not read");
            }
            other => panic!("expected a Physics resync, got {other:?}"),
        }
    }
}

/// The other two enablement markers, same reasoning as physics.
#[test]
fn particle_and_2d_physics_enablement_are_read_from_their_markers() {
    let mut world = loaded_world();
    let entity = world
        .query_filtered::<Entity, With<EntityId>>()
        .iter(&world)
        .next()
        .expect("the fixture entity");
    world
        .entity_mut(entity)
        .insert((ParticleData::default(), ParticleEnabled, Physics2dEnabled));

    world
        .resource_mut::<HistoryStack>()
        .push(UndoableAction::ParticleChange {
            entity_id: ENTITY.to_string(),
            old_particle: Some(ParticleData::default()),
            new_particle: None,
        });
    match &resyncs_from(|| undo(&mut world))[0] {
        ComponentResync::Particle { enabled, .. } => {
            assert!(*enabled, "the live ParticleEnabled marker was ignored");
        }
        other => panic!("expected a Particle resync, got {other:?}"),
    }

    world
        .resource_mut::<HistoryStack>()
        .push(UndoableAction::Physics2dChange {
            entity_id: ENTITY.to_string(),
            old_physics: Some(Physics2dData::default()),
            new_physics: None,
        });
    match &resyncs_from(|| undo(&mut world))[0] {
        ComponentResync::Physics2d { enabled, .. } => {
            assert!(*enabled, "the live Physics2dEnabled marker was ignored");
        }
        other => panic!("expected a Physics2d resync, got {other:?}"),
    }
}

// ---------------------------------------------------------------- parity ----

/// `include_str!` rather than a runtime read: if the file moves, that is a
/// compile error here instead of a gate that quietly stops covering anything.
const FACTORY_SRC: &str = include_str!("entity_factory.rs");

/// The re-report marker each `UndoableAction` arm's body must contain.
///
/// This table does NOT drive the loop — [`assert_arms_report`] iterates the arms
/// it parsed out of the source and looks each one up here, so an arm nobody
/// listed fails instead of going unexamined. The table only says WHICH marker a
/// listed arm owes; [`EXEMPT_ARMS`] says which arms owe none.
///
/// `ComponentResync::Joint {` carries the brace deliberately: without it the
/// needle also matches `ComponentResync::Joint2d {`, and the 3D arm would pass
/// on its 2D neighbour's push.
const ARM_MARKERS: [(&str, &str); 17] = [
    ("TransformChange", "ComponentResync::Transform {"),
    ("MultiTransformChange", "ComponentResync::Transform {"),
    ("MaterialChange", "ComponentResync::Material {"),
    ("LightChange", "ComponentResync::Light {"),
    ("PhysicsChange", "ComponentResync::Physics {"),
    ("ScriptChange", "ComponentResync::Script {"),
    ("AudioChange", "ComponentResync::Audio {"),
    ("ParticleChange", "ComponentResync::Particle {"),
    ("ShaderChange", "ComponentResync::Shader {"),
    ("JointChange", "ComponentResync::Joint {"),
    ("GameComponentChange", "ComponentResync::GameComponents {"),
    ("AnimationClipChange", "ComponentResync::AnimationClip {"),
    ("SpriteChange", "ComponentResync::Sprite {"),
    ("Physics2dChange", "ComponentResync::Physics2d {"),
    ("Physics2dToggle", "ComponentResync::Physics2d {"),
    ("Joint2dChange", "ComponentResync::Joint2d {"),
    ("TilemapChange", "ComponentResync::Tilemap {"),
];

/// The two arms that keep their OWN resync queue rather than `ComponentResync`.
/// Pinned so a future consolidation cannot silently drop the re-report.
const OWN_QUEUE_ARMS: [(&str, &str); 2] = [
    ("ReverbZoneChange", "queue_reverb_zone_resync_pending"),
    ("SkeletonChange", "queue_skeleton2d_resync_pending"),
];

/// Arms that owe NO re-report, each with the reason it does not.
///
/// A reason, not a name: an entry here is the only way to make a new arm pass
/// this gate, so the cost of adding one has to be writing down why the browser
/// already learns about the write. Two shapes, both verified in-tree:
///
/// - **A `Changed<T>` system already reports it.** Those systems are not gated
///   on selection, so unlike the `emit_*_on_selection` emitters this gate exists
///   for, they DO see a write to a non-selected entity.
/// - **The entity itself appears or disappears.** A despawn or a
///   `spawn_from_snapshot` moves the whole entity, and the scene-graph event
///   plus `resyncs_for_snapshot` cover it — the latter pinned by
///   [`spawn_from_snapshot_queues_re_reports`] below.
const EXEMPT_ARMS: [(&str, &str); 11] = [
    (
        "Rename",
        "writes EntityName; scene_graph::detect_name_changed is Query<&EntityId, Changed<EntityName>>",
    ),
    (
        "VisibilityChange",
        "writes EntityVisible; scene_graph::detect_visibility_changed is Query<&EntityId, Changed<EntityVisible>>",
    ),
    (
        "TerrainChange",
        "writes TerrainData; terrain::collect_terrain_changes is Changed<TerrainData> and covers insertion as well as mutation",
    ),
    ("Spawn", "despawns or respawns the entity via spawn_from_snapshot"),
    ("Delete", "despawns or respawns the entity via spawn_from_snapshot"),
    ("Duplicate", "despawns or respawns the entity via spawn_from_snapshot"),
    ("CsgOperation", "despawns or respawns the entity via spawn_from_snapshot"),
    ("ExtrudeShape", "despawns or respawns the entity via spawn_from_snapshot"),
    ("LatheShape", "despawns or respawns the entity via spawn_from_snapshot"),
    ("ArrayEntity", "despawns or respawns the entity via spawn_from_snapshot"),
    ("CombineMeshes", "despawns or respawns the entity via spawn_from_snapshot"),
];

/// Split one `execute_*` body into `(variant name, arm source)` pairs.
///
/// Arms sit at eight-space indent inside the `match`, which is what makes the
/// split unambiguous; a nested `UndoableAction::` mention (there are none today)
/// would be more deeply indented and is ignored.
fn arms_of(function_marker: &str) -> Vec<(String, String)> {
    let body = crate::core::parity_util::block_of(FACTORY_SRC, function_marker);
    let mut arms: Vec<(String, String)> = Vec::new();
    let mut pieces = body.split("\n        UndoableAction::");
    // Everything before the first arm is the signature and the `match` line.
    let _ = pieces.next();
    for piece in pieces {
        let name: String = piece
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            continue;
        }
        arms.push((name, piece.to_string()));
    }
    arms
}

fn assert_arms_report(function_marker: &str, direction: &str) {
    let arms = arms_of(function_marker);

    // A parser that finds nothing makes every assertion below vacuous. There are
    // 30 `UndoableAction` variants today; fewer than 25 parsed means the split
    // broke, not that the arms went away.
    assert!(
        arms.len() >= 25,
        "{direction}: parsed only {} match arms out of `{function_marker}` — the scan is \
         broken, not the code",
        arms.len(),
    );

    // Iterate the arms the PARSE found, not a hand-written list of names. A
    // table-driven loop only ever examines the rows someone remembered to add,
    // so a new arm — the one nobody wrote a runtime test for either — is never
    // looked at and the #9290 desync ships again behind a gate named after
    // preventing it.
    for (arm_name, body) in &arms {
        if let Some((_, reason)) = EXEMPT_ARMS.iter().find(|(name, _)| name == arm_name) {
            // Sanity: an exempt arm that HAS started queueing a resync means the
            // reason is stale. That is not a failure — the queue is harmless —
            // but leaving both in place is how a reason rots into fiction.
            assert!(
                !body.contains("ComponentResync::"),
                "{direction}: the `{arm_name}` arm now queues a `ComponentResync`, but \
                 EXEMPT_ARMS still claims it owes none ({reason}). Drop the exemption.",
            );
            continue;
        }

        let marker = ARM_MARKERS
            .iter()
            .chain(OWN_QUEUE_ARMS.iter())
            .find(|(name, _)| name == arm_name)
            .map(|(_, marker)| *marker)
            .unwrap_or_else(|| {
                panic!(
                    "{direction}: `UndoableAction::{arm_name}` is a new (or renamed) history \
                     arm and this gate does not know what it owes the browser. Add it to \
                     ARM_MARKERS with the `ComponentResync::` variant it must queue, to \
                     OWN_QUEUE_ARMS if it has its own resync queue, or to EXEMPT_ARMS with \
                     the reason the browser already learns about the write. Do not delete \
                     this panic: the bridge emitters are gated on `selection.primary` AND \
                     `Changed<T>`, so an unreported write leaves the store holding state \
                     the engine dropped and the next edit sends a full-replace built from a \
                     default (#9290, #9291).",
                )
            });

        assert!(
            body.contains(marker),
            "{direction}: the `{arm_name}` arm writes a component the browser mirrors but \
             queues no `{marker}` re-report. The bridge emitters are gated on \
             `selection.primary` AND `Changed<T>`, so without this the store keeps state \
             the engine dropped (or misses state it restored) whenever the entity is not \
             selected — and the next edit sends a full-replace built from a default \
             (#9290, #9291).",
        );
    }

    // The other direction: a row naming an arm that no longer exists is a gate
    // that silently stopped covering anything. Renames must be made here too.
    for (arm_name, _) in ARM_MARKERS.iter().chain(OWN_QUEUE_ARMS.iter()).chain(EXEMPT_ARMS.iter()) {
        assert!(
            arms.iter().any(|(name, _)| name == arm_name),
            "{direction}: no `UndoableAction::{arm_name}` arm found in `{function_marker}`, \
             but a row still names it. If the variant was renamed, rename it here too — \
             dropping the row would silently retire the gate.",
        );
    }
}

#[test]
fn every_undo_arm_queues_a_re_report() {
    assert_arms_report("fn execute_undo(", "undo");
}

#[test]
fn every_redo_arm_queues_a_re_report() {
    assert_arms_report("fn execute_redo(", "redo");
}

/// `spawn_from_snapshot` restores a dozen components and emitted nothing; the
/// fix is one call, and this is what keeps it there.
#[test]
fn spawn_from_snapshot_queues_re_reports() {
    let body = crate::core::parity_util::block_of(FACTORY_SRC, "pub fn spawn_from_snapshot(");
    for marker in [
        "resyncs_for_snapshot(snapshot)",
        "queue_reverb_zone_resync_pending",
        "queue_skeleton2d_resync_pending",
    ] {
        assert!(
            body.contains(marker),
            "`spawn_from_snapshot` no longer calls `{marker}`, so undo-of-delete puts the \
             entity back in the engine while the browser keeps empty maps for its \
             components (#9291)",
        );
    }
}

/// The bulk restore paths must not pay the per-entity re-report cost (#9673).
///
/// Both halves again, because they fail differently: the runtime test proves
/// the flag actually gates the queue, and the source pins prove the two bulk
/// call sites still pass the flag the cost analysis assumed.
mod bulk_restore_stays_silent {
    use super::*;
    use crate::core::component_resync::ResyncReport;
    use crate::core::entity_factory::spawn_from_snapshot;
    use crate::core::history::EntitySnapshot;
    use crate::core::pending_commands::EntityType;

    const SCENE_IO_SRC: &str = include_str!("../bridge/scene_io.rs");
    const DRAIN_SRC: &str = include_str!("../bridge/component_resync.rs");

    /// A snapshot carrying enough component data that `Each` has something to
    /// report. A bare snapshot yields only `Transform`, which would make the
    /// `Each` half of the comparison weak enough to pass on a broken flag.
    fn snapshot() -> EntitySnapshot {
        let mut snap = EntitySnapshot::new(
            "bulk-1".to_string(),
            EntityType::Cube,
            "Bulk".to_string(),
            TransformSnapshot {
                position: [1.0, 2.0, 3.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: [1.0, 1.0, 1.0],
            },
        );
        snap.material_data = Some(MaterialData::default());
        snap.physics_data = Some(PhysicsData::default());
        snap.audio_data = Some(AudioData::default());
        snap
    }

    /// Spawn one entity from `snapshot()` and hand back what it queued.
    fn resyncs_for(report: ResyncReport) -> Vec<ComponentResync> {
        resyncs_from(|| {
            let mut world = World::new();
            world.insert_resource(Assets::<Mesh>::default());
            world.insert_resource(Assets::<StandardMaterial>::default());
            let snap = snapshot();
            let mut schedule = Schedule::default();
            schedule.add_systems(
                move |mut commands: Commands,
                      mut meshes: ResMut<Assets<Mesh>>,
                      mut materials: ResMut<Assets<StandardMaterial>>| {
                    spawn_from_snapshot(&mut commands, &mut meshes, &mut materials, &snap, report);
                },
            );
            schedule.run(&mut world);
        })
    }

    #[test]
    fn silent_queues_nothing_and_each_still_queues() {
        let each = resyncs_for(ResyncReport::Each);
        // Non-vacuity: if `Each` queued nothing the `Silent` assertion below
        // would pass against a function that reports for nobody.
        assert!(
            each.len() > 1,
            "`ResyncReport::Each` queued {} re-report(s) for a snapshot carrying material, \
             physics and audio — the single-entity restore path is broken, and the \
             `Silent` assertion below would pass vacuously",
            each.len(),
        );

        let silent = resyncs_for(ResyncReport::Silent);
        assert!(
            silent.is_empty(),
            "`ResyncReport::Silent` queued {:?}. A bulk caller spawns once per entity in \
             the scene, so each queued resync is one synchronous JS callback whose handler \
             spreads a whole Zustand map — O(N^2) main-thread work on a scene the local \
             user did not necessarily author (the remix route copies sceneData across a \
             user boundary)",
            silent.iter().map(|r| r.kind()).collect::<Vec<_>>(),
        );
    }

    #[test]
    fn the_scene_load_path_passes_silent() {
        let call = SCENE_IO_SRC
            .split("entity_factory::spawn_from_snapshot(")
            .nth(1)
            .expect(
                "no `entity_factory::spawn_from_snapshot(` call in bridge/scene_io.rs — the \
                 scan is broken, or the scene loader was rewritten and this gate needs to \
                 follow it",
            );
        let args = call
            .split_once(");")
            .map(|(args, _)| args)
            .expect("unterminated spawn_from_snapshot call in bridge/scene_io.rs");
        assert!(
            args.contains("ResyncReport::Silent"),
            "the scene loader's per-entity `spawn_from_snapshot` no longer passes \
             `ResyncReport::Silent`, so loading a scene now emits up to fifteen events per \
             entity in one frame. The browser already rebuilds its whole mirror from \
             `SCENE_LOADED` plus the staged JSON, so those events buy nothing and cost \
             O(N^2) (#9673). Args seen: {args}",
        );
    }

    #[test]
    fn the_drain_is_bounded_per_frame() {
        assert!(
            crate::core::pending::resync::MAX_RESYNC_DRAIN_PER_FRAME > 0,
            "a zero budget would drain nothing, forever",
        );
        let body = crate::core::parity_util::block_of(
            DRAIN_SRC,
            "pub(super) fn apply_component_resyncs(",
        );
        assert!(
            body.contains("MAX_RESYNC_DRAIN_PER_FRAME"),
            "`apply_component_resyncs` drains the resync queue without applying \
             `MAX_RESYNC_DRAIN_PER_FRAME`. Play → Stop respawns every entity the running \
             game deleted and that count belongs to the game, so an unbounded drain lets a \
             game freeze the editor on Stop (#9673)",
        );
    }
}
