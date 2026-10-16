//! Pinned simulation clock for deterministic input replay (#10007).
//!
//! Every simulation system in this engine steps by `Time::delta_secs()`:
//! `game_components::system_character_controller` scales the character's
//! movement by it, and Rapier's default `TimestepMode::Variable` integrates
//! `min(delta * time_scale, max_dt)` per frame (bevy_rapier 0.35,
//! `plugin/context/mod.rs`). Under a wall clock, how far an entity travels in
//! N rendered frames therefore depends on how long each frame took — which on
//! the per-PR SwiftShader software rasteriser varies from frame to frame and
//! run to run. That is the whole reason `web/e2e/engine/inputReplay.spec.ts`
//! could not be a required gate: a 120-tick replay produced a different
//! displacement every run.
//!
//! The fix is Bevy's own `TimeUpdateStrategy::ManualDuration`: while it is set,
//! `bevy_time::time_system` advances `Time<Real>` by exactly that duration each
//! frame instead of reading the wall clock, so `Time<Virtual>` (and therefore
//! every `Res<Time>` the simulation reads) sees one identical delta per
//! rendered frame. A replay that injects one trace frame per engine frame then
//! advances the simulation by exactly one tick per frame regardless of frame
//! cadence — the "pinned runtime" #9902's acceptance criteria name.
//!
//! # The contract, exactly
//!
//! * `hz` is a RATE: simulation ticks per second of game time. The engine
//!   always advances exactly ONE tick per rendered frame; `hz` only decides how
//!   long that tick is (`1 / hz` s).
//! * Every accepted rate, `MIN_PIN_HZ..=MAX_PIN_HZ`, advances `Time` by exactly
//!   `1 / hz` s per frame. The floor is 4 Hz because `Time<Virtual>` clamps
//!   every delta to its `max_delta` (250 ms by default, bevy_time `virt.rs`),
//!   and nothing here calls `set_max_delta`: a 1, 2 or 3 Hz pin would be
//!   accepted and then silently advance 250 ms per frame, which is not what it
//!   claimed. 4 Hz is 250 ms, the clamp itself, so the slowest accepted rate
//!   is still exact (`the_lowest_accepted_rate_is_exact_because_it_equals_the_clamp`).
//! * Physics tracks the pin only at `hz >= 60`. Rapier's `TimestepMode::Variable`
//!   caps its step at `max_dt = 1 / 60` s, so below 60 Hz the character
//!   controller and every other `Time`-stepped gameplay system advance `1 / hz`
//!   per frame while physics advances `1 / 60`. The run is still deterministic
//!   (both steps are constants), but the two are no longer the same length.
//!
//! This module is pure `core/`: it owns the request type, the validation, the
//! resource that records the current pin, the drain system that applies
//! queued requests, and the release on Stop. The drain is scheduled in
//! `First`, BEFORE `TimeSystems`, so a request queued from the bridge between
//! two frames is already in force when the very next frame's `time_system`
//! runs — a replay runner that dispatches `pin_frame_rate` and then awaits one
//! play tick is guaranteed to replay every subsequent frame on the pinned clock.
//!
//! # Releasing the pin
//!
//! Unpinning returns the strategy to `Automatic` AND re-anchors `Time<Real>`
//! at `Instant::now()`. Without the re-anchor the first automatic frame
//! measures its delta from the last SYNTHETIC instant, and the two clocks have
//! drifted apart in one of two directions:
//!
//! * frames rendered SLOWER than the pinned rate (SwiftShader at 15 fps pinned
//!   at 60): the synthetic clock is BEHIND the wall clock, and the unpin frame
//!   jumps by the whole lag (clamped to `max_delta`) — ~150 ms of simulation in
//!   one frame, measured by `unpinning_re_anchors_the_wall_clock_when_the_pinned_clock_lagged`,
//!   which is the test that goes red without the re-anchor;
//! * frames rendered FASTER (a 144 Hz display pinned at 60): the synthetic
//!   clock is AHEAD, `Time<Real>::update_with_instant` uses
//!   `saturating_duration_since`, and the unpin frame's delta is ZERO. In
//!   bevy_time 0.19.1 that is ONE dropped frame, not a freeze: `update_with_instant`
//!   moves `last_update` to the new instant unconditionally, so the following
//!   frame is already measured from the wall clock. (An earlier reading of this
//!   code expected every delta to stay zero until the wall clock caught up;
//!   `unpinning_re_anchors_the_wall_clock_when_the_pinned_clock_led` pins the
//!   one-frame bound, and stays green with or without the re-anchor.)
//!
//! Re-anchoring makes the unpin frame's delta near zero in BOTH directions and
//! the frame after it the time since the unpin, so the slow-rasteriser case no
//! longer replays its lag as one long step.
//!
//! Stop releases a pin that is in force during Play. The web runner unpins on
//! every exit path, but a pin made directly through the `pin_frame_rate` tool
//! (the in-app AI, an MCP client) has no owner, so the engine releases the pin
//! in force on the Play → Edit transition (Stop), with the same re-anchor
//! (`stopping_play_releases_a_pin_that_outlived_its_replay`). The runner's own
//! Pause moves the engine to `Paused`, not `Edit`, and does not release it.
//! The release runs ONLY on that transition and before the drain, so a pin
//! queued in the frame Play stops, or made while already in Edit, stays until
//! `unpin_frame_rate` (`a_pin_queued_in_the_frame_play_stops_still_wins` pins
//! that deliberately: an explicit request is never silently discarded).
//! The mode applier drains every queued request in ONE update, so a Stop and
//! a Play in the same drain leave `EngineMode` at `Play` on both sides of the
//! frame and the transition is invisible to a frame-to-frame comparison; the
//! applier therefore also records the stop on the pin resource
//! ([`SimulationClockPin::on_play_stopped`]), and the release honours either
//! signal (`a_stop_and_a_play_drained_in_one_update_still_release_the_pin`).
//! Documented in `docs/decisions/2026-10-05-pinned-simulation-clock-for-replay.md`.

