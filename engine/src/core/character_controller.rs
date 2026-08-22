//! Kinematic character controller.
//!
//! Before PF-1214 the player was moved by adding straight onto
//! `Transform.translation`: no gravity, no ground contact, no collision
//! response, and a "jump" that was a one-frame translation tween. A generated
//! 3D game therefore had a player that walked through walls and never fell,
//! which made every score/win condition that depends on landing on something
//! unreachable.
//!
//! This module drives the player through `bevy_rapier3d`'s
//! [`KinematicCharacterController`] instead. The split is deliberate:
//!
//! * [`step_character`] is pure — it owns gravity integration, the grounded
//!   bookkeeping and the jump gating, and is unit-testable natively.
//! * [`manage_character_controller_lifecycle`] is the thin ECS wrapper that
//!   attaches/detaches the Rapier components on the Edit↔Play transition.
//!
//! The controller only exists in 3D projects. A 2D project keeps the legacy
//! direct-translation path in `game_components::system_character_controller`
//! (its movement is authored in the XY plane against `physics_2d_sim`, which is
//! a completely separate simulation).

use bevy::prelude::*;
use bevy_rapier3d::prelude::*;
use std::collections::HashMap;

use super::engine_mode::EngineMode;
use super::game_components::{GameComponentData, GameComponents};
use super::project_type::ProjectType;

/// Downward acceleration applied to an airborne character, in units/s².
///
/// Deliberately the same magnitude as Rapier's own default world gravity, so a
/// character falls at the same rate as the dynamic props around it. A character
/// that fell at a different rate than the crate it just knocked off a ledge
/// reads as a bug to a player even though neither number is "wrong".
pub const GRAVITY_ACCEL: f32 = -9.81;

/// Downward speed cap, in units/s. Without it a long fall accumulates enough
/// per-frame translation to tunnel straight through the floor collider.
pub const TERMINAL_VELOCITY: f32 = -50.0;

/// Vertical speed held while grounded, in units/s.
///
/// A hard zero lets a character walk off a ledge with no downward component at
/// all, so `snap_to_ground` never disengages and the first airborne frame reads
/// as still grounded. A small bias keeps the capsule pressed into the floor.
pub const GROUND_STICK_VELOCITY: f32 = -2.0;

/// Steepest slope, in degrees, the character can walk up. Anything steeper is
/// treated as a wall and slid along instead of climbed.
pub const MAX_SLOPE_CLIMB_DEGREES: f32 = 45.0;

/// Shallowest slope, in degrees, the character slides back down.
pub const MIN_SLOPE_SLIDE_DEGREES: f32 = 30.0;

/// Tallest step the character is lifted over automatically, in world units.
pub const STEP_HEIGHT: f32 = 0.3;

/// Minimum free width on top of a step before autostep will take it. Without a
/// width requirement the character climbs onto ledges too thin to stand on.
pub const MIN_STEP_WIDTH: f32 = 0.05;

/// Distance below the feet searched for ground each frame, in world units.
/// Keeps the character glued to the floor when running down a shallow ramp
/// instead of launching off every seam.
pub const SNAP_TO_GROUND: f32 = 0.2;

/// Skin width kept between the character shape and the geometry it touches.
pub const CONTROLLER_OFFSET: f32 = 0.02;

/// Fraction of a requested upward move that must actually happen before the
/// frame counts as unobstructed.
///
/// Not `1.0`: the skin width, a grazing wall contact and the slide projection
/// all shave a little off a legitimate rise, and cancelling a jump for that
/// would make every jump taken next to a wall die on frame one. Half is far
/// above that noise and far below anything a real ceiling leaves through.
pub const VERTICAL_BLOCK_FRACTION: f32 = 0.5;

/// Requested upward motion at or below this, in world units, is treated as no
/// request at all.
///
/// A frame with `dt` near zero asks for a vertical move of the same order as
/// float noise, and comparing noise against a fraction of itself decides
/// nothing — without the floor a standing character could be reported as
/// ceiling-blocked.
pub const VERTICAL_BLOCK_EPSILON: f32 = 1e-4;

/// Whether Rapier refused this frame's UPWARD motion, given the translation the
/// controller asked for and the one it was actually allowed.
///
/// Rapier reports the clamp (`desired_translation` vs `effective_translation`
/// on [`KinematicCharacterControllerOutput`]) but never writes it back into our
/// velocity, and there is no "hit a ceiling" flag. Without this, a jump that
/// meets an overhead surface keeps its whole upward speed: the controller
/// re-requests `+v*dt` every frame, Rapier clamps every frame, and the
/// character glides along the underside of the platform until gravity has eaten
/// the velocity — roughly 0.8s and ~48 frames at the default `jumpHeight` of
/// 8.0. Rapier still prevents penetration, so the symptom is a stuck-looking
/// player rather than tunnelling.
///
/// Only upward is considered. A refused DOWNWARD move is the floor, which
/// `grounded` already owns; treating it as a block would cancel
/// [`GROUND_STICK_VELOCITY`] and make `snap_to_ground` release on ramp seams.
pub fn vertical_motion_blocked(desired: Vec3, effective: Vec3) -> bool {
    if !desired.y.is_finite() || !effective.y.is_finite() {
        return false;
    }
    if desired.y <= VERTICAL_BLOCK_EPSILON {
        return false;
    }
    effective.y < desired.y * VERTICAL_BLOCK_FRACTION
}

