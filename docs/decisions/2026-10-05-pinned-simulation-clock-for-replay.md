# Pin the simulation clock for input replay instead of waiting for a GPU runner

- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** #10007 (promotes `web/e2e/engine/inputReplay.spec.ts` to the required `@engine-smoke` gate), extending #9902; program #9773, native parent #9877

## Decision

While an input trace is being replayed, the engine's simulation clock is
**pinned**: the runner dispatches `pin_frame_rate` (default 60 Hz) before the
first tick and `unpin_frame_rate` on every exit path (completion, cancellation,
failure). The engine implements the pin with Bevy's own
`TimeUpdateStrategy::ManualDuration(1 / hz)`, so each rendered frame advances
`Time` by exactly one tick regardless of how long the frame took on the wall
clock. One trace frame is injected per engine frame, which makes the replay's
observed outcome (displacement, collection) a function of the trace alone.

The alternative named by #9902 — run the spec on a GPU-capable runner — is
rejected for the per-PR gate. It is kept as the nightly / broad `@engine`
sweep's job, where it covers what SwiftShader cannot (WebGPU, real-GPU
rendering), but it does not make a cadence-dependent assertion deterministic:
a GPU runner still has a variable frame rate.

## Context

Every simulation system in this engine steps by `Time::delta_secs()`:
`game_components::system_character_controller` scales movement by it, and
Rapier's default `TimestepMode::Variable` integrates
`min(delta * time_scale, max_dt)` per frame (bevy_rapier 0.35). Nothing runs in
`FixedUpdate` (`grep FixedUpdate engine/src`: no hits at 2218e9be1). So under
a wall clock, how far 120 frames of "hold right" carry the player depends on
how long each of those frames took — and under ANGLE/SwiftShader on the CI
runner that varies from frame to frame and run to run. That is why #9902
tagged the spec `@engine-replay` rather than `@engine-smoke`, and why
`pipeline-live-engine.spec.ts` defers `game_win`.

The engine already drives its frame loop one Bevy update per `requestAnimationFrame`
(`bevy_winit` on wasm, `WinitSettings` default), and the replay runner already
advances one trace frame per engine frame (`advanceFrame` resolves on the next
`publishPlayTick`, which `emit_play_tick_system` emits once per frame in Play).
The only non-deterministic input to the simulation was `Time`. Bevy exposes
exactly the knob needed: `bevy_time::TimeUpdateStrategy`, read by `time_system`
in `First`, with a `ManualDuration` variant that advances `Time<Real>` by a
fixed duration per frame. `Time<Virtual>` and the default `Time` follow it, and
Rapier reads `Time` in `PostUpdate`.

## How it is built

- `engine/src/core/simulation_clock.rs` (pure core): `FrameRatePinRequest`,
  the `SimulationClockPin` resource (what is in force, readable), `parse_pin_hz`
  (integer 4–240, default 60, bounded error text), the drain system
  `apply_frame_rate_pin_requests`, the Stop release
  `release_pin_when_play_stops`, and `SimulationClockPlugin`.
- **`hz` is a rate — simulation ticks per second of game time — not a count of
  ticks per frame.** The engine always advances exactly ONE tick per rendered
  frame; `hz` only decides how long that tick is (`1 / hz` s).
- **The floor is 4 Hz because `Time<Virtual>` clamps every delta to its
  `max_delta` (250 ms by default, bevy_time `virt.rs`) and nothing here calls
  `set_max_delta`.** A 1, 2 or 3 Hz pin would be accepted and then silently
  advance 250 ms per frame — not the `1 / hz` the command promises. 4 Hz is a
  250 ms tick, the clamp itself, so the slowest accepted rate is still exact.
  Pinned by `the_lowest_accepted_rate_is_exact_because_it_equals_the_clamp`,
  which reads the delta back from a real `Time<Virtual>` after a pinned frame,
  and by `bevy_clamps_a_one_second_frame_to_250_ms_which_is_why_the_floor_is_4_hz`,
  which asserts the clamp the floor is derived from. The drain clamps (and
  RECORDS) a below-floor request at the floor, so the resource never reports a
  period the clock is not stepping.