use bevy::platform::time::Instant;
use bevy::prelude::*;
use bevy::time::{Real, TimeSystems, TimeUpdateStrategy};
use serde_json::Value;
use std::time::Duration;

use super::engine_mode::EngineMode;
use super::pending_commands::PendingCommands;

/// The rate `pin_frame_rate` uses when the payload carries no `hz`.
pub const DEFAULT_PIN_HZ: u32 = 60;
/// Lowest accepted pin rate: 4 Hz is a 250 ms tick, which is exactly
/// `Time<Virtual>`'s default `max_delta`. Anything slower would be clamped to
/// 250 ms per frame and no longer advance `1 / hz` (see the module doc).
pub const MIN_PIN_HZ: u32 = 4;
/// Highest accepted pin rate.
pub const MAX_PIN_HZ: u32 = 240;

/// A queued request to pin or unpin the simulation clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameRatePinRequest {
    /// Advance the simulation by exactly `1 / hz` seconds every rendered frame.
    Pin { hz: u32 },
    /// Return to the wall clock.
    Unpin,
}

/// The current pin, so a caller (and a test) can read back what is in force.
/// `None` means the wall clock drives the simulation.
#[derive(Resource, Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SimulationClockPin {
    pub hz: Option<u32>,
    /// Play stopped since [`release_pin_when_play_stops`] last ran; see
    /// [`SimulationClockPin::on_play_stopped`].
    play_stopped: bool,
}

impl SimulationClockPin {
    /// Whether a pinned rate is currently driving `Time`.
    pub fn is_pinned(&self) -> bool {
        self.hz.is_some()
    }

    /// Record that Play just stopped, so the next `First` releases the pin
    /// even when the mode no longer shows the transition.
    ///
    /// [`release_pin_when_play_stops`] compares `EngineMode` across frames,
    /// but the mode applier drains every queued request in ONE update: a Stop
    /// followed by a Play in the same drain leaves the mode at `Play` on both
    /// sides of the frame, and the pass through `Edit` is invisible to that
    /// comparison. The applier calls this from its Stop arm, and only there
    /// (Pause keeps the pin), so the release fires regardless. The record is
    /// consumed before the pin drain, so a pin queued in the stopping frame
    /// still wins, as before.
    pub fn on_play_stopped(&mut self) {
        self.play_stopped = true;
    }
}

