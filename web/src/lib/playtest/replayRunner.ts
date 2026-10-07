/**
 * Runtime input-trace replay runner (#9902, qa.FR-1.OP-01 / qa.FR-1.OP-03;
 * pinned runtime, pause/cancel/restart and AI parity: #10007).
 *
 * ONE typed command — `replay_input_trace` — replays a bounded `InputTrace`
 * through the REAL runtime input path (named actions → key codes → the same
 * DOM-keyboard channel a human's keystrokes travel, which the engine's
 * `capture_input` reads from Bevy's `ButtonInput`), then reads OBSERVED engine
 * state and returns a pass/fail verdict backed by tick/action/outcome evidence.
 *
 * THE RUNTIME IS PINNED FOR THE WHOLE REPLAY. Before the first tick the runner
 * dispatches `pin_frame_rate` (engine: `core::simulation_clock`), which makes
 * every rendered frame advance the simulation by exactly `1 / hz` seconds
 * regardless of how long the frame took on the wall clock. One trace frame is
 * injected per engine frame, so the same trace produces the same displacement
 * on a 15 fps software rasteriser and a 144 Hz desktop — that is what lets
 * `e2e/engine/inputReplay.spec.ts` be a required per-PR gate. The clock is
 * unpinned on EVERY exit path: completion, cancellation and failure. An engine
 * that refuses the pin fails the replay before any input is injected, so a
 * verdict is never produced on an unpinned clock without saying so
 * (`ReplayOutcome.pinned`). An unpin that FAILS after a completed run does not
 * taint the verdict — the run was pinned — and is reported beside it
 * (`ReplayRunResult.unpinError`); the engine also releases any pin on Stop.
 *
 * The pin is engine-global, so only ONE replay may run at a time. That guard
 * is not here: `replayEntryPoints.ts` holds the module-level single-flight
 * guard every entry point (manual panel, E2E hooks, AI tool) goes through,
 * and this runner stays a pure function of its environment.
 *
 * PAUSE / RESUME / CANCEL are first-class (`startReplay` returns a handle):
 * pausing releases every synthetic key and pauses the runtime at a tick
 * boundary; resuming resumes the runtime and the key diff re-presses whatever
 * the trace holds on that tick; cancelling releases input, leaves the runtime
 * as the runner found it, unpins, and yields NO outcome — a cancelled run can
 * never read as a pass or a fail. A cancel does NOT wait for the frame in
 * flight: a stopped engine never ticks again, so the keys are released and the
 * clock unpinned the moment the cancel lands, not after a stalled-tick timeout.
 * A cancel can land at ANY await — including from inside the 'paused'
 * notification itself — and `result` still settles exactly once, as
 * `cancelled`; 'cancelling' is never overwritten by a state the cancel
 * interrupted (`__tests__/replayController.test.ts`, "a cancel that races the
 * pause").
 *
 * WHY THIS IS NOT `gameplayBot.ts`. `simulatePlaytest` in `lib/ai/gameplayBot.ts`
 * is a HEURISTIC: it inspects the scene graph statically and produces an
 * `overallRating` ('excellent' | 'good' | 'needs_work' | 'critical_issues')
 * WITHOUT ever running the engine. This runner runs the engine and asserts on
 * what it observed. The two must never be conflated: a `ReplayOutcome.verdict`
 * of `'failed'` is a real runtime failure and CANNOT be satisfied by a heuristic
 * rating. Deliberately, this module exposes no `rating` and imports nothing from
 * `gameplayBot`, and its result type carries `verdict`, not `overallRating`, so
 * a caller cannot accidentally read one where it meant the other. (The AI bot's
 * planned actions can be TURNED INTO a trace — `botTrace.ts` — and replayed
 * here; that is the bot operating the real game, not a rating.)
 */

import {
  parseInputTrace,
  type InputTrace,
  type InputTraceFrame,
} from './inputTrace';

/** Command identifier of the shared replay runner (manual button, E2E hook, AI tool). */
export const REPLAY_INPUT_TRACE_COMMAND = 'replay_input_trace' as const;