/// Per-entity motion state for a kinematic character.
///
/// Inserted alongside the [`KinematicCharacterController`] on Edit→Play and
/// removed again on Play→Edit, so a character never carries stale fall speed
/// from a previous play session into the next one.
#[derive(Component, Debug, Clone, PartialEq)]
pub struct CharacterMotionState {
    /// Current vertical speed in units/s. Negative is falling.
    pub vertical_velocity: f32,
    /// Whether the character is standing on something.
    ///
    /// Seeded each frame from the contact state Rapier reported for the
    /// previous frame, then CORRECTED to `false` on the frame a jump is
    /// accepted — Rapier writes its output in `PostUpdate`, so its raw value
    /// still reads `true` while the character is already rising.
    ///
    /// This is the value the bridge emits as `CHARACTER_GROUNDED_CHANGED`
    /// (`bridge::game::emit_character_grounded_system`), so a script's
    /// `forge.physics.isGrounded()` and this module's own jump gating can never
    /// disagree about whether a character is airborne.
    pub grounded: bool,
    /// Jumps consumed since the character last stood on the ground. Walking off
    /// a ledge spends the ground jump, so `canDoubleJump` grants exactly one
    /// air jump either way.
    pub jumps_used: u32,
}

impl Default for CharacterMotionState {
    fn default() -> Self {
        Self {
            vertical_velocity: 0.0,
            // Starting "not grounded" is the safe default: the very first frame
            // then applies gravity and Rapier corrects it immediately if the
            // character is in fact standing on something. Starting `true` would
            // hand out a free mid-air jump to a character spawned in the air.
            grounded: false,
            jumps_used: 0,
        }
    }
}

/// Everything one frame of character motion depends on.
#[derive(Debug, Clone, Copy)]
pub struct CharacterStepInput {
    /// Frame delta in seconds.
    pub dt: f32,
    /// Desired horizontal direction. Magnitude is ignored — it is normalized
    /// and scaled by `speed` — and the Y component is discarded, because
    /// vertical motion is owned entirely by gravity and jumping.
    pub move_dir: Vec3,
    /// True only on the frame the jump action went down.
    pub jump_just_pressed: bool,
    /// Whether Rapier reported the character standing on something last frame.
    pub grounded: bool,
    /// Horizontal speed in units/s.
    pub speed: f32,
    /// Initial upward speed given by a jump, in units/s.
    pub jump_speed: f32,
    /// Multiplier on [`GRAVITY_ACCEL`].
    pub gravity_scale: f32,
    /// Whether one extra mid-air jump is allowed.
    pub can_double_jump: bool,
    /// Whether Rapier refused last frame's upward motion — see
    /// [`vertical_motion_blocked`]. Carries the same one-frame latency as
    /// `grounded`, because it is read from the same `PostUpdate` output.
    pub vertical_blocked: bool,
}

