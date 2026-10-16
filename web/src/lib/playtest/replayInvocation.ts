/**
 * Shared replay invocation surface (#9902; AI parity and the pinned runtime: #10007).
 *
 * Every entry point — the manual Replay button, the E2E hooks and the in-app AI
 * tool (`lib/chat/handlers/playtestHandlers.ts`) — reaches the runner through
 * `invokeReplay` / `startReplayInvocation`, carrying only a SOURCE label. The
 * label is evidence; it changes neither validation nor the runner, which is
 * what `__tests__/replayParity.test.ts` proves command by command.
 *
 * `createDomKeyboardEnvironment` builds the REAL runtime boundary used in the
 * browser: named actions resolve to key codes through the scene's input
 * bindings, presses dispatch DOM `KeyboardEvent`s on the same channel a human's
 * keystrokes travel (which the engine's `capture_input` reads via winit /
 * Bevy `ButtonInput`), frames advance when the play-tick bus reports them,
 * state is observed from the play-tick bus, and the clock and runtime mode are
 * driven through the engine command dispatcher (`pin_frame_rate`,
 * `unpin_frame_rate`, `pause`, `resume`).
 */

import type { CommandResponse } from '@/hooks/useEngine';
import { EDITOR_CANVAS_ID } from '@/lib/engine/canvasId';
import type { InputBinding } from '@/stores/slices/types';
import { getLatestPlayTick, subscribePlayTick } from './playTickBus';
import type { InputTrace } from './inputTrace';
import {
  outcomeOf,
  startReplay,
  REPLAY_INPUT_TRACE_COMMAND,
  type ReplayEnvironment,
  type ReplayHandle,
  type ReplayObservation,
  type ReplayOutcome,
  type ReplayRunOptions,
} from './replayRunner';

/** Who initiated a replay. Affects evidence only, never validation or runner. */
export type ReplaySource = 'manual' | 'ai';

/** The uniform result of a replay invocation from either entry point. */
export interface ReplayInvocationResult {
  command: typeof REPLAY_INPUT_TRACE_COMMAND;
  source: ReplaySource;
  outcome: ReplayOutcome;
}

/** A controlled replay (pause / resume / cancel) started from either entry point. */
export interface ReplaySession {
  command: typeof REPLAY_INPUT_TRACE_COMMAND;
  source: ReplaySource;
  handle: ReplayHandle;
}

/**
 * Run a replay with a caller-provided source label. Throws
 * `InputTraceValidationError` on an invalid trace before touching the engine.
 * @param source Origin label recorded in the result.
 * @param trace Bounded recording to validate and replay.
 * @param env Input injection and observation boundary.
 * @param options Pause boundary, pin rate, handle callback.
 * @returns The replay outcome with its source label and command identifier.
 */
export async function invokeReplay(
  source: ReplaySource,
  trace: InputTrace,
  env: ReplayEnvironment,
  options: ReplayRunOptions = {},
): Promise<ReplayInvocationResult> {
  const session = startReplayInvocation(source, trace, env, options);
  const outcome = outcomeOf(await session.handle.result);
  return { command: REPLAY_INPUT_TRACE_COMMAND, source, outcome };
}

/**
 * Start a CONTROLLED replay with a caller-provided source label. Same
 * validation gate as `invokeReplay`; returns the handle instead of awaiting.
 * @param source Origin label recorded in the session.
 * @param trace Bounded recording to validate and replay.
 * @param env Input injection and observation boundary.
 * @param options Pause boundary, pin rate, handle callback.
 * @returns The session, whose handle controls and reports the run.
 */
export function startReplayInvocation(
  source: ReplaySource,
  trace: InputTrace,
  env: ReplayEnvironment,
  options: ReplayRunOptions = {},
): ReplaySession {
  const handle = startReplay(trace, env, options);
  return { command: REPLAY_INPUT_TRACE_COMMAND, source, handle };
}

// ---------------------------------------------------------------------------
// Real browser runtime boundary
// ---------------------------------------------------------------------------

/** The engine command dispatcher, as `getCommandDispatcher()` returns it. */
export type EngineDispatch = (command: string, payload: unknown) => CommandResponse | void;

/** The local-player slot a binding with no `player` belongs to. */
const PRIMARY_PLAYER_SLOT = 0;