/** Minimum world-unit displacement that counts as "the entity moved". Also the
 *  tolerance Scenario 3 allows between a restarted run and an uninterrupted one. */
export const MOVE_EPSILON = 0.01;

/** Simulation rate the runner pins unless the caller asks for another. */
export const DEFAULT_REPLAY_PIN_HZ = 60;

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** The observed runtime state the runner reads before and after a replay. */
export interface ReplayObservation {
  entities: Record<string, { position: [number, number, number] }>;
}

/**
 * The runtime boundary the runner drives. Every method is injectable so unit
 * tests can supply a deterministic fake engine, while the browser wires the
 * real DOM-keyboard channel, the play-tick bus and the engine command
 * dispatcher (see `replayInvocation.ts`).
 */
export interface ReplayEnvironment {
  /**
   * Resolve a named action, in the state it held on a tick, to the key
   * `event.code`s currently bound to it. The `state` is passed so an AXIS
   * action presses only the direction it was recorded in (positive vs
   * negative) rather than both keys, which would cancel out.
   * @param actionName Recorded action to resolve in current bindings.
   * @param state Recorded digital/axis state for that action.
   * @returns Bound key codes for the recorded direction, or an empty list.
   */
  resolveKeys(actionName: string, state: InputTraceFrame['actions'][string]): string[];
  /**
   * @param codes Key codes to press through the input boundary.
   * @returns Completion of input delivery, synchronously or asynchronously.
   */
  pressKeys(codes: string[]): void | Promise<void>;
  /**
   * @param codes Previously pressed key codes to release.
   * @returns Completion of input delivery, synchronously or asynchronously.
   */
  releaseKeys(codes: string[]): void | Promise<void>;
  /** @returns Completion of one observed engine tick; rejects if the boundary stalls. */
  advanceFrame(): Promise<void>;
  /** @returns The latest observed runtime snapshot, or null if none exists. */
  observe(): ReplayObservation | null;
  /** The entity whose displacement proves input reached the runtime. */
  playerEntityId: string;
  /** Collectible entity ids expected to be collected (despawned) on replay. */
  collectibleEntityIds: string[];
  /**
   * Pin the simulation clock to `hz` ticks per second of game time
   * (`pin_frame_rate`; the engine advances exactly one tick per rendered
   * frame). Returns whether the engine ACCEPTED the pin; a refusal fails the
   * replay before any input is injected. Absent on a boundary with no clock
   * (unit fakes), in which case the outcome records `pinned: false`.
   * @param hz Simulation rate to pin.
   * @returns Whether the engine accepted the pin.
   */
  pinFrameRate?(hz: number): boolean | Promise<boolean>;
  /** Return the simulation to the wall clock (`unpin_frame_rate`). May throw on a refusal. */
  unpinFrameRate?(): void | Promise<void>;
  /** Pause the runtime while the replay is paused (engine `pause`). May throw on a refusal. */
  pauseRuntime?(): void | Promise<void>;
  /** Resume a runtime this runner paused (engine `resume`). May throw on a refusal. */
  resumeRuntime?(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/** One observed-state assertion, tagged with the requirement it evidences. */
export interface ReplayAssertion {
  /** Operation id from #9902's crosswalk (e.g. 'qa.FR-1.OP-01'). */
  operationId: string;
  description: string;
  passed: boolean;
  /** Concrete evidence — never just a boolean — so a failure is diagnosable. */
  evidence: Record<string, unknown>;
}

/**
 * The result of a replay. `verdict` is a RUNTIME outcome, not a heuristic
 * rating (see the module header). It is `'passed'` only when every assertion
 * passed.
 */
export interface ReplayOutcome {
  command: typeof REPLAY_INPUT_TRACE_COMMAND;
  verdict: 'passed' | 'failed';
  ticksReplayed: number;
  assertions: ReplayAssertion[];
  playerEntityId: string;
  startPosition: [number, number, number] | null;
  endPosition: [number, number, number] | null;
  movedDistance: number | null;
  collectiblesCollected: number;
  /** Whether the engine's clock was pinned for the whole run. */
  pinned: boolean;
  /** The pinned rate, or null when the boundary had no clock to pin. */
  pinHz: number | null;
}

// ---------------------------------------------------------------------------
// Controlled run: states, progress, handle
// ---------------------------------------------------------------------------

/**
 * Runner states. `pausing` / `cancelling` are the SYNCHRONOUS acknowledgements
 * of a control request; the matching settled state follows at the next tick
 * boundary (within one frame), once every synthetic key has been released.
 * `cancelling` is sticky: only `cancelled` (or a boundary failure) follows it.
 */
export type ReplayRunState =
  | 'pinning'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** What a UI shows while a replay runs: state, position in the trace, held input. */
export interface ReplayProgress {
  state: ReplayRunState;
  /** Ticks replayed so far — equivalently, the next tick to inject. */
  tick: number;
  totalTicks: number;
  /** Synthetic key codes currently held through the input boundary. */
  heldKeys: string[];
  /** Engine's answer to the pin: null until asked, false when it had no clock or refused. */
  pinned: boolean | null;
}

export interface ReplayRunOptions {
  /**
   * Pause automatically BEFORE injecting this tick's input, i.e. after exactly
   * `pauseAtTick` ticks have been replayed. Exact by construction: the boundary
   * is a tick count, not a wall-clock moment. `totalTicks` is a valid boundary:
   * the run pauses after its last tick, before the settle frames.
   */
  pauseAtTick?: number;
  /** Simulation rate to pin; `DEFAULT_REPLAY_PIN_HZ` when omitted. */
  pinHz?: number;
  /** Receives the handle as soon as it exists (for callers using `replayInputTrace`). */
  onHandle?: (handle: ReplayHandle) => void;
}

/**
 * How a controlled run ended. A cancelled run carries no outcome, by design.
 * A completed run whose unpin FAILED still carries its outcome — the run was
 * pinned — with the unpin failure reported beside it, never as a failed run.
 */
export type ReplayRunResult =
  | { status: 'completed'; outcome: ReplayOutcome; unpinError?: string }
  | { status: 'cancelled'; ticksReplayed: number }
  | { status: 'failed'; error: Error; ticksReplayed: number };

/** Control surface of a running replay. Every control returns whether it applied. */
export interface ReplayHandle {
  /** Settles exactly once; never rejects — failures are `status: 'failed'`. */
  readonly result: Promise<ReplayRunResult>;
  /**
   * Request a pause at the next tick boundary. Applies while pinning or
   * running, up to and including the final boundary (after the last tick);
   * refused once the run is in its settle frames, where no boundary is left.
   */
  pause(): boolean;
  /** Resume a paused run, or withdraw a pause that has not settled yet. */
  resume(): boolean;
  /** Stop the run, release input, unpin. Applies once, in any non-terminal state. */
  cancel(): boolean;
  getProgress(): ReplayProgress;
  /** Progress notifications are delivered synchronously on every state change and tick. */
  subscribe(listener: (progress: ReplayProgress) => void): () => void;
}

/** Thrown by `replayInputTrace` when the run was cancelled through its handle. */
export class ReplayCancelledError extends Error {
  readonly ticksReplayed: number;
  /** @param ticksReplayed Ticks injected before the cancellation took effect. */
  constructor(ticksReplayed: number) {
    super(`Replay cancelled after ${ticksReplayed} ticks; no outcome was produced.`);
    this.name = 'ReplayCancelledError';
    this.ticksReplayed = ticksReplayed;
  }
}

/** Thrown when the engine refused to pin its clock; no input was injected. */
export class ReplayPinRefusedError extends Error {
  /** @param hz The rate the runner asked for. */
  constructor(hz: number) {
    super(
      `Replay refused: the engine did not accept pin_frame_rate at ${hz} Hz, ` +
        'so the run could not be made deterministic. No input was injected.',
    );
    this.name = 'ReplayPinRefusedError';
  }
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Key codes active on a given tick, unioned across every pressed action. */
function keysForFrame(frame: InputTraceFrame, env: ReplayEnvironment): Set<string> {
  const codes = new Set<string>();
  for (const [actionName, state] of Object.entries(frame.actions)) {
    if (!state.pressed && (state.axis ?? 0) === 0) continue;
    for (const code of env.resolveKeys(actionName, state)) codes.add(code);
  }
  return codes;
}

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}

const TERMINAL_STATES: ReadonlySet<ReplayRunState> = new Set(['completed', 'cancelled', 'failed']);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Start a controlled replay of a bounded input trace through the real runtime.
 *
 * The trace is validated here (identical `parseInputTrace` gate as the
 * recorder), so an invalid trace THROWS synchronously before any input is
 * injected and before a handle exists. Everything after that is reported
 * through the handle's `result`, which never rejects.
 *
 * Keys are diffed frame-to-frame — released when an action ends, pressed when
 * it begins, HELD across ticks that keep it down — which is what makes a
 * held-key trace behave like a held key rather than a burst of taps, and what
 * re-presses a held key after a pause without any special case.
 * @param trace Recording to validate before injecting any input.
 * @param env Input injection, tick advancement, observation and clock boundary.
 * @param options Pause boundary, pin rate, handle callback.
 * @returns The control handle; its `result` settles when the run ends.
 * @throws InputTraceValidationError for an invalid trace.
 */
export function startReplay(
  trace: InputTrace,
  env: ReplayEnvironment,
  options: ReplayRunOptions = {},
): ReplayHandle {
  const validated = parseInputTrace(trace);
  const pinHz = options.pinHz ?? DEFAULT_REPLAY_PIN_HZ;

  const framesByTick = new Map<number, InputTraceFrame>();
  for (const frame of validated.frames) framesByTick.set(frame.tick, frame);
  const lastTick = validated.frames.reduce((max, f) => Math.max(max, f.tick), -1);
  const totalTicks = lastTick + 1;

  const held = new Set<string>();
  const listeners = new Set<(progress: ReplayProgress) => void>();
  const progress: ReplayProgress = {
    state: 'pinning',
    tick: 0,
    totalTicks,
    heldKeys: [],
    pinned: null,
  };

  let pauseRequested = false;
  let cancelRequested = false;
  let pauseArmed = options.pauseAtTick !== undefined;
  /** Set once the final tick boundary is behind us: no pause can settle any more. */
  let pastFinalBoundary = false;
  /** Set while paused: resume or cancel resolves it. */
  let wakeUp: (() => void) | null = null;
  /** Set while a frame is awaited: cancel resolves it so the wait ends at once. */
  let abandonFrame: (() => void) | null = null;

  const notify = () => {
    progress.heldKeys = [...held];
    const snapshot: ReplayProgress = { ...progress, heldKeys: [...progress.heldKeys] };
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // A UI listener must never take the replay down with it.
        console.error('[replayRunner] progress listener threw; continuing', error);
      }
    }
  };
  /**
   * 'cancelling' is sticky. A cancel can land in the middle of any await, and
   * the code after that await was written for the state it interrupted
   * (announcing 'paused', 'running'); none of those may paint over a cancel
   * the creator has already been shown. Only the cancel's own settlement — or
   * a boundary failure while settling it — replaces it.
   */
  const setState = (state: ReplayRunState) => {
    if (progress.state === 'cancelling' && state !== 'cancelled' && state !== 'failed') return;
    progress.state = state;
    notify();
  };