/// The per-frame duration a pinned rate advances the simulation by.
///
/// Integer nanoseconds, truncated: 60 Hz is 16_666_666 ns, not 16.666…ms. What
/// matters for determinism is that every frame gets the SAME duration, and an
/// integer period is reproducible across machines in a way a float division
/// followed by `Duration::from_secs_f64` is not guaranteed to be. A rate below
/// the floor is treated as the floor, so the period is never longer than
/// `Time<Virtual>` would honour.
pub fn pin_duration(hz: u32) -> Duration {
    Duration::from_nanos(1_000_000_000 / u64::from(hz.max(MIN_PIN_HZ)))
}

/// Validate the `hz` field of a `pin_frame_rate` payload.
///
/// Absent or `null` means [`DEFAULT_PIN_HZ`]. Anything else must be a JSON
/// integer in `[MIN_PIN_HZ, MAX_PIN_HZ]`; a float (even `60.0`), a string, a
/// negative or an out-of-range value is refused with a message naming the
/// bound. The offending value is only echoed when it is a number, so the error
/// string stays bounded whatever the payload carried.
pub fn parse_pin_hz(value: Option<&Value>) -> Result<u32, String> {
    let Some(value) = value else {
        return Ok(DEFAULT_PIN_HZ);
    };
    if value.is_null() {
        return Ok(DEFAULT_PIN_HZ);
    }
    let bounds = format!("hz must be an integer between {MIN_PIN_HZ} and {MAX_PIN_HZ}");
    let Some(hz) = value.as_u64() else {
        let got = if value.is_number() {
            value.to_string()
        } else {
            json_type_name(value).to_string()
        };
        return Err(format!("{bounds}, got {got}"));
    };
    if hz < u64::from(MIN_PIN_HZ) || hz > u64::from(MAX_PIN_HZ) {
        return Err(format!("{bounds}, got {hz}"));
    }
    Ok(hz as u32)
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

/// Return the simulation to the wall clock.
///
/// Sets the strategy back to `Automatic`, clears the recorded pin, and
/// re-anchors `Time<Real>` at `Instant::now()` so the next frame's delta is
/// measured from this moment rather than from the last synthetic instant (see
/// the module doc for both drift directions). `update_with_instant` only
/// advances `Time<Real>` — `time_system` recomputes the delta every frame, and
/// `Time<Virtual>` is only ever advanced by `time_system` — so nothing reads
/// the re-anchor as a simulation step.
fn release_pin(
    strategy: &mut TimeUpdateStrategy,
    pin: &mut SimulationClockPin,
    real_time: &mut Time<Real>,
) {
    *strategy = TimeUpdateStrategy::Automatic;
    pin.hz = None;
    real_time.update_with_instant(Instant::now());
}

/// Drain queued pin/unpin requests into Bevy's `TimeUpdateStrategy`.
///
/// Requests are applied in order, so the last one queued in a frame wins.
/// Scheduled in `First` before `TimeSystems` (see the module doc): the frame
/// that drains a request is already stepped on the new strategy. A rate below
/// the floor is applied — and recorded — at the floor, so what the resource
/// reports is always the period actually in force.
pub fn apply_frame_rate_pin_requests(
    mut pending: ResMut<PendingCommands>,
    mut strategy: ResMut<TimeUpdateStrategy>,
    mut pin: ResMut<SimulationClockPin>,
    mut real_time: ResMut<Time<Real>>,
) {
    if pending.frame_rate_pin_requests.is_empty() {
        return;
    }
    for request in pending.frame_rate_pin_requests.drain(..) {
        match request {
            FrameRatePinRequest::Pin { hz } => {
                let hz = hz.clamp(MIN_PIN_HZ, MAX_PIN_HZ);
                *strategy = TimeUpdateStrategy::ManualDuration(pin_duration(hz));
                pin.hz = Some(hz);
                tracing::info!("Pinned the simulation clock to {hz} Hz");
            }
            FrameRatePinRequest::Unpin => {
                release_pin(&mut strategy, &mut pin, &mut real_time);
                tracing::info!("Unpinned the simulation clock");
            }
        }
    }
}

/// Release the pin in force when Play stops.
///
/// Fires on the transition INTO `Edit` from any other mode (that is Stop; the
/// runner's own Pause goes to `Paused` and must keep the pin). Runs before
/// [`apply_frame_rate_pin_requests`] in the same frame, so an explicit request
/// queued in the frame Play stops still wins, and a pin made while already in
/// Edit is not touched: both stay until `unpin_frame_rate`. `EngineMode` is
/// read as an `Option` so an app without the mode machine (a focused test) is
/// simply never released by this path.
pub fn release_pin_when_play_stops(
    mode: Option<Res<EngineMode>>,
    mut previous_mode: Local<Option<EngineMode>>,
    mut strategy: ResMut<TimeUpdateStrategy>,
    mut pin: ResMut<SimulationClockPin>,
    mut real_time: ResMut<Time<Real>>,
) {
    let Some(mode) = mode else {
        return;
    };
    let current = *mode;
    let previous = previous_mode.replace(current);
    let entering_edit =
        current == EngineMode::Edit && previous.is_some_and(|p| p != EngineMode::Edit);
    // A stop the comparison cannot see (a Stop and a Play drained in one
    // update) is recorded on the resource by the applier. Consumed whether or
    // not a pin is in force, so it never lingers into a later session.
    let play_stopped = pin.play_stopped;
    if play_stopped {
        pin.play_stopped = false;
    }
    if !(entering_edit || play_stopped) || !pin.is_pinned() {
        return;
    }
    let hz = pin.hz;
    release_pin(&mut strategy, &mut pin, &mut real_time);
    tracing::info!("Released the simulation clock pin ({hz:?} Hz): Play mode ended");
}

/// Registers the pin resource, the Stop release and the drain. Pure core: no
/// bridge imports, and registered in BOTH the editor and the runtime build,
/// because an exported game is replayed the same way the editor's Play mode is.
pub struct SimulationClockPlugin;

impl Plugin for SimulationClockPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SimulationClockPin>().add_systems(
            First,
            (release_pin_when_play_stops, apply_frame_rate_pin_requests)
                .chain()
                .before(TimeSystems),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::time::{TimePlugin, Virtual};
    use serde_json::json;

    fn app() -> App {
        let mut app = App::new();
        app.add_plugins(TimePlugin);
        app.init_resource::<PendingCommands>();
        app.init_resource::<EngineMode>();
        app.add_plugins(SimulationClockPlugin);
        app
    }

    fn queue(app: &mut App, request: FrameRatePinRequest) {
        app.world_mut()
            .resource_mut::<PendingCommands>()
            .queue_frame_rate_pin(request);
    }

    fn set_mode(app: &mut App, mode: EngineMode) {
        *app.world_mut().resource_mut::<EngineMode>() = mode;
    }

    fn virtual_delta(app: &App) -> Duration {
        app.world().resource::<Time<Virtual>>().delta()
    }

    fn pin(app: &App) -> SimulationClockPin {
        *app.world().resource::<SimulationClockPin>()
    }

    fn is_automatic(app: &App) -> bool {
        matches!(
            *app.world().resource::<TimeUpdateStrategy>(),
            TimeUpdateStrategy::Automatic
        )
    }

    // === Validation ===

    #[test]
    fn an_absent_or_null_hz_means_the_default_rate() {
        assert_eq!(parse_pin_hz(None), Ok(DEFAULT_PIN_HZ));
        assert_eq!(parse_pin_hz(Some(&Value::Null)), Ok(DEFAULT_PIN_HZ));
    }

    #[test]
    fn an_integer_inside_the_bounds_is_accepted() {
        assert_eq!(parse_pin_hz(Some(&json!(30))), Ok(30));
        assert_eq!(parse_pin_hz(Some(&json!(MIN_PIN_HZ))), Ok(MIN_PIN_HZ));
        assert_eq!(parse_pin_hz(Some(&json!(MAX_PIN_HZ))), Ok(MAX_PIN_HZ));
    }

    #[test]
    fn out_of_range_values_are_refused_with_the_bound_named() {
        // 1, 2 and 3 Hz are refused: they would be accepted and then clamped
        // to 250 ms by `Time<Virtual>`, advancing more than the `1 / hz` the
        // contract promises.
        for bad in [json!(0), json!(1), json!(3), json!(241), json!(-60)] {
            let err = parse_pin_hz(Some(&bad)).unwrap_err();
            assert!(err.contains("between 4 and 240"), "{bad}: {err}");
        }
    }

    #[test]
    fn non_integer_values_are_refused_without_echoing_a_string() {
        let err = parse_pin_hz(Some(&json!(59.5))).unwrap_err();
        assert!(err.contains("got 59.5"), "{err}");
        // `60.0` is a float on the wire; the rate must be an integer.
        assert!(parse_pin_hz(Some(&json!(60.0))).is_err());
        let err = parse_pin_hz(Some(&json!("x".repeat(10_000)))).unwrap_err();
        assert!(err.contains("got a string"), "{err}");
        assert!(err.len() < 120, "a refusal must not echo the payload: {}", err.len());
        assert!(parse_pin_hz(Some(&json!(true))).is_err());
        assert!(parse_pin_hz(Some(&json!([60]))).is_err());
    }

    #[test]
    fn pin_duration_is_the_integer_nanosecond_period() {
        assert_eq!(pin_duration(60), Duration::from_nanos(16_666_666));
        assert_eq!(pin_duration(240), Duration::from_nanos(4_166_666));
        assert_eq!(pin_duration(MIN_PIN_HZ), Duration::from_millis(250));
        // Below the floor is the floor: never a period `Time<Virtual>` would clamp.
        assert_eq!(pin_duration(1), Duration::from_millis(250));
        assert_eq!(pin_duration(0), Duration::from_millis(250));
    }

    // === The clock itself ===

    /// The property the whole issue rests on: once pinned, every frame advances
    /// `Time` by the same duration no matter how long the frame really took.
    /// The sleep is what makes this decisive — on the wall clock the second
    /// delta would be >= 30 ms, and on a drain scheduled AFTER `time_system`
    /// the first pinned frame would still read the wall clock.
    #[test]
    fn a_pinned_clock_advances_exactly_one_tick_per_frame_regardless_of_wall_clock() {
        let mut app = app();
        app.update();
        app.update();
        assert!(!pin(&app).is_pinned());

        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        std::thread::sleep(Duration::from_millis(30));
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "first pinned frame");
        assert_eq!(pin(&app).hz, Some(60));

        std::thread::sleep(Duration::from_millis(30));
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "second pinned frame");
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(60), "back-to-back frame");
        assert!(matches!(
            *app.world().resource::<TimeUpdateStrategy>(),
            TimeUpdateStrategy::ManualDuration(d) if d == pin_duration(60)
        ));
    }

    /// Why the floor is 4 Hz: `Time<Virtual>` clamps every delta to
    /// `max_delta` (250 ms by default) and nothing here raises it. A 1 s
    /// manual step, which a 1 Hz pin would have asked for, comes out as 250 ms
    /// — so a rate below 4 Hz could never advance the `1 / hz` it claimed.
    #[test]
    fn bevy_clamps_a_one_second_frame_to_250_ms_which_is_why_the_floor_is_4_hz() {
        let mut app = app();
        app.update();
        app.insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs(1)));
        app.update();
        assert_eq!(virtual_delta(&app), Duration::from_millis(250));
        assert_eq!(
            app.world().resource::<Time<Virtual>>().max_delta(),
            Duration::from_millis(250),
            "the clamp this module's floor is derived from has moved; re-derive MIN_PIN_HZ"
        );
    }

    /// The slowest accepted rate is exactly the clamp, so it is still exact:
    /// read back from a real `Time<Virtual>` after one pinned frame, not from
    /// the `Duration` handed to the strategy.
    #[test]
    fn the_lowest_accepted_rate_is_exact_because_it_equals_the_clamp() {
        assert_eq!(pin_duration(MIN_PIN_HZ), Time::<Virtual>::default().max_delta());

        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: MIN_PIN_HZ });
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(MIN_PIN_HZ));
        assert_eq!(virtual_delta(&app), Duration::from_millis(250));
        app.update();
        assert_eq!(virtual_delta(&app), pin_duration(MIN_PIN_HZ), "second frame at the floor");
        assert_eq!(pin(&app).hz, Some(MIN_PIN_HZ));
    }

    /// The request type is public and the bridge validates before queuing, but
    /// the drain must not trust that: a rate below the floor is applied AND
    /// recorded at the floor, so the resource never reports a period the clock
    /// is not actually stepping.
    #[test]
    fn a_rate_below_the_floor_is_applied_and_recorded_at_the_floor() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 1 });
        app.update();
        assert_eq!(pin(&app).hz, Some(MIN_PIN_HZ));
        assert_eq!(virtual_delta(&app), pin_duration(MIN_PIN_HZ));
    }

    #[test]
    fn unpinning_returns_the_simulation_to_the_wall_clock() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        assert!(pin(&app).is_pinned());

        queue(&mut app, FrameRatePinRequest::Unpin);
        app.update();
        assert!(!pin(&app).is_pinned());
        assert!(is_automatic(&app));

        std::thread::sleep(Duration::from_millis(30));
        app.update();
        let delta = virtual_delta(&app);
        assert!(delta >= Duration::from_millis(30), "wall clock again: {delta:?}");
        assert_ne!(delta, pin_duration(60));
    }

    /// Frames rendered FASTER than the pinned rate: 60 back-to-back updates
    /// pinned at 60 Hz push the synthetic clock a full second ahead of the
    /// wall clock. The unpin frame's delta is zero either way
    /// (`saturating_duration_since`), and this test pins that the freeze is
    /// bounded to THAT ONE FRAME: the frame after the unpin must already read
    /// the wall clock. In bevy_time 0.19.1 `update_with_instant` moves
    /// `last_update` to the new instant unconditionally, so this holds with or
    /// without this module's re-anchor — it is the lagging test below that the
    /// re-anchor changes. Should a future bevy_time stop moving `last_update`
    /// on a saturated delta, this is the test that reports it.
    #[test]
    fn unpinning_re_anchors_the_wall_clock_when_the_pinned_clock_led() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        for _ in 0..60 {
            app.update();
            assert_eq!(virtual_delta(&app), pin_duration(60));
        }

        queue(&mut app, FrameRatePinRequest::Unpin);
        app.update();
        assert!(is_automatic(&app));
        let unpin_frame = virtual_delta(&app);
        assert!(
            unpin_frame < pin_duration(60),
            "the unpin frame itself is (near) zero, never a step: {unpin_frame:?}"
        );

        std::thread::sleep(Duration::from_millis(15));
        app.update();
        let delta = virtual_delta(&app);
        assert!(
            delta >= Duration::from_millis(15),
            "the frame after the unpin must measure from the wall clock, not stay at zero while \
             the wall clock catches up a synthetic second (delta was {delta:?})"
        );
        assert!(delta < Duration::from_millis(250), "not a clamped jump either: {delta:?}");
    }

    /// Frames rendered SLOWER than the pinned rate: four 40 ms frames pinned at
    /// 240 Hz advance the synthetic clock ~17 ms while the wall clock advances
    /// ~160 ms, so the synthetic clock LAGS by ~140 ms. Without the re-anchor,
    /// the unpin frame jumps by that whole lag (clamped at 250 ms); with it,
    /// the unpin frame is measured from now and is tiny, and the next frame
    /// is the time since the unpin.
    #[test]
    fn unpinning_re_anchors_the_wall_clock_when_the_pinned_clock_lagged() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 240 });
        for _ in 0..4 {
            std::thread::sleep(Duration::from_millis(40));
            app.update();
            assert_eq!(virtual_delta(&app), pin_duration(240));
        }

        queue(&mut app, FrameRatePinRequest::Unpin);
        app.update();
        let unpin_frame = virtual_delta(&app);
        assert!(
            unpin_frame < Duration::from_millis(50),
            "the unpin frame must not replay the ~140 ms the pinned clock fell behind by \
             (delta was {unpin_frame:?})"
        );

        std::thread::sleep(Duration::from_millis(15));
        app.update();
        let delta = virtual_delta(&app);
        assert!(delta >= Duration::from_millis(15), "wall clock from the unpin on: {delta:?}");
        assert!(delta < Duration::from_millis(100), "no leftover lag: {delta:?}");
    }

    #[test]
    fn the_last_request_queued_in_a_frame_wins() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 30 });
        queue(&mut app, FrameRatePinRequest::Pin { hz: 120 });
        app.update();
        assert_eq!(pin(&app).hz, Some(120));
        assert_eq!(virtual_delta(&app), pin_duration(120));
        assert!(app.world().resource::<PendingCommands>().frame_rate_pin_requests.is_empty());
    }

    #[test]
    fn a_frame_with_no_request_leaves_the_strategy_alone() {
        let mut app = app();
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        // Several request-free frames: the pin persists, nothing resets it.
        for _ in 0..5 {
            app.update();
            assert_eq!(virtual_delta(&app), pin_duration(60));
        }
        assert_eq!(pin(&app).hz, Some(60));
    }

    // === Stop releases a pin in force during Play ===

    /// A pin made through the `pin_frame_rate` tool has no runner to unpin it.
    /// Stop (Play → Edit) releases it, with the same re-anchor an explicit
    /// unpin gets, and no `Unpin` request is ever queued.
    #[test]
    fn stopping_play_releases_a_pin_that_outlived_its_replay() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        assert_eq!(pin(&app).hz, Some(60));

        set_mode(&mut app, EngineMode::Edit);
        app.update();
        assert!(!pin(&app).is_pinned(), "Stop must release the pin");
        assert!(is_automatic(&app));
        assert!(app.world().resource::<PendingCommands>().frame_rate_pin_requests.is_empty());

        std::thread::sleep(Duration::from_millis(20));
        app.update();
        let delta = virtual_delta(&app);
        assert!(delta >= Duration::from_millis(20), "wall clock after Stop: {delta:?}");
        assert!(delta < Duration::from_millis(250), "re-anchored, not a clamped jump: {delta:?}");
    }

    /// The runner's own Pause moves the engine to `Paused`, and a replay has
    /// to survive its own pause: only `Edit` releases.
    #[test]
    fn pausing_play_keeps_the_pin() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();

        set_mode(&mut app, EngineMode::Paused);
        app.update();
        assert_eq!(pin(&app).hz, Some(60), "Paused must not release the pin");
        assert_eq!(virtual_delta(&app), pin_duration(60));

        set_mode(&mut app, EngineMode::Play);
        app.update();
        assert_eq!(pin(&app).hz, Some(60), "resuming must not release the pin either");
        assert_eq!(virtual_delta(&app), pin_duration(60));
    }

    /// Entering Edit when nothing is pinned is not a release: the wall clock
    /// is not re-anchored behind an ordinary Stop.
    #[test]
    fn stopping_play_with_no_pin_in_force_touches_nothing() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        std::thread::sleep(Duration::from_millis(20));
        set_mode(&mut app, EngineMode::Edit);
        app.update();
        assert!(!pin(&app).is_pinned());
        assert!(is_automatic(&app));
        let delta = virtual_delta(&app);
        assert!(delta >= Duration::from_millis(20), "an unpinned Stop frame reads the wall clock: {delta:?}");
    }

    /// The release runs before the drain in the same frame, so a request
    /// queued in the frame Play stops is the one that stands.
    #[test]
    fn a_pin_queued_in_the_frame_play_stops_still_wins() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();

        set_mode(&mut app, EngineMode::Edit);
        queue(&mut app, FrameRatePinRequest::Pin { hz: 30 });
        app.update();
        assert_eq!(pin(&app).hz, Some(30));
        assert_eq!(virtual_delta(&app), pin_duration(30));
    }

    /// The mode applier drains every queued request in one update: a Stop and
    /// a Play in the same drain leave `EngineMode` at `Play` on both sides of
    /// the frame, so the transition is invisible to the mode comparison. The
    /// applier records the stop on the pin resource instead, and the release
    /// honours it (Sentry finding on #10369).
    #[test]
    fn a_stop_and_a_play_drained_in_one_update_still_release_the_pin() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        assert_eq!(pin(&app).hz, Some(60));

        // What the applier does within one Update for a queued [Stop, Play].
        set_mode(&mut app, EngineMode::Edit);
        app.world_mut().resource_mut::<SimulationClockPin>().on_play_stopped();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        assert!(!pin(&app).is_pinned(), "the stop recorded by the applier must release the pin");
        assert!(is_automatic(&app));

        // The record is consumed: a pin made in the new session is not
        // released by a stale stop on a later frame.
        queue(&mut app, FrameRatePinRequest::Pin { hz: 30 });
        app.update();
        assert_eq!(pin(&app).hz, Some(30));
        app.update();
        assert_eq!(pin(&app).hz, Some(30), "a consumed stop must not release a later pin");
        assert_eq!(virtual_delta(&app), pin_duration(30));
    }

    /// A recorded stop with nothing pinned is consumed all the same, so it
    /// cannot release a pin made afterwards.
    #[test]
    fn a_recorded_stop_with_no_pin_in_force_is_consumed_quietly() {
        let mut app = app();
        app.update();
        set_mode(&mut app, EngineMode::Play);
        app.update();
        app.world_mut().resource_mut::<SimulationClockPin>().on_play_stopped();
        app.update();
        assert!(is_automatic(&app));
        assert!(!pin(&app).is_pinned());

        queue(&mut app, FrameRatePinRequest::Pin { hz: 60 });
        app.update();
        app.update();
        assert_eq!(pin(&app).hz, Some(60), "the stale stop must have been consumed");
        assert_eq!(virtual_delta(&app), pin_duration(60));
    }

    /// The applier's call site is bridge code (wasm32-only), so no native test
    /// runs it. This pins the EXECUTABLE call inside the Stop arm and its
    /// absence from the Pause and Resume arms; it does not prove the arm runs.
    /// `SPAWNFORGE_ENGINE_SRC` redirects the source root for a probe crate
    /// built outside `engine/`.
    #[test]
    fn the_mode_applier_records_the_stop_in_its_stop_arm_only() {
        let root = std::env::var("SPAWNFORGE_ENGINE_SRC")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/src").to_string());
        let path = format!("{root}/bridge/core_systems.rs");
        let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let arm = |name: &str| -> String {
            assert_eq!(source.matches(name).count(), 1, "{name} must appear exactly once");
            let start = source.find(name).unwrap() + name.len();
            let rest = &source[start..];
            let end = rest.find("ModeChangeRequest::").unwrap_or(rest.len());
            rest[..end].to_string()
        };
        let calls = |body: &str| {
            body.lines()
                .map(str::trim)
                .filter(|line| !line.starts_with("//"))
                .filter(|line| *line == "clock_pin.on_play_stopped();")
                .count()
        };
        assert_eq!(calls(&arm("ModeChangeRequest::Stop =>")), 1, "the Stop arm must record the stop exactly once");
        assert_eq!(calls(&arm("ModeChangeRequest::Pause =>")), 0, "Pause keeps the pin and must not record a stop");
        assert_eq!(calls(&arm("ModeChangeRequest::Resume =>")), 0, "Resume must not record a stop");
    }
}