/**
 * The primary player's binding for each action name — the ONE map a replay's
 * key resolver and the bot's axis-name derivation both read.
 *
 * A replay drives the primary player's entity, and the engine's character
 * controller reads the primary slot alone (`InputState::get_axis` is
 * `get_axis_for(0, ..)` in `core/input.rs`), so only a slot-0 row (`player`
 * absent or 0) may answer a replayed action. Slot 1+ rows share action names
 * with slot 0 in the ONE flat `inputBindings` list (`scriptSlice.setInputBinding`
 * keys a row by name AND slot; the engine's own payload appends slot 1+ after
 * slot 0), and each slot picks its own `actionType`. Keying the whole list by
 * name let the last row win whatever its slot: with slot 0 binding `move_right`
 * as a signed axis and slot 1 as a digital key, a leftward bot move resolved to
 * player 1's digital row and pressed a RIGHT key — while the axis-name
 * derivation, matching ANY row, had called `move_right` an axis. Reading both
 * from this map makes "is this name a signed axis" and "which keys answer it"
 * the same question about the same row.
 * @param bindings The scene's flat binding list, every slot included.
 * @returns The primary player's binding per action name.
 */
export function primaryPlayerBindings(bindings: readonly InputBinding[]): ReadonlyMap<string, InputBinding> {
  const byName = new Map<string, InputBinding>();
  for (const binding of bindings) {
    if ((binding.player ?? PRIMARY_PLAYER_SLOT) === PRIMARY_PLAYER_SLOT) byName.set(binding.actionName, binding);
  }
  return byName;
}

/**
 * The primary player's action names bound as signed axes: the only names the
 * bot's trace conversion may answer a negative direction with
 * (`BotTraceOptions.axisActionNames`). Every caller of `botSessionToInputTrace`
 * derives the option here, never from the flat list, so a name counts as an
 * axis exactly when `buildActionKeyResolver` will read the sign for it.
 * @param bindings The scene's flat binding list, every slot included.
 * @returns Action names whose primary-player binding is a signed axis.
 */
export function replayAxisActionNames(bindings: readonly InputBinding[]): string[] {
  return [...primaryPlayerBindings(bindings).values()]
    .filter((b) => b.actionType === 'axis')
    .map((b) => b.actionName);
}

/**
 * The primary player's action names: the bot's vocabulary
 * (`BotTraceOptions.actionNames`). Derived from the same map the key resolver
 * reads, so the bot only plans actions the resolver can answer. From the flat
 * list, a `move_left` bound only on a second player's slot would divert a
 * leftward move onto a name slot 0 never binds, pressing nothing where the
 * primary's signed `move_right` axis was there to answer it.
 * @param bindings The scene's flat binding list, every slot included.
 * @returns Action names the primary player's bindings answer.
 */
export function replayActionNames(bindings: readonly InputBinding[]): string[] {
  return [...primaryPlayerBindings(bindings).keys()];
}

/**
 * Build an action-to-key resolver from the scene's bindings.
 * @param bindings Current digital and signed-axis bindings, every slot included.
 * @returns A resolver yielding the primary player's key codes for an action and direction, or none.
 */
export function buildActionKeyResolver(
  bindings: readonly InputBinding[],
): ReplayEnvironment['resolveKeys'] {
  const byName = primaryPlayerBindings(bindings);
  return (actionName, state) => {
    const binding = byName.get(actionName);
    if (!binding) return [];
    if (binding.actionType === 'axis') {
      const axis = state.axis ?? 0;
      if (axis > 0) return binding.positiveKeys ?? [];
      if (axis < 0) return binding.negativeKeys ?? [];
      return [];
    }
    return binding.sources ?? [];
  };
}

/** Bound a stalled or stopped runtime instead of hanging a replay indefinitely. */
const PLAY_TICK_TIMEOUT_MS = 2_000;

function nextPlayTick(): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribePlayTick(() => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Replay stopped: no engine play tick received.'));
    }, PLAY_TICK_TIMEOUT_MS);
  });
}

/**
 * Dispatch a keyboard event carrying a `code` on the real input channel.
 *
 * The precondition is exactly one thing: the editor's engine canvas — the
 * `<canvas>` with `EDITOR_CANVAS_ID`, which `CanvasArea` renders and winit's
 * keyboard listeners sit on. Neither focus nor layout visibility is required
 * (`dispatchEvent` delivers to the element's own listeners regardless, and
 * under headless SwiftShader the canvas is `invisible` until the first frame
 * and never focused). Pinned by `__tests__/replayInvocation.test.ts`.
 */