  const releaseHeld = async () => {
    if (held.size === 0) return;
    const codes = [...held];
    held.clear();
    await env.releaseKeys(codes);
  };

  const handle: ReplayHandle = {
    result: Promise.resolve({ status: 'cancelled', ticksReplayed: 0 }), // replaced below
    pause: () => {
      if (pastFinalBoundary) return false;
      if (progress.state !== 'running' && progress.state !== 'pinning') return false;
      pauseRequested = true;
      setState('pausing');
      return true;
    },
    resume: () => {
      if (progress.state === 'pausing') {
        pauseRequested = false;
        setState('running');
        return true;
      }
      if (progress.state !== 'paused') return false;
      pauseRequested = false;
      wakeUp?.();
      return true;
    },
    cancel: () => {
      if (TERMINAL_STATES.has(progress.state) || cancelRequested) return false;
      cancelRequested = true;
      pauseRequested = false;
      setState('cancelling');
      wakeUp?.();
      abandonFrame?.();
      return true;
    },
    getProgress: () => ({ ...progress, heldKeys: [...held] }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const run = async (): Promise<ReplayRunResult> => {
    let ticksReplayed = 0;
    let runtimePausedByRunner = false;
    let pinnedByRunner = false;

    /**
     * Unpin if this runner pinned. Returns the failure instead of throwing:
     * the exit path decides what it taints, and on completion it taints
     * nothing — the run WAS pinned; only the release failed.
     */
    const unpin = async (): Promise<Error | null> => {
      if (!pinnedByRunner) return null;
      pinnedByRunner = false;
      try {
        await env.unpinFrameRate?.();
        return null;
      } catch (caught) {
        const error = toError(caught);
        console.error('[replayRunner] could not unpin the clock', error);
        return error;
      }
    };

    const resumeRuntimeIfPaused = async (): Promise<void> => {
      if (!runtimePausedByRunner) return;
      runtimePausedByRunner = false;
      await env.resumeRuntime?.();
    };

    /**
     * Wait for the next engine frame — or stop waiting the moment the run is
     * cancelled. A stopped engine never ticks again, so a cancel that waited
     * for the frame would leave synthetic keys held until the boundary's own
     * stalled-tick timeout turned the creator's cancel into a failure. The
     * abandoned frame settles on its own later; `race` has already attached
     * handlers to it, so a late rejection never surfaces as unhandled.
     */
    const awaitFrame = async (): Promise<void> => {
      if (cancelRequested) return;
      const frame = Promise.resolve(env.advanceFrame());
      const cancelled = new Promise<void>((resolve) => {
        abandonFrame = resolve;
      });
      try {
        await Promise.race([frame, cancelled]);
      } finally {
        abandonFrame = null;
      }
    };

    /**
     * A cancelled run releases input, restores a runtime this runner paused,
     * unpins, and reports NO outcome — whichever point of the run the cancel
     * landed at. Every step is best-effort: a boundary that fails while the
     * creator's cancel is being honoured is logged, and the result is still
     * the cancellation they asked for, settled exactly once.
     */
    const finishCancelled = async (ticks: number): Promise<ReplayRunResult> => {
      try {
        await releaseHeld();
      } catch (releaseError) {
        console.error('[replayRunner] could not release held keys while cancelling', releaseError);
      }
      try {
        await resumeRuntimeIfPaused();
      } catch (resumeError) {
        console.error('[replayRunner] could not resume the runtime while cancelling', resumeError);
      }
      await unpin();
      setState('cancelled');
      return { status: 'cancelled', ticksReplayed: ticks };
    };

    /**
     * Settle a requested pause at the tick boundary `tick` and wait to be
     * woken. Returns false when a cancel landed anywhere in the process, so
     * the caller stops. A cancel can arrive during every await here AND from
     * inside the 'paused' notification itself (a UI that cancels on seeing
     * 'paused' — the case the review-board reproduced), so `cancelRequested`
     * is re-checked after each await, and the wake-up promise exists BEFORE
     * 'paused' is announced so that a cancel always has something to resolve.
     */
    const pauseAtBoundary = async (tick: number): Promise<boolean> => {
      // No synthetic key stays down while the creator reads the frozen scene.
      await releaseHeld();
      if (cancelRequested) return false;
      if (env.pauseRuntime) {
        await env.pauseRuntime();
        runtimePausedByRunner = true;
        if (cancelRequested) return false;
      }
      progress.tick = tick;
      const woken = new Promise<void>((resolve) => {
        wakeUp = resolve;
      });
      setState('paused');
      await woken;
      wakeUp = null;
      if (cancelRequested) return false;
      pauseRequested = false;
      await resumeRuntimeIfPaused();
      if (cancelRequested) return false;
      setState('running');
      return true;
    };

    try {
      // --- Pin the clock BEFORE the first tick ------------------------------
      if (env.pinFrameRate) {
        const accepted = await env.pinFrameRate(pinHz);
        progress.pinned = accepted;
        if (!accepted) throw new ReplayPinRefusedError(pinHz);
        pinnedByRunner = true;
        // One observed frame on the pinned clock before tick 0, so the pin is
        // in force for every frame the trace touches, however the dispatch
        // landed relative to the engine's frame boundary.
        await awaitFrame();
      } else {
        progress.pinned = false;
      }

      const before = env.observe();
      const startPosition = before?.entities[env.playerEntityId]?.position ?? null;
      const collectiblesPresentAtStart = new Set(
        env.collectibleEntityIds.filter((id) => before?.entities[id] !== undefined),
      );

      if (!cancelRequested) setState(pauseRequested ? 'pausing' : 'running');

      for (let tick = 0; tick <= lastTick; tick += 1) {
        if (cancelRequested) break;

        if (pauseArmed && tick === options.pauseAtTick) {
          pauseArmed = false;
          pauseRequested = true;
        }
        if (pauseRequested && !(await pauseAtBoundary(tick))) break;

        const frame = framesByTick.get(tick);
        const active = frame ? keysForFrame(frame, env) : new Set<string>();

        const toRelease = [...held].filter((code) => !active.has(code));
        const toPress = [...active].filter((code) => !held.has(code));
        if (toRelease.length > 0) await env.releaseKeys(toRelease);
        for (const code of toRelease) held.delete(code);
        for (const code of toPress) held.add(code);
        if (toPress.length > 0) await env.pressKeys(toPress);

        await awaitFrame();
        // A tick counts once its frame has been seen through; a frame the
        // cancel abandoned has not.
        if (cancelRequested) break;
        ticksReplayed += 1;
        progress.tick = ticksReplayed;
        notify();
      }

      // --- The final boundary ----------------------------------------------
      // A pause accepted during the last tick's frame (or armed for
      // `pauseAtTick === totalTicks`) settles here, after every tick and
      // before the settle frames; the earlier runner accepted it and then
      // ran on to completion with the pause never settling.
      if (!cancelRequested) {
        if (pauseArmed && options.pauseAtTick === totalTicks) {
          pauseArmed = false;
          pauseRequested = true;
        }
        if (pauseRequested) await pauseAtBoundary(ticksReplayed);
      }
      pastFinalBoundary = true;

      if (cancelRequested) return finishCancelled(ticksReplayed);

      // Release everything and let the runtime settle so the final observation
      // reflects a resting state, not a mid-input frame.
      await releaseHeld();
      await awaitFrame();
      await awaitFrame();
      // Every tick was injected, but cancel() said it applied: a cancelled run
      // never carries a verdict, even one reached behind its back.
      if (cancelRequested) return finishCancelled(ticksReplayed);

      const after = env.observe();
      const endPosition = after?.entities[env.playerEntityId]?.position ?? null;

      const movedDistance =
        startPosition && endPosition ? distance(startPosition, endPosition) : null;
      const moved = movedDistance !== null && movedDistance > MOVE_EPSILON;

      const collected = [...collectiblesPresentAtStart].filter(
        (id) => after?.entities[id] === undefined,
      );
      const collectiblesCollected = collected.length;

      const pinned = progress.pinned === true;
      const assertions: ReplayAssertion[] = [
        {
          operationId: 'qa.FR-1.OP-01',
          description: 'player entity moved through the real runtime input path',
          passed: moved,
          evidence: {
            playerEntityId: env.playerEntityId,
            startPosition,
            endPosition,
            movedDistance,
            moveEpsilon: MOVE_EPSILON,
            ticksReplayed,
            pinned,
            pinHz: pinned ? pinHz : null,
          },
        },
        {
          operationId: 'qa.FR-1.OP-03',
          description: 'exactly one collectible collected during replay',
          passed: collectiblesCollected === 1,
          evidence: {
            collectiblesPresentAtStart: [...collectiblesPresentAtStart],
            collectedEntityIds: collected,
            collectiblesCollected,
          },
        },
      ];

      // The verdict is already decided; a failed unpin is reported, not a
      // failed run (the engine releases any leftover pin on Stop regardless).
      const unpinError = await unpin();
      const outcome: ReplayOutcome = {
        command: REPLAY_INPUT_TRACE_COMMAND,
        verdict: assertions.every((a) => a.passed) ? 'passed' : 'failed',
        ticksReplayed,
        assertions,
        playerEntityId: env.playerEntityId,
        startPosition,
        endPosition,
        movedDistance,
        collectiblesCollected,
        pinned,
        pinHz: pinned ? pinHz : null,
      };
      setState('completed');
      return unpinError
        ? { status: 'completed', outcome, unpinError: unpinError.message }
        : { status: 'completed', outcome };
    } catch (caught) {
      const error = toError(caught);
      // A boundary that fails while a cancel is being honoured does not turn
      // the creator's cancel into a failure they did not cause.
      if (cancelRequested) {
        console.error('[replayRunner] boundary failed while cancelling; reporting the cancellation', error);
        return finishCancelled(ticksReplayed);
      }
      // A failed frame/input operation must not leave synthetic keys held, a
      // runtime paused, or a clock pinned. Each step is best-effort: the
      // original error is what the caller needs to see.
      try {
        await releaseHeld();
      } catch (releaseError) {
        console.error('[replayRunner] could not release held keys after a failure', releaseError);
      }
      try {
        await resumeRuntimeIfPaused();
      } catch (resumeError) {
        console.error('[replayRunner] could not resume the runtime after a failure', resumeError);
      }
      await unpin();
      setState('failed');
      return { status: 'failed', error, ticksReplayed };
    }
  };

  (handle as { result: Promise<ReplayRunResult> }).result = run();
  options.onHandle?.(handle);
  return handle;
}

/**
 * Replay a bounded input trace through the real runtime and return an
 * observed-state verdict. The uncontrolled form of `startReplay`: it resolves
 * with the outcome, and throws for an invalid trace, a refused pin, a boundary
 * failure, or a cancellation issued through `options.onHandle`. A completed
 * run whose unpin failed still resolves with its outcome; the failure is
 * logged, since this form has nowhere else to put it (use `startReplay` to
 * read `unpinError`).
 * @param trace Recording to validate before injecting any input.
 * @param env Input injection, tick advancement, observation and clock boundary.
 * @param options Pause boundary, pin rate, handle callback.
 * @returns Movement and collection assertions evaluated from observed snapshots.
 * @throws InputTraceValidationError for invalid traces; ReplayPinRefusedError
 *   when the engine refuses the pin; ReplayCancelledError on cancellation;
 *   boundary failures propagate.
 */
export async function replayInputTrace(
  trace: InputTrace,
  env: ReplayEnvironment,
  options: ReplayRunOptions = {},
): Promise<ReplayOutcome> {
  return outcomeOf(await startReplay(trace, env, options).result);
}

/**
 * Map a settled controlled run to the uncontrolled contract: the outcome, or
 * the matching throw. Shared by `replayInputTrace` and the entry points'
 * `runReplay`, so there is one place that decides what each status means.
 * @param result A settled `ReplayRunResult`.
 * @returns The outcome of a completed run.
 * @throws ReplayCancelledError for a cancelled run; the run's error for a failed one.
 */
export function outcomeOf(result: ReplayRunResult): ReplayOutcome {
  if (result.status === 'completed') return result.outcome;
  if (result.status === 'cancelled') throw new ReplayCancelledError(result.ticksReplayed);
  throw result.error;
}