- **Physics tracks the pin only at `hz >= 60`.** Rapier's
  `TimestepMode::Variable` caps its step at `max_dt = 1 / 60` s, so below 60 Hz
  the character controller and every other `Time`-stepped gameplay system
  advance `1 / hz` per frame while physics advances `1 / 60`. The run is still
  deterministic — both steps are constants — but the two are no longer the
  same length. The default (and the gate's) 60 Hz is exactly the rate at which
  they coincide.
- The drain runs in `First` **before** `TimeSystems`, so a request queued from
  the bridge between two frames is already in force when the very next frame's
  `time_system` runs. A runner that dispatches the pin and then awaits one play
  tick therefore replays every frame it touches on the pinned clock. Pinned by
  `a_pinned_clock_advances_exactly_one_tick_per_frame_regardless_of_wall_clock`,
  which sleeps between frames and asserts the delta anyway.
- Commands `pin_frame_rate { hz? }` / `unpin_frame_rate` are routed inline
  (domain 12, beside `play` / `pause` / `resume`) and queue onto
  `PendingCommands.frame_rate_pin_requests`. The plugin is registered in BOTH
  the editor and the runtime build: an exported game is replayed the same way.
- Web: `ReplayEnvironment` gained `pinFrameRate` / `unpinFrameRate` /
  `pauseRuntime` / `resumeRuntime`; the browser boundary dispatches the engine
  commands and reads the engine's own `CommandResponse` — only an explicit
  `success: true` counts as pinned. A dispatcher that answers nothing (a
  stand-in with no engine, or a pre-#10007 engine) is NOT a pin, and the runner
  refuses to replay rather than report a verdict from an unpinned run
  (`ReplayPinRefusedError`). `ReplayOutcome.pinned` / `pinHz` record it, and the
  gate asserts `pinned === true`.

## Consequences

- `web/e2e/engine/inputReplay.spec.ts` is tagged `@engine-smoke` and runs on
  every PR. Its describe block raises the cap to `E2E_TIMEOUT_PIPELINE_LIVE_MS`
  (one cold boot, three replays, two Play/Stop round-trips); the justification
  for the added minutes is in `docs/testing-principles.md` §9.
- Unpinning returns to `Automatic` **and re-anchors `Time<Real>` at
  `Instant::now()`**. Without the re-anchor the first automatic frame measured
  its delta from the last *synthetic* instant, and the two clocks have drifted
  in one of two directions. On a SLOW rasteriser (15 fps pinned at 60) the
  synthetic clock lags, and the unpin frame jumped by the whole lag — ~150 ms
  of simulation in one frame, clamped to `max_delta`; this is the direction
  the re-anchor fixes (`unpinning_re_anchors_the_wall_clock_when_the_pinned_clock_lagged`
  goes red without it). On a display FASTER than the pinned rate (144 Hz pinned
  at 60) the synthetic clock leads, `Time<Real>::update_with_instant` uses
  `saturating_duration_since`, and the unpin frame's delta is zero — in
  bevy_time 0.19.1 that is ONE dropped frame, not a freeze, because
  `update_with_instant` moves `last_update` to the new instant unconditionally
  (the review's expectation of "every delta zero until the wall clock catches
  up" does not hold on this version; `..._led` pins the one-frame bound and is
  green with or without the re-anchor). With the re-anchor the unpin frame is
  near zero in both directions and the frame after it is measured from the
  unpin.
- **Stop releases a pin that is in force during Play.** The web runner unpins
  on every exit path, but a pin made directly through the `pin_frame_rate`
  tool (the in-app AI, an MCP client) has no owner. The engine therefore
  releases the pin in force on the Play → Edit transition (Stop), with the
  same re-anchor, in `First` before the drain. That is the whole rule: the
  release runs only on that transition, so a pin queued in the frame Play
  stops, or made while already in Edit, stays until `unpin_frame_rate` — an
  explicit request is never silently discarded. The runner's own Pause moves
  the engine to `Paused`, not `Edit`, and keeps the pin
  (`stopping_play_releases_a_pin_that_outlived_its_replay`,
  `pausing_play_keeps_the_pin`, `a_pin_queued_in_the_frame_play_stops_still_wins`).
- **One replay at a time.** The pin is engine-global, and each run unpins on
  its own exit, so two overlapping runs would have the first's unpin land in
  the middle of the second. `web/src/lib/playtest/replayEntryPoints.ts` holds a
  module-level single-flight guard shared by the manual panel, the E2E hooks
  and the AI tool: a second start is refused with `ReplayBusyError` before it
  pins or touches a key, and the active run is untouched. The same module
  cancels the active run when the editor leaves Play for Edit, whichever entry
  point started it.
- A pinned clock is NOT a frame-rate limiter. A fast machine renders more frames
  per second than the pinned rate and the game runs faster than real time while
  pinned; a slow one runs slower. That is the point for a replay (the trace
  decides the outcome) and the reason the pin is scoped to the replay and
  always released.
- Determinism is for the SAME engine build and scene. The gate compares two
  runs within one test on one engine; it does not promise bit-equality across
  engine versions or across the WebGL2 / WebGPU backends.
- Anything that reads `Time<Real>` directly for a wall-clock purpose
  (`core/render_errors.rs` uses it for its "second error within 10 s" window)
  sees synthetic time while pinned: a 120-tick replay advances it by 2 s, not
  by the wall time elapsed. Acceptable for that window; a future wall-clock
  consumer should read `Instant::now()` or be added to this list.
- The AI gameplay bot's plan is converted to the same `InputTrace`
  (`web/src/lib/playtest/botTrace.ts`) and replayed through the same command;
  manual and AI invocations are held to identical engine command sequences by
  `replayParity.test.ts`. The bot's runtime verdict is a `ReplayOutcome`, never
  a heuristic rating — the two are kept in separate types on purpose.
- **Reopening this decision requires a new ADR**: for example, if the engine
  moves its simulation into `FixedUpdate` with an accumulator (which would make
  frame cadence irrelevant without a pin), or if a per-PR GPU runner is
  provisioned for other reasons.

## References

- `engine/src/core/simulation_clock.rs` — the implementation and its tests
- `web/src/lib/playtest/replayRunner.ts` — pin before the first tick, unpin on every exit
- `web/src/lib/playtest/replayInvocation.ts` — the browser boundary and its acceptance rule
- `web/e2e/engine/inputReplay.spec.ts` — the promoted gate (Scenario 3 included)
- `docs/testing-principles.md` §9 — the curated set and the cadence rule
- bevy_time 0.19.1 `time_system` / `TimeUpdateStrategy` / `Time<Real>::update_with_instant`
  (`real.rs`) / `Time<Virtual>::DEFAULT_MAX_DELTA` (`virt.rs`); bevy_rapier2d 0.35
  `TimestepMode::Variable`. Versions verified against `engine/Cargo.lock` on
  2026-10-06 (bevy 0.19.1, bevy_time 0.19.1, bevy_rapier2d / bevy_rapier3d
  0.35.0, wgpu 29.0.4), which is also what the CI WASM Build job downloads;
  `engine/Cargo.toml` declares `bevy = "0.19.1"`.