function dispatchKey(type: 'keydown' | 'keyup', code: string): void {
  const canvas = typeof document === 'undefined' ? null : document.getElementById(EDITOR_CANVAS_ID);
  if (!canvas || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error(
      `Replay requires the editor's engine canvas (#${EDITOR_CANVAS_ID}): no <canvas> with that id is in the document.`,
    );
  }
  const event = new KeyboardEvent(type, {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
  });
  // winit registers keyboard listeners on its canvas. Events sent to window
  // cannot travel down the DOM tree to those listeners.
  canvas.dispatchEvent(event);
}

export interface DomKeyboardEnvironmentConfig {
  bindings: InputBinding[];
  playerEntityId: string;
  collectibleEntityIds: string[];
  /**
   * The engine command dispatcher (`getCommandDispatcher()`), or null when no
   * engine is attached. The clock pin and the runtime pause/resume travel
   * through it, so the same `tracked` wrapper, analytics and rejection
   * reporting every engine command gets apply to a replay's commands too.
   */
  dispatch: EngineDispatch | null;
}

/**
 * Build the real DOM-keyboard runtime environment for a browser replay.
 *
 * Observations report positions and entity disappearance. The replay fixture
 * must ensure disappearance represents collection, rather than another cause.
 *
 * The clock pin is answered from the engine's own response: only an explicit
 * `success: true` counts. A dispatcher that answers nothing is a stand-in with
 * no engine behind it, and a pin it cannot confirm is not a pin — the runner
 * then refuses to replay rather than reporting a verdict from an unpinned run.
 * @param config Current bindings, the player/collectible ids to observe, and the dispatcher.
 * @returns A canvas-keyboard environment that advances on observed play ticks.
 */
export function createDomKeyboardEnvironment(config: DomKeyboardEnvironmentConfig): ReplayEnvironment {
  const resolveKeys = buildActionKeyResolver(config.bindings);
  const observe = (): ReplayObservation | null => {
    const snapshot = getLatestPlayTick();
    if (!snapshot) return null;
    const entities: ReplayObservation['entities'] = {};
    for (const [id, entity] of Object.entries(snapshot.entities)) {
      if (entity && Array.isArray(entity.position)) {
        entities[id] = { position: entity.position };
      }
    }
    // The engine's own evaluated actions on this frame (`capture_input`), so
    // the outcome can say whether the injected keys reached the engine.
    return {
      entities,
      input: { pressed: snapshot.inputState.pressed, axes: snapshot.inputState.axes },
    };
  };
  const requireDispatch = (): EngineDispatch => {
    if (!config.dispatch) throw new Error('Replay requires the engine command dispatcher.');
    return config.dispatch;
  };
  /**
   * Dispatch a clock or mode command and insist on the engine's explicit
   * acceptance. The pin has always been answered this way (a stand-in that
   * answers nothing is not a pin); the unpin, pause and resume used to be
   * fire-and-forget, so a refused `unpin_frame_rate` left the clock pinned
   * while the run reported it released, and a refused `pause` left the game
   * running behind a "paused" replay. A refusal throws, carrying the engine's
   * own reason, and the runner's exit paths decide what it taints.
   */
  const confirmed = (command: string, payload: unknown): void => {
    const response = requireDispatch()(command, payload);
    if (response?.success === true) return;
    const reason = response?.error ?? 'no engine confirmed the command';
    throw new Error(`Replay: the engine did not confirm ${command}: ${reason}`);
  };
  return {
    resolveKeys,
    pressKeys: (codes) => {
      for (const code of codes) dispatchKey('keydown', code);
    },
    releaseKeys: (codes) => {
      for (const code of codes) dispatchKey('keyup', code);
    },
    advanceFrame: nextPlayTick,
    observe,
    playerEntityId: config.playerEntityId,
    collectibleEntityIds: config.collectibleEntityIds,
    pinFrameRate: (hz) => {
      const response = requireDispatch()('pin_frame_rate', { hz });
      return response?.success === true;
    },
    unpinFrameRate: () => {
      confirmed('unpin_frame_rate', {});
    },
    pauseRuntime: () => {
      confirmed('pause', {});
    },
    resumeRuntime: () => {
      confirmed('resume', {});
    },
  };
}
