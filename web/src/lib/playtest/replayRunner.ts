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
 * (`ReplayRunResult.unpinError`); a pin in force during Play is also released
 * by the engine when Play stops.
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
 * notification itself, during the completion-path unpin, or during the
 * failure path's cleanup — and `result` still settles exactly once, as
 * `cancelled`; no state follows 'cancelling' but 'cancelled'
 * (`__tests__/replayController.test.ts`, "a cancel that races the pause" and
 * "the last windows a control can land in").
 *
 * THE RUNNER WATCHES THE EDITOR'S ENGINE MODE (`ReplayEnvironment.subscribeEngineMode`,
 * `__tests__/replayEngineModeWatch.test.ts`). The runner owns the runtime for
 * the whole replay — it pins the clock, injects keys per engine tick, and
 * pauses and resumes the engine for its own Pause — so a mode change it did
 * not make is one it cannot follow. Stop ('edit') cancels the run with reason
 * 'engine-stopped'. A toolbar Pause ('paused' while the runner had not paused
 * the runtime) cancels it with 'engine-paused' and LEAVES the game paused; the
 * alternative was the boundary's stalled-tick timeout turning a deliberate
 * pause into "no engine play tick received" two seconds later. A toolbar
 * Resume ('play' while the runtime was paused BY the runner) cancels it with
 * 'engine-resumed', without dispatching a resume at a game that is already
 * running; the alternative was the trace continuing, on the replay's own
 * Resume, into a world that had moved on without it — a deterministic verdict
 * that was silently wrong. The runner's OWN pause and resume never cancel.
 * Its own pause is told from the toolbar's by COUNTING, not by the current
 * state: the runner counts a pending own pause before it dispatches `pause`,
 * and a 'paused' that arrives consumes one before it can mean anything
 * else. A flag ("the runtime is paused by the runner right now") was not
 * enough, because the real engine QUEUES mode commands and applies every
 * queued one in the next frame's drain, emitting one mode per applied
 * transition (`bridge/core_systems.rs`, `apply_mode_change_requests`): a
 * replay Resume issued within one frame of its Pause had already cleared
 * that flag when the engine finally reported the 'paused' the pause
 * produced, and the runner cancelled its own run as a toolbar Pause. The
 * count holds whether the mode arrives inside the dispatch (unit fakes, the
 * panel test's store), a microtask later, or in one coalesced drain a frame
 * on (the real engine; the queue-and-drain fake in
 * `replayEngineModeWatch.test.ts`). Its own resume needs no count: the flag
 * is cleared before `resume` is dispatched, and the runner cannot pause
 * again before the frame that reports that resume's 'play' has run. The
 * creator's own Cancel carries no reason. The watch is removed on every
 * exit path.
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
import { replayCancelReasonClause } from './replayCancelReason';

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

/** The engine's OWN evaluated named actions on a frame (`capture_input`). */
export interface ReplayObservedInput {
  pressed: Record<string, boolean>;
  axes: Record<string, number>;
}

/** The observed runtime state the runner reads before, during and after a replay. */
export interface ReplayObservation {
  entities: Record<string, { position: [number, number, number] }>;
  /**
   * What the engine reported its named actions as on this frame, when the
   * boundary can see it (the browser boundary reads it off the play-tick
   * bus). Absent or null on a boundary without it (unit fakes), in which case
   * the outcome records `engineInput.available: false`.
   */
  input?: ReplayObservedInput | null;
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
  /**
   * Deliver the editor's engine mode ('edit' | 'play' | 'paused') on every
   * change; returns the unsubscribe. The runner subscribes before the pin,
   * unsubscribes on every exit path, and cancels itself on a change it did
   * not make (module header). Absent on a boundary with no editor (unit
   * fakes), in which case nothing outside the handle can end the run.
   */
  subscribeEngineMode?: (listener: (mode: string) => void) => () => void;
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
  /**
   * The injection-path evidence: what the ENGINE reported its named actions
   * as, frame by frame, while the trace was injected. A verdict of "did not
   * move" is only diagnosable with this beside it — it separates "the keys
   * never reached the engine" from "the engine saw them and still did not
   * move the entity".
   */
  engineInput: ReplayEngineInputEvidence;
  /**
   * The observed player position after tick 0, after every 30th tick, and
   * after the last tick (0-based tick indexes), so a failure message shows
   * WHEN the entity stopped moving, not only that it did.
   */
  positionSamples: ReplayPositionSample[];
}

export interface ReplayEngineInputEvidence {
  /** Whether the boundary exposed the engine's input at all. */
  available: boolean;
  /** Ticks whose trace frame held at least one action. */
  heldTicks: number;
  /**
   * Of those, ticks on whose frame the engine reported at least one of the
   * held actions as pressed or with a non-zero axis.
   */
  observedTicks: number;
  /** The first (0-based) tick the engine reported a held action on, or null. */
  firstObservedTick: number | null;
}

export interface ReplayPositionSample {
  /** 0-based index of the tick whose frame had just been seen through. */
  tick: number;
  position: [number, number, number] | null;
}

/** Every `positionSamples` entry is taken after one of these ticks (plus the last). */
export const POSITION_SAMPLE_EVERY_TICKS = 30;

/**
 * Whether the engine reported any of `heldActions` as active on this frame.
 * @param input The engine's evaluated actions, or null when the boundary has none.
 * @param heldActions Action names the trace frame holds.
 * @returns True when at least one held action is pressed or has a non-zero axis.
 */
export function engineObservedHeldInput(
  input: ReplayObservedInput | null | undefined,
  heldActions: readonly string[],
): boolean {
  if (!input) return false;
  return heldActions.some((name) => input.pressed[name] === true || (input.axes[name] ?? 0) !== 0);
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
  /**
   * Whether the verdict includes qa.FR-1.OP-03 ("exactly one collectible
   * collected during replay"). Defaults to TRUE: the manual Replay button, the
   * chat tool's recorded-trace branch and the curated E2E gate keep that
   * assertion. The bot's Run Playtest passes `false`, because its heuristic
   * plan never aims for a collectible — in a scene without one, or one the
   * plan does not happen to reach, OP-03 would fail every bot run on a rule
   * the bot was never asked to satisfy; the curated fixture the gate replays
   * DOES aim for one. When false, OP-03 is omitted and the verdict is decided
   * by the remaining assertions; `collectiblesCollected` is still reported.
   */
  assertCollectible?: boolean;
  /** Receives the handle as soon as it exists (for callers using `replayInputTrace`). */
  onHandle?: (handle: ReplayHandle) => void;
}

/**
 * Why the RUNNER cancelled a run on the editor's behalf (the engine-mode
 * watch): Stop, a toolbar Pause the runner did not make, or a toolbar Resume
 * of a runtime the runner had paused. A creator's own Cancel carries none.
 * `replayCancelReason.ts` turns one into the creator's words.
 */
export type ReplayCancelReason = 'engine-stopped' | 'engine-paused' | 'engine-resumed';

/**
 * How a controlled run ended. A cancelled run carries no outcome, by design;
 * it carries a `reason` only when the runner cancelled it on the editor's
 * behalf. A completed run whose unpin FAILED still carries its outcome — the
 * run was pinned — with the unpin failure reported beside it, never as a
 * failed run.
 */
export type ReplayRunResult =
  | { status: 'completed'; outcome: ReplayOutcome; unpinError?: string }
  | { status: 'cancelled'; ticksReplayed: number; reason?: ReplayCancelReason }
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

/**
 * Thrown by `replayInputTrace` (and the entry points' `runReplay`) when the
 * run was cancelled — through its handle, or by the runner on the editor's
 * behalf, in which case `reason` says why and the message says it in the
 * creator's words. This message is what the chat tool reports.
 */
export class ReplayCancelledError extends Error {
  readonly ticksReplayed: number;
  /** Why the runner cancelled on the editor's behalf; undefined for a creator's own Cancel. */
  readonly reason: ReplayCancelReason | undefined;
  /**
   * @param ticksReplayed Ticks injected before the cancellation took effect.
   * @param reason The runner's reason, when it cancelled on the editor's behalf.
   */
  constructor(ticksReplayed: number, reason?: ReplayCancelReason) {
    super(
      `Replay cancelled after ${ticksReplayed} ticks${replayCancelReasonClause(reason)}; no outcome was produced.`,
    );
    this.name = 'ReplayCancelledError';
    this.ticksReplayed = ticksReplayed;
    this.reason = reason;
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

/** Action names a frame holds (pressed, or with a non-zero axis). */
function heldActionsOf(frame: InputTraceFrame | undefined): string[] {
  if (!frame) return [];
  return Object.entries(frame.actions)
    .filter(([, state]) => state.pressed || (state.axis ?? 0) !== 0)
    .map(([name]) => name);
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
  /** Set with `cancelRequested` when the RUNNER cancelled on the editor's behalf; a creator's own Cancel leaves it undefined. */
  let cancelReason: ReplayCancelReason | undefined;
  let pauseArmed = options.pauseAtTick !== undefined;
  /** Set once the final tick boundary is behind us: no pause can settle any more. */
  let pastFinalBoundary = false;
  /** Set while paused: resume or cancel resolves it. */
  let wakeUp: (() => void) | null = null;
  /** Set while a frame is awaited: cancel resolves it so the wait ends at once. */
  let abandonFrame: (() => void) | null = null;

  /**
   * Deliver the current progress to every listener, in order. A listener may
   * call a control from inside its notification — cancelling on seeing
   * 'paused' is the common case — which announces a NEW state while this one
   * is still being delivered. That announcement is queued until the current
   * delivery completes, so every listener sees one sequence: never
   * 'cancelling' and then a stale 'paused' left over from the outer delivery.
   * `getProgress()` is always current, inside a notification included.
   */
  let delivering = false;
  const queued: ReplayProgress[] = [];
  const notify = () => {
    progress.heldKeys = [...held];
    queued.push({ ...progress, heldKeys: [...progress.heldKeys] });
    if (delivering) return;
    delivering = true;
    try {
      while (queued.length > 0) {
        const snapshot = queued.shift() as ReplayProgress;
        for (const listener of listeners) {
          try {
            listener(snapshot);
          } catch (error) {
            // A UI listener must never take the replay down with it.
            console.error('[replayRunner] progress listener threw; continuing', error);
          }
        }
      }
    } finally {
      delivering = false;
    }
  };
  /**
   * A cancel can land in the middle of any await, and the code after that
   * await was written for the state it interrupted. Every announcement that
   * follows an await therefore re-checks `cancelRequested` first — in
   * `pauseAtBoundary`, after the completion-path unpin, and after the
   * failure-path cleanup — so no state follows 'cancelling' but 'cancelled'.
   * The controller tests pin each of those windows. There is deliberately no
   * catch-all guard here: an earlier "sticky 'cancelling'" guard swallowed a
   * 'completed' announced after a late cancel and left the run with no
   * terminal state at all, which is worse than a wrong one.
   */
  const setState = (state: ReplayRunState) => {
    progress.state = state;
    notify();
  };

  /**
   * Release every synthetic key. `held` is updated AFTER the boundary
   * confirms the release, exactly as the tick loop's diff does: a release the
   * boundary refuses (the DOM boundary throws when the engine canvas is gone)
   * leaves the codes in `held`, so the cleanup that follows a failure or a
   * cancel tries them again instead of finding an empty set and leaving the
   * keys pressed in the engine. Deleted by snapshot, not cleared, so a key
   * pressed meanwhile is never forgotten either.
   */
  const releaseHeld = async () => {
    if (held.size === 0) return;
    const codes = [...held];
    await env.releaseKeys(codes);
    for (const code of codes) held.delete(code);
  };

  /**
   * The ONE cancel path. The public `handle.cancel()` — the creator's Cancel,
   * a panel unmount, `cancelActiveReplay`, the chat tool — gives no reason;
   * the engine-mode watch gives the one it cancelled for. The state machine
   * is the same for both: 'cancelling' now, 'cancelled' once the keys are
   * released and the clock unpinned, and the reason rides on the result.
   */
  const requestCancel = (reason?: ReplayCancelReason): boolean => {
    if (TERMINAL_STATES.has(progress.state) || cancelRequested) return false;
    cancelRequested = true;
    cancelReason = reason;
    pauseRequested = false;
    setState('cancelling');
    wakeUp?.();
    abandonFrame?.();
    return true;
  };

  /** The cancelled result, carrying the reason only when the runner had one. */
  const cancelledResult = (ticks: number): ReplayRunResult =>
    cancelReason === undefined
      ? { status: 'cancelled', ticksReplayed: ticks }
      : { status: 'cancelled', ticksReplayed: ticks, reason: cancelReason };

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
    cancel: () => requestCancel(),
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
    /**
     * True from just BEFORE the runner dispatches the engine's pause to just
     * BEFORE it dispatches the resume: whether the cancel and failure paths
     * owe the runtime a resume. NOT what tells the runner's own mode changes
     * from the toolbar's — see the two counts below.
     */
    let runtimePausedByRunner = false;
    /**
     * Own pauses the runner has dispatched and the engine has not yet
     * reported; incremented just BEFORE each `pauseRuntime`, consumed by the
     * next 'paused' the watch receives. A count, not the flag above: the
     * real engine queues the commands and reports every applied transition
     * in the next frame's drain, so a resume issued within one frame of the
     * pause has cleared the flag before the pause's own 'paused' arrives
     * (module header). A count the engine never answers — a pause it
     * dropped because a Stop drained earlier in the same frame, or a
     * dispatch that threw — is left at 1, harmlessly: in each of those
     * cases the run is already over. The resume needs no count: the flag is
     * cleared before `resume` is dispatched, and the runner cannot pause
     * again until a tick has passed, which takes a frame, whose drain
     * reports that resume's 'play' first — so an own 'play' always finds
     * the flag clear, however the engine delivers it.
     */
    let ownPausesPending = 0;
    let pinnedByRunner = false;
    const engineInput: ReplayEngineInputEvidence = {
      available: false,
      heldTicks: 0,
      observedTicks: 0,
      firstObservedTick: null,
    };
    const positionSamples: ReplayPositionSample[] = [];

    /**
     * Record what the engine reported on the frame tick `tick` was just seen
     * through: whether it evaluated any action the frame held, and a position
     * sample on the sampled ticks. Read-only; a boundary without `input` just
     * leaves `available` false.
     */
    const recordTickEvidence = (tick: number, frame: InputTraceFrame | undefined) => {
      const seen = env.observe();
      if (seen?.input !== undefined && seen.input !== null) engineInput.available = true;
      const heldActions = heldActionsOf(frame);
      if (heldActions.length > 0) {
        engineInput.heldTicks += 1;
        if (engineObservedHeldInput(seen?.input, heldActions)) {
          engineInput.observedTicks += 1;
          engineInput.firstObservedTick ??= tick;
        }
      }
      if (tick % POSITION_SAMPLE_EVERY_TICKS === 0 || tick === lastTick) {
        positionSamples.push({
          tick,
          position: seen?.entities[env.playerEntityId]?.position ?? null,
        });
      }
    };

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
      // Cleared BEFORE the dispatch, so the 'play' it produces — inside this
      // call or a frame later — never reads as a toolbar Resume.
      runtimePausedByRunner = false;
      await env.resumeRuntime?.();
    };

    /**
     * The engine-mode watch (module header). A 'paused' first settles
     * against the runner's own pending pauses — one each — and only an
     * UNACCOUNTED one is the toolbar's; a 'play' is the toolbar's only while
     * the runtime is paused by the runner, which its own resume has already
     * cleared. Cancels through `requestCancel`, so a run already cancelling,
     * or over, ignores whatever the editor reports next; a 'play' while the
     * runner is running (the engine running on as it was) is ignored too.
     */
    const onEngineMode = (mode: string): void => {
      if (TERMINAL_STATES.has(progress.state) || cancelRequested) return;
      if (mode === 'edit') {
        requestCancel('engine-stopped');
      } else if (mode === 'paused') {
        if (ownPausesPending > 0) {
          // The engine reporting the runner's own pause back — inside the
          // dispatch, or in a later frame's drain, by which time the runner
          // may already have resumed (the count outlives the flag).
          ownPausesPending -= 1;
          return;
        }
        // The creator paused the game from the toolbar: its ticks have
        // stopped, and the runner must not wait two seconds to call that a
        // stalled engine. The runtime is LEFT paused — `resumeRuntimeIfPaused`
        // resumes only a runtime this runner paused, and it did not.
        requestCancel('engine-paused');
      } else if (mode === 'play') {
        // The runner's own resume reported back, or the engine running on
        // as it was: nothing to do.
        if (!runtimePausedByRunner) return;
        // The creator resumed, from the toolbar, a game the runner had
        // paused: it is running with no replay input, so the trace cannot be
        // continued. It is already running — clear the flag FIRST so the
        // cancel path does not dispatch a resume at it.
        runtimePausedByRunner = false;
        requestCancel('engine-resumed');
      }
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
        // The codes are still in `held`: the release did not reach the engine.
        console.error(
          `[replayRunner] could not release held keys while cancelling; still held: ${[...held].join(', ')}`,
          releaseError,
        );
      }
      try {
        await resumeRuntimeIfPaused();
      } catch (resumeError) {
        console.error('[replayRunner] could not resume the runtime while cancelling', resumeError);
      }
      await unpin();
      setState('cancelled');
      return cancelledResult(ticks);
    };

    /**
     * Settle a requested pause at the tick boundary `tick` and wait to be
     * woken. Returns false when a cancel landed anywhere in the process, so
     * the caller stops. A cancel can arrive during every await here AND from
     * inside the 'paused' notification itself (a UI that cancels on seeing
     * 'paused' — the case the review-board reproduced), so `cancelRequested`
     * is re-checked after each await, and the wake-up promise exists BEFORE
     * 'paused' is announced so that a cancel always has something to resolve.
     *
     * A resume() during 'pausing' WITHDRAWS the pause; `pauseRequested` is
     * likewise re-checked after each await, and a withdrawn pause never
     * announces 'paused' (nothing would wake it): the keys released for it are
     * pressed again by the next tick's diff, a runtime already paused for it
     * is resumed. `final` marks the boundary after the last tick: once the run
     * continues past it there is no boundary left, so `pastFinalBoundary` is
     * set BEFORE 'running' is announced — a pause() issued from inside that
     * notification is refused rather than accepted and never settled.
     */
    const pauseAtBoundary = async (tick: number, final: boolean): Promise<boolean> => {
      const proceed = () => {
        if (final) pastFinalBoundary = true;
        return true;
      };
      // No synthetic key stays down while the creator reads the frozen scene.
      await releaseHeld();
      if (cancelRequested) return false;
      if (!pauseRequested) return proceed();
      if (env.pauseRuntime) {
        // Both set BEFORE the dispatch: the engine's 'paused' may reach the
        // mode watch from inside this very call (a store that mirrors the
        // mode synchronously) or in the next frame's drain, after a resume
        // has already cleared the flag — the count is what makes it read as
        // the runner's own in both cases. If the dispatch throws, the flag
        // stays true and the failure path's resume is a best-effort guess at
        // a runtime that may never have paused — acceptable: the engine
        // refuses a stray resume harmlessly, and the refusal is logged, not
        // reported; the count it leaves behind dies with the run.
        runtimePausedByRunner = true;
        ownPausesPending += 1;
        await env.pauseRuntime();
        if (cancelRequested) return false;
        if (!pauseRequested) {
          // Past the final boundary from here on: a pause() landing in the
          // resume await below would have nothing left to settle at, so it
          // must already be refused.
          if (final) pastFinalBoundary = true;
          await resumeRuntimeIfPaused();
          if (cancelRequested) return false;
          return proceed();
        }
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
      proceed();
      setState('running');
      return true;
    };

    let stopWatchingEngineMode: (() => void) | null = null;
    try {
      // --- Watch the editor's engine mode for the whole run -----------------
      // Before the pin, so a Stop or a toolbar Pause during the warm-up frame
      // is seen too; removed in the `finally` below on EVERY exit path —
      // completed, cancelled, failed, a refused pin included.
      stopWatchingEngineMode = env.subscribeEngineMode?.(onEngineMode) ?? null;

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
        if (pauseRequested && !(await pauseAtBoundary(tick, false))) break;

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
        recordTickEvidence(tick, frame);
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
        if (pauseRequested) await pauseAtBoundary(ticksReplayed, true);
      }
      pastFinalBoundary = true;

      if (cancelRequested) return await finishCancelled(ticksReplayed);

      // Release everything and let the runtime settle so the final observation
      // reflects a resting state, not a mid-input frame.
      await releaseHeld();
      await awaitFrame();
      await awaitFrame();
      // Every tick was injected, but cancel() said it applied: a cancelled run
      // never carries a verdict, even one reached behind its back.
      if (cancelRequested) return await finishCancelled(ticksReplayed);

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
            engineInput: { ...engineInput },
            positionSamples: [...positionSamples],
          },
        },
      ];
      // OP-03 is the run policy's call (`assertCollectible`, default on): the
      // bot's plan never aims for a collectible, so its run omits the
      // assertion rather than failing on it; `collectiblesCollected` is
      // reported on the outcome either way.
      if (options.assertCollectible ?? true) {
        assertions.push({
          operationId: 'qa.FR-1.OP-03',
          description: 'exactly one collectible collected during replay',
          passed: collectiblesCollected === 1,
          evidence: {
            collectiblesPresentAtStart: [...collectiblesPresentAtStart],
            collectedEntityIds: collected,
            collectiblesCollected,
          },
        });
      }

      // The verdict is already decided; a failed unpin is reported, not a
      // failed run (a pin in force during Play is released by Stop anyway).
      const unpinError = await unpin();
      // The cancel's last window: it may have landed during that unpin. It
      // said it applied, so the run is a cancellation — no verdict — and the
      // clock is already released (the second unpin below is a no-op).
      if (cancelRequested) return await finishCancelled(ticksReplayed);
      const outcome: ReplayOutcome = {
        command: REPLAY_INPUT_TRACE_COMMAND,
        // A verdict over no assertions is not a pass: `every` is vacuously
        // true on an empty array, and the assertions are policy-gated now.
        verdict: assertions.length > 0 && assertions.every((a) => a.passed) ? 'passed' : 'failed',
        ticksReplayed,
        assertions,
        playerEntityId: env.playerEntityId,
        startPosition,
        endPosition,
        movedDistance,
        collectiblesCollected,
        pinned,
        pinHz: pinned ? pinHz : null,
        engineInput,
        positionSamples,
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
        return await finishCancelled(ticksReplayed);
      }
      // A failed frame/input operation must not leave synthetic keys held, a
      // runtime paused, or a clock pinned. Each step is best-effort: the
      // original error is what the caller needs to see.
      try {
        await releaseHeld();
      } catch (releaseError) {
        console.error(
          `[replayRunner] could not release held keys after a failure; still held: ${[...held].join(', ')}`,
          releaseError,
        );
      }
      try {
        await resumeRuntimeIfPaused();
      } catch (resumeError) {
        console.error('[replayRunner] could not resume the runtime after a failure', resumeError);
      }
      await unpin();
      // The cancel landed while the failure was being cleaned up: the creator
      // asked for a cancellation, and the run is already released.
      if (cancelRequested) {
        console.error('[replayRunner] run failed, then cancelled during cleanup; reporting the cancellation', error);
        setState('cancelled');
        return cancelledResult(ticksReplayed);
      }
      setState('failed');
      return { status: 'failed', error, ticksReplayed };
    } finally {
      // After the terminal state, whichever exit path announced it (the
      // cancel paths are awaited above so this follows 'cancelled' too).
      stopWatchingEngineMode?.();
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
  if (result.status === 'cancelled') throw new ReplayCancelledError(result.ticksReplayed, result.reason);
  throw result.error;
}
