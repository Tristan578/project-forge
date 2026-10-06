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
  (integer 1–240, default 60, bounded error text), the drain system
  `apply_frame_rate_pin_requests`, and `SimulationClockPlugin`.
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
- Unpinning returns to `Automatic`. The first automatic frame measures its
  delta from the last *synthetic* instant, so it can be large; `Time<Virtual>`
  clamps it to `max_delta` (250 ms by default) — the same treatment Bevy gives
  any stalled frame — and Rapier additionally caps physics at `max_dt`. A
  replay normally ends with Play being stopped, so this is rarely visible; it
  is documented here rather than hidden.
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
- bevy_time 0.19.1 `time_system` / `TimeUpdateStrategy`; bevy_rapier2d 0.35 `TimestepMode::Variable`