/// Advances one frame of character motion and returns the translation to hand
/// to the Rapier controller.
///
/// Pure: everything it needs is in `state` and `input`, which is what makes
/// gravity, grounding and jump gating testable without running the physics
/// pipeline.
pub fn step_character(state: &mut CharacterMotionState, input: CharacterStepInput) -> Vec3 {
    let dt = if input.dt.is_finite() && input.dt > 0.0 { input.dt } else { 0.0 };

    state.grounded = input.grounded;

    // `vertical_velocity <= 0.0` is what distinguishes a real landing from the
    // frame right after a jump: Rapier reports its contact state from PostUpdate,
    // so the frame after a ground jump still reads `grounded == true` while the
    // character is already rising. Refilling the jump budget there would hand a
    // `canDoubleJump` character a third jump.
    if input.grounded && state.vertical_velocity <= 0.0 {
        state.jumps_used = 0;
        state.vertical_velocity = GROUND_STICK_VELOCITY;
    } else if state.jumps_used == 0 {
        // Airborne with the ground jump unspent — either walked off a ledge or
        // spawned in the air. Either way the ground jump is gone, so
        // `canDoubleJump` means exactly one mid-air jump rather than two.
        state.jumps_used = 1;
    }

    // A rise Rapier refused loses its upward speed here. This is the only place
    // it can happen: Rapier clamps the translation and reports the clamp, but it
    // never touches our velocity, so an uncancelled jump keeps re-requesting the
    // same blocked rise for its whole ~0.8s ascent (see
    // [`vertical_motion_blocked`]).
    //
    // Deliberately BEFORE the jump gating: the report is last frame's, so a jump
    // accepted THIS frame has to win over a stale block. And deliberately AFTER
    // the grounded bookkeeping above, so zeroing the velocity here can never be
    // mistaken for a landing and refill the jump budget.
    if input.vertical_blocked && state.vertical_velocity > 0.0 {
        state.vertical_velocity = 0.0;
    }

    if input.jump_just_pressed {
        let max_jumps = if input.can_double_jump { 2 } else { 1 };
        if state.jumps_used < max_jumps {
            state.jumps_used += 1;
            // An authored `jumpHeight` of 0 must not fling the character
            // downward, and the clamp range allows a negative to be sent.
            state.vertical_velocity = input.jump_speed.max(0.0);
            state.grounded = false;
        }
    }

    let gravity_scale = if input.gravity_scale.is_finite() { input.gravity_scale } else { 1.0 };
    state.vertical_velocity += GRAVITY_ACCEL * gravity_scale * dt;
    if state.vertical_velocity < TERMINAL_VELOCITY {
        state.vertical_velocity = TERMINAL_VELOCITY;
    }

    let mut horizontal = input.move_dir;
    horizontal.y = 0.0;
    let horizontal = if horizontal.length_squared() > 0.0 {
        horizontal.normalize() * input.speed
    } else {
        Vec3::ZERO
    };

    Vec3::new(
        horizontal.x * dt,
        state.vertical_velocity * dt,
        horizontal.z * dt,
    )
}

/// True when the entity carries a character-controller game component.
pub fn has_character_controller(components: &GameComponents) -> bool {
    components
        .components
        .iter()
        .any(|c| matches!(c, GameComponentData::CharacterController(_)))
}

/// The Rapier controller configuration every SpawnForge character uses.
fn make_controller() -> KinematicCharacterController {
    KinematicCharacterController {
        up: Vec3::Y,
        offset: CharacterLength::Absolute(CONTROLLER_OFFSET),
        slide: true,
        autostep: Some(CharacterAutostep {
            max_height: CharacterLength::Absolute(STEP_HEIGHT),
            min_width: CharacterLength::Absolute(MIN_STEP_WIDTH),
            include_dynamic_bodies: true,
        }),
        max_slope_climb_angle: MAX_SLOPE_CLIMB_DEGREES.to_radians(),
        min_slope_slide_angle: MIN_SLOPE_SLIDE_DEGREES.to_radians(),
        snap_to_ground: Some(CharacterLength::Absolute(SNAP_TO_GROUND)),
        apply_impulse_to_dynamic_bodies: true,
        ..default()
    }
}

/// The entities eligible to gain a controller: a character with a collider that
/// does not already have one. Aliased because the inline form trips
/// `clippy::type_complexity`.
type CharacterAttachTargets<'w, 's> = Query<
    'w,
    's,
    (Entity, &'static GameComponents),
    (With<Collider>, Without<KinematicCharacterController>),
>;

/// Attaches the Rapier character controller on Edit→Play and removes it on
/// Play→Edit.
///
/// MUST be `.chain()`ed after `manage_physics_lifecycle`:
///
/// * Rapier's `update_character_controls` skips any entity without a collider
///   handle, so the `With<Collider>` filter here only matches once the physics
///   lifecycle's deferred `Collider` insert has been flushed — and an explicit
///   ordering edge is what inserts that flush.
/// * Both systems insert `RigidBody` and `LockedAxes` on the same entity. A
///   character must be `KinematicPositionBased` (a dynamic body would be
///   simulated and fight the controller for the transform) and rotation-locked
///   (otherwise it tips over on the first contact). Running second is what
///   makes those the values that survive.
pub fn manage_character_controller_lifecycle(
    engine_mode: Res<EngineMode>,
    mut commands: Commands,
    project_type: Option<Res<ProjectType>>,
    to_attach: CharacterAttachTargets,
    to_detach: Query<Entity, With<KinematicCharacterController>>,
    mut prev_mode: Local<Option<EngineMode>>,
) {
    let current = *engine_mode;
    let prev = *prev_mode;
    *prev_mode = Some(current);

    // The resource is absent until the first `set_project_type`, and the
    // engine's own default is 3D — so absent must behave exactly like 3D.
    let is_2d = matches!(project_type.as_deref(), Some(ProjectType::TwoD));

    let entering_play = current == EngineMode::Play && prev.is_none_or(|p| p == EngineMode::Edit);
    if entering_play && !is_2d {
        let mut attached = 0usize;
        for (entity, components) in to_attach.iter() {
            if !has_character_controller(components) {
                continue;
            }
            commands
                .entity(entity)
                .insert(make_controller())
                .insert(CharacterMotionState::default())
                .insert(RigidBody::KinematicPositionBased)
                .insert(LockedAxes::ROTATION_LOCKED);
            attached += 1;
        }
        if attached > 0 {
            tracing::info!("Character controllers attached: {} entities", attached);
        }
    }

    let entering_edit = current == EngineMode::Edit && prev.is_some_and(|p| p != EngineMode::Edit);
    if entering_edit {
        for entity in to_detach.iter() {
            commands
                .entity(entity)
                .remove::<KinematicCharacterController>()
                .remove::<KinematicCharacterControllerOutput>()
                .remove::<CharacterMotionState>();
        }
    }
}

/// The grounded changes to emit this frame, given the state JS was last told
/// about and the state now.
///
/// Emitting every character's flag every frame would be one event per character
/// per frame for the whole play session, so only changes go out. Two properties
/// make this safe to consume as a running mirror:
///
/// * A character that has DISAPPEARED from `current` (despawned, or Play->Edit
///   stripped its controller) is reported as `false` rather than dropped. A
///   consumer that only ever saw `true` would otherwise keep a stale "grounded"
///   forever, and the caller's `prev` map would grow for the whole session.
/// * Order is sorted by entity id, so the emission sequence is deterministic —
///   `HashMap` iteration order is not, and a nondeterministic event stream is
///   untestable and unreproducible from a bug report.
pub fn diff_grounded(
    prev: &HashMap<String, bool>,
    current: &HashMap<String, bool>,
) -> Vec<(String, bool)> {
    let mut changes: Vec<(String, bool)> = Vec::new();

    for (id, grounded) in current {
        if prev.get(id) != Some(grounded) {
            changes.push((id.clone(), *grounded));
        }
    }
    for (id, was_grounded) in prev {
        if !current.contains_key(id) && *was_grounded {
            changes.push((id.clone(), false));
        }
    }

    changes.sort_by(|a, b| a.0.cmp(&b.0));
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::game_components::CharacterControllerData;

    fn base_input() -> CharacterStepInput {
        CharacterStepInput {
            dt: 0.1,
            move_dir: Vec3::ZERO,
            jump_just_pressed: false,
            grounded: false,
            speed: 5.0,
            jump_speed: 8.0,
            gravity_scale: 1.0,
            can_double_jump: false,
            vertical_blocked: false,
        }
    }

    /// The whole point of the ticket: an airborne character must accelerate
    /// downward. The pre-fix system produced exactly Vec3::ZERO here.
    #[test]
    fn gravity_pulls_an_airborne_character_down() {
        let mut state = CharacterMotionState::default();
        let first = step_character(&mut state, base_input());
        assert!(first.y < 0.0, "first airborne frame must move down, got {}", first.y);

        let second = step_character(&mut state, base_input());
        assert!(
            second.y < first.y,
            "fall must accelerate: frame 2 ({}) should exceed frame 1 ({})",
            second.y,
            first.y
        );
    }

    #[test]
    fn fall_speed_is_capped_at_terminal_velocity() {
        let mut state = CharacterMotionState::default();
        for _ in 0..1000 {
            step_character(&mut state, base_input());
        }
        assert_eq!(state.vertical_velocity, TERMINAL_VELOCITY);
    }

    #[test]
    fn a_grounded_character_does_not_accumulate_fall_speed() {
        let mut state = CharacterMotionState::default();
        let grounded = CharacterStepInput { grounded: true, ..base_input() };
        for _ in 0..100 {
            step_character(&mut state, grounded);
        }
        assert!(
            state.vertical_velocity > TERMINAL_VELOCITY,
            "standing still must not build up fall speed, got {}",
            state.vertical_velocity
        );
        assert!(state.grounded);
    }

    #[test]
    fn jump_rises_when_grounded() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(out.y > 0.0, "a grounded jump must move up, got {}", out.y);
        assert!(state.vertical_velocity > 0.0);
        assert_eq!(state.jumps_used, 1);
    }

    /// The frame a jump is accepted must report NOT grounded, even though the
    /// input said grounded — Rapier writes its contact output in `PostUpdate`,
    /// so its raw flag still reads `true` while the character is already
    /// rising. `bridge::game::emit_character_grounded_system` emits THIS field,
    /// so without the correction `forge.physics.isGrounded()` answers `true`
    /// for the first frame of every jump.
    #[test]
    fn an_accepted_jump_reports_not_grounded_on_the_same_frame() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(!state.grounded, "takeoff frame must not report grounded");
    }

    /// The mirror image: with no jump accepted, the reported contact state is
    /// exactly what the engine reported, in BOTH directions. A one-way pin
    /// would be satisfied by a field hardwired to `false`, which is precisely
    /// the shape the bug would take.
    #[test]
    fn without_a_jump_the_reported_contact_follows_the_engine() {
        let mut state = CharacterMotionState::default();

        step_character(&mut state, CharacterStepInput { grounded: true, ..base_input() });
        assert!(state.grounded, "standing on something must report grounded");

        step_character(&mut state, base_input());
        assert!(!state.grounded, "leaving the ground must stop reporting grounded");

        step_character(&mut state, CharacterStepInput { grounded: true, ..base_input() });
        assert!(state.grounded, "landing must report grounded again");
    }

    /// A jump the gating REFUSES must not fake a takeoff: the character is
    /// still exactly where it was, so a script must not be told it left the
    /// ground.
    #[test]
    fn a_refused_mid_air_jump_does_not_fake_a_takeoff() {
        let mut state = CharacterMotionState::default();
        // Airborne, ground jump spent, no double jump — the next jump is refused.
        step_character(&mut state, base_input());
        assert_eq!(state.jumps_used, 1);

        step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..base_input() },
        );
        assert_eq!(state.jumps_used, 1, "the refused jump must not spend budget");
        assert!(!state.grounded);
    }

    #[test]
    fn jump_is_ignored_in_mid_air_without_double_jump() {
        let mut state = CharacterMotionState::default();
        // Fall for a frame so the character is unambiguously airborne.
        step_character(&mut state, base_input());
        let falling = state.vertical_velocity;

        let out = step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..base_input() },
        );
        assert!(out.y < 0.0, "mid-air jump must not lift the character, got {}", out.y);
        assert!(state.vertical_velocity < falling);
    }

    #[test]
    fn double_jump_allows_exactly_one_air_jump() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };

        // Ground jump.
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..input },
        );
        assert_eq!(state.jumps_used, 1);

        // Air jump — allowed.
        let air = step_character(
            &mut state,
            CharacterStepInput { jump_just_pressed: true, ..input },
        );
        assert!(air.y > 0.0, "the second jump must lift, got {}", air.y);
        assert_eq!(state.jumps_used, 2);

        // Third jump — refused.
        let before = state.vertical_velocity;
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(
            state.vertical_velocity < before,
            "a third jump must be refused, velocity went {} -> {}",
            before,
            state.vertical_velocity
        );
    }

    /// Walking off a ledge spends the ground jump. Without this, holding
    /// `canDoubleJump` gives a character that never jumped TWO air jumps.
    #[test]
    fn walking_off_a_ledge_spends_the_ground_jump() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };

        step_character(&mut state, CharacterStepInput { grounded: true, ..input });
        assert_eq!(state.jumps_used, 0);

        // First airborne frame — no jump pressed.
        step_character(&mut state, input);
        assert_eq!(state.jumps_used, 1, "leaving the ground must consume the ground jump");

        // One air jump is granted.
        let air = step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(air.y > 0.0);
        assert_eq!(state.jumps_used, 2);

        // And only one.
        let before = state.vertical_velocity;
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert!(state.vertical_velocity < before);
    }

    #[test]
    fn landing_clears_the_jump_budget() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };
        step_character(&mut state, CharacterStepInput { grounded: true, jump_just_pressed: true, ..input });
        step_character(&mut state, CharacterStepInput { jump_just_pressed: true, ..input });
        assert_eq!(state.jumps_used, 2);

        // Fall back down. The budget must NOT refill while still rising.
        while state.vertical_velocity > 0.0 {
            step_character(&mut state, input);
            assert_eq!(state.jumps_used, 2, "rising is not landing");
        }

        step_character(&mut state, CharacterStepInput { grounded: true, ..input });
        assert_eq!(state.jumps_used, 0, "landing must refill the jump budget");
    }

    /// Diagonal input must not travel faster than a single axis, and the
    /// distance must be `speed * dt` — not the raw unscaled input.
    #[test]
    fn horizontal_movement_is_normalized_and_speed_scaled() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput {
                grounded: true,
                move_dir: Vec3::new(1.0, 0.0, -1.0),
                speed: 7.0,
                dt: 0.1,
                ..base_input()
            },
        );
        let planar = Vec3::new(out.x, 0.0, out.z).length();
        assert!(
            (planar - 0.7).abs() < 1e-4,
            "diagonal travel must be speed*dt = 0.7, got {planar}"
        );
    }

    /// The Y component of an authored move direction is discarded — vertical
    /// motion belongs to gravity and jumping alone, and letting input add to it
    /// is exactly the "jump is a translation tween" bug this replaced.
    #[test]
    fn vertical_input_never_contributes_to_motion() {
        let mut state_with = CharacterMotionState::default();
        let with_y = step_character(
            &mut state_with,
            CharacterStepInput { grounded: true, move_dir: Vec3::new(1.0, 5.0, 0.0), ..base_input() },
        );
        let mut state_without = CharacterMotionState::default();
        let without_y = step_character(
            &mut state_without,
            CharacterStepInput { grounded: true, move_dir: Vec3::new(1.0, 0.0, 0.0), ..base_input() },
        );
        assert_eq!(with_y, without_y);
    }

    #[test]
    fn gravity_scale_scales_the_fall() {
        let mut normal = CharacterMotionState::default();
        step_character(&mut normal, base_input());
        let mut heavy = CharacterMotionState::default();
        step_character(&mut heavy, CharacterStepInput { gravity_scale: 2.0, ..base_input() });
        assert!(
            heavy.vertical_velocity < normal.vertical_velocity,
            "gravityScale 2 must fall faster: {} vs {}",
            heavy.vertical_velocity,
            normal.vertical_velocity
        );
    }

    #[test]
    fn a_zero_delta_frame_moves_nothing() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput { dt: 0.0, move_dir: Vec3::X, ..base_input() },
        );
        assert_eq!(out, Vec3::ZERO);
    }

    // ---- Ceiling ----

    /// Rapier refuses the motion but never writes the refusal back into our
    /// velocity, so without this the character keeps requesting `+v*dt` for the
    /// whole ascent and glides along the ceiling. At the default jump height
    /// (8.0) that is ~0.8s and ~48 frames of the player stuck to the underside
    /// of a platform.
    #[test]
    fn a_jump_into_a_ceiling_stops_rising_immediately() {
        let mut state = CharacterMotionState::default();
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        assert!(state.vertical_velocity > 0.0, "precondition: the character is rising");

        let out = step_character(
            &mut state,
            CharacterStepInput { vertical_blocked: true, ..base_input() },
        );
        assert!(out.y < 0.0, "a blocked rise must turn into a fall, got {}", out.y);
        assert!(state.vertical_velocity < 0.0);
    }

    /// The clamp must leave the character in EXACTLY the state of an
    /// unobstructed fall from rest — no residue of the cancelled jump — so it
    /// reaches the ground in the same number of frames as a character that
    /// simply stepped off the ledge at that height.
    #[test]
    fn a_blocked_rise_falls_exactly_like_a_fall_from_rest() {
        let mut blocked = CharacterMotionState::default();
        step_character(
            &mut blocked,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..base_input() },
        );
        step_character(&mut blocked, CharacterStepInput { vertical_blocked: true, ..base_input() });

        let mut from_rest = CharacterMotionState { vertical_velocity: 0.0, ..Default::default() };
        step_character(&mut from_rest, base_input());

        assert_eq!(
            blocked.vertical_velocity, from_rest.vertical_velocity,
            "a cancelled jump must fall exactly like a fall from rest"
        );
    }

    /// The clamp is one-directional. A downward request Rapier refuses is the
    /// floor, and the floor is `grounded`'s job — zeroing the fall here would
    /// cancel `GROUND_STICK_VELOCITY` and make `snap_to_ground` let go on the
    /// first ramp seam.
    #[test]
    fn a_blocked_fall_is_left_alone() {
        let mut blocked = CharacterMotionState::default();
        step_character(&mut blocked, CharacterStepInput { vertical_blocked: true, ..base_input() });

        let mut free = CharacterMotionState::default();
        step_character(&mut free, base_input());

        assert_eq!(blocked.vertical_velocity, free.vertical_velocity);
        assert!(blocked.vertical_velocity < 0.0);
    }

    /// The block report is last frame's — Rapier writes its output in
    /// `PostUpdate`, exactly like `grounded`. A jump accepted THIS frame must
    /// therefore win over it, or a character standing under a low ceiling that
    /// blocked it a moment ago can never jump again.
    #[test]
    fn a_jump_accepted_this_frame_beats_a_stale_block() {
        let mut state = CharacterMotionState::default();
        let out = step_character(
            &mut state,
            CharacterStepInput {
                grounded: true,
                jump_just_pressed: true,
                vertical_blocked: true,
                ..base_input()
            },
        );
        assert!(out.y > 0.0, "a fresh jump must still rise, got {}", out.y);
        assert!(state.vertical_velocity > 0.0);
    }

    /// A clamped ascent must not refill the jump budget: the character is still
    /// in the air, pressed against a ceiling, and `canDoubleJump` must still
    /// grant exactly one air jump.
    #[test]
    fn a_blocked_rise_does_not_refill_the_jump_budget() {
        let mut state = CharacterMotionState::default();
        let input = CharacterStepInput { can_double_jump: true, ..base_input() };
        step_character(
            &mut state,
            CharacterStepInput { grounded: true, jump_just_pressed: true, ..input },
        );
        assert_eq!(state.jumps_used, 1);

        step_character(&mut state, CharacterStepInput { vertical_blocked: true, ..input });
        assert_eq!(state.jumps_used, 1, "hitting a ceiling is not landing");
    }

    // ---- vertical_motion_blocked ----

    #[test]
    fn an_upward_request_rapier_swallowed_is_blocked() {
        assert!(vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.0, 0.0)));
    }

    #[test]
    fn an_upward_request_rapier_honoured_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.8, 0.0)));
    }

    /// A rise partly eaten by the skin width or a grazing contact is still a
    /// rise. Only a rise that mostly did not happen counts as a ceiling.
    #[test]
    fn a_mostly_honoured_rise_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 0.8, 0.0), Vec3::new(0.0, 0.79, 0.0)));
    }

    /// Downward is the floor, not a ceiling — `grounded` owns that case.
    #[test]
    fn a_swallowed_downward_request_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, -0.8, 0.0), Vec3::ZERO));
    }

    /// A frame with no vertical request at all (standing still, dt 0) must not
    /// be read as a ceiling: `0.0 < 0.0 * 0.5` is false, but a hair of float
    /// noise on either side would flip it, so the epsilon is the real guard.
    #[test]
    fn a_frame_with_no_vertical_request_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::ZERO, Vec3::ZERO));
        assert!(!vertical_motion_blocked(
            Vec3::new(0.0, VERTICAL_BLOCK_EPSILON * 0.5, 0.0),
            Vec3::new(0.0, -1.0, 0.0)
        ));
    }

    /// A NaN reaching the predicate must not be read as a ceiling — every
    /// comparison against NaN is false, so the guard has to be explicit.
    #[test]
    fn a_non_finite_translation_is_not_blocked() {
        assert!(!vertical_motion_blocked(Vec3::new(0.0, f32::NAN, 0.0), Vec3::ZERO));
        assert!(!vertical_motion_blocked(Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, f32::NAN, 0.0)));
        assert!(!vertical_motion_blocked(Vec3::new(0.0, f32::INFINITY, 0.0), Vec3::ZERO));
    }

    // ---- Lifecycle ----

    fn character() -> GameComponents {
        let mut gc = GameComponents::default();
        gc.components
            .push(GameComponentData::CharacterController(CharacterControllerData::default()));
        gc
    }

    fn run_lifecycle(world: &mut World, schedule: &mut Schedule, mode: EngineMode) {
        world.insert_resource(mode);
        schedule.run(world);
    }

    #[test]
    fn entering_play_attaches_the_controller_to_a_character_with_a_collider() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_some());
        assert!(world.get::<CharacterMotionState>(entity).is_some());
        assert!(matches!(
            world.get::<RigidBody>(entity),
            Some(RigidBody::KinematicPositionBased)
        ));
        assert_eq!(world.get::<LockedAxes>(entity).copied(), Some(LockedAxes::ROTATION_LOCKED));
    }

    /// Every field of the attached controller, asserted individually.
    ///
    /// The slope, autostep and snap-to-ground configuration IS the ticket's
    /// "slope/step" deliverable, and `snap_to_ground` is what makes the
    /// `grounded` flag the whole JS-side feature reads correct at all — without
    /// it the flag flickers on every seam in a ramp. None of it is observable
    /// from the outside, so a representative field is not enough: deleting ANY
    /// one of these must turn a test red.
    #[test]
    fn the_attached_controller_carries_the_full_slope_and_step_configuration() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        let controller = world
            .get::<KinematicCharacterController>(entity)
            .expect("controller attached");

        assert_eq!(controller.up, Vec3::Y, "up must be world up");
        assert!(
            matches!(controller.offset, CharacterLength::Absolute(v) if v == CONTROLLER_OFFSET),
            "skin width must be {CONTROLLER_OFFSET}, got {:?}",
            controller.offset
        );
        assert!(controller.slide, "a character must slide along walls, not stick to them");
        assert_eq!(
            controller.max_slope_climb_angle,
            MAX_SLOPE_CLIMB_DEGREES.to_radians(),
            "climb angle is configured in degrees and must reach Rapier as radians"
        );
        assert_eq!(
            controller.min_slope_slide_angle,
            MIN_SLOPE_SLIDE_DEGREES.to_radians(),
            "slide angle is configured in degrees and must reach Rapier as radians"
        );
        assert!(
            matches!(
                controller.snap_to_ground,
                Some(CharacterLength::Absolute(v)) if v == SNAP_TO_GROUND
            ),
            "snap-to-ground is what keeps `grounded` stable on a ramp, got {:?}",
            controller.snap_to_ground
        );
        assert!(
            matches!(
                controller.autostep,
                Some(CharacterAutostep {
                    max_height: CharacterLength::Absolute(h),
                    min_width: CharacterLength::Absolute(w),
                    include_dynamic_bodies: true,
                }) if h == STEP_HEIGHT && w == MIN_STEP_WIDTH
            ),
            "autostep must lift the character over a {STEP_HEIGHT} step, got {:?}",
            controller.autostep
        );
        assert!(
            controller.apply_impulse_to_dynamic_bodies,
            "walking into a crate must push it"
        );

        // Non-vacuity, and its honest bound. Four of the fields above differ
        // from `KinematicCharacterController::default()` (measured against
        // bevy_rapier3d 0.34 / rapier3d 0.24), so deleting the line that sets
        // one of them turns this test red — which is the whole point, since
        // `make_controller` was previously unasserted in full.
        //
        // The other four (`up`, `slide`, `max_slope_climb_angle`,
        // `apply_impulse_to_dynamic_bodies`) RESTATE Rapier's default, so
        // deleting those lines cannot be caught here by any assertion. Stated
        // rather than left for a reader to assume otherwise. These four
        // `assert_ne!`s fail if a future Rapier bump moves a default onto one
        // of our values, which is the signal that the bound has widened.
        let stock = KinematicCharacterController::default();
        assert_ne!(
            controller.offset, stock.offset,
            "skin width must be a deliberate value, not Rapier's default"
        );
        assert_ne!(
            controller.autostep, stock.autostep,
            "autostep is off by default in Rapier; this PR turns it on"
        );
        assert_ne!(
            controller.min_slope_slide_angle, stock.min_slope_slide_angle,
            "the slide angle must be our 30 degrees, not Rapier's 45"
        );
        assert_ne!(
            controller.snap_to_ground, stock.snap_to_ground,
            "snap must be absolute metres, not Rapier's relative default"
        );
    }

    #[test]
    fn a_collider_less_character_is_skipped() {
        // Rapier's controller silently ignores an entity with no collider
        // handle, so attaching to one would freeze the player instead of moving
        // it — the legacy translation path has to keep it.
        let mut world = World::new();
        let entity = world.spawn((character(), Transform::default())).id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
    }

    #[test]
    fn a_non_character_entity_is_skipped() {
        let mut world = World::new();
        let entity = world
            .spawn((GameComponents::default(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
    }

    #[test]
    fn a_2d_project_keeps_the_legacy_path() {
        let mut world = World::new();
        world.insert_resource(ProjectType::TwoD);
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);

        assert!(world.get::<KinematicCharacterController>(entity).is_none());
        assert!(world.get::<CharacterMotionState>(entity).is_none());
    }

    #[test]
    fn returning_to_edit_removes_the_controller_and_its_state() {
        let mut world = World::new();
        let entity = world
            .spawn((character(), Collider::cuboid(0.5, 0.5, 0.5), Transform::default()))
            .id();

        let mut schedule = Schedule::default();
        schedule.add_systems(manage_character_controller_lifecycle);
        run_lifecycle(&mut world, &mut schedule, EngineMode::Play);
        assert!(world.get::<KinematicCharacterController>(entity).is_some());

        run_lifecycle(&mut world, &mut schedule, EngineMode::Edit);
        assert!(world.get::<KinematicCharacterController>(entity).is_none());
        assert!(world.get::<CharacterMotionState>(entity).is_none());
    }

    fn grounded_map(entries: &[(&str, bool)]) -> HashMap<String, bool> {
        entries.iter().map(|(id, g)| ((*id).to_string(), *g)).collect()
    }

    #[test]
    fn an_unchanged_frame_emits_nothing() {
        let prev = grounded_map(&[("player", true), ("enemy", false)]);
        let current = grounded_map(&[("player", true), ("enemy", false)]);
        assert!(diff_grounded(&prev, &current).is_empty());
    }

    #[test]
    fn a_first_sighting_is_a_change_in_both_directions() {
        assert_eq!(
            diff_grounded(&HashMap::new(), &grounded_map(&[("player", true)])),
            vec![("player".to_string(), true)]
        );
        // False matters as much as true: a script asking on frame one must not
        // read "unknown" as "grounded".
        assert_eq!(
            diff_grounded(&HashMap::new(), &grounded_map(&[("player", false)])),
            vec![("player".to_string(), false)]
        );
    }

    #[test]
    fn only_the_character_that_moved_is_reported() {
        let prev = grounded_map(&[("player", true), ("enemy", true)]);
        let current = grounded_map(&[("player", false), ("enemy", true)]);
        assert_eq!(diff_grounded(&prev, &current), vec![("player".to_string(), false)]);
    }

    /// A despawned character must not leave a stale `true` behind in the
    /// consumer's mirror, and must not keep growing the caller's `prev` map.
    #[test]
    fn a_vanished_character_is_reported_as_not_grounded() {
        let prev = grounded_map(&[("player", true)]);
        assert_eq!(
            diff_grounded(&prev, &HashMap::new()),
            vec![("player".to_string(), false)]
        );
    }

    /// It was already `false`, so the mirror is already right — re-announcing it
    /// would emit an event per despawned character forever.
    #[test]
    fn a_vanished_character_that_was_already_airborne_emits_nothing() {
        let prev = grounded_map(&[("player", false)]);
        assert!(diff_grounded(&prev, &HashMap::new()).is_empty());
    }

    #[test]
    fn changes_are_emitted_in_a_deterministic_order() {
        let current = grounded_map(&[("c", true), ("a", true), ("b", true)]);
        let changes = diff_grounded(&HashMap::new(), &current);
        let ids: Vec<&str> = changes.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }
}
