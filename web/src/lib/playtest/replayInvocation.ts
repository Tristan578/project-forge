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
import type { InputBinding } from '@/stores/slices/types';
import { getLatestPlayTick, subscribePlayTick } from './playTickBus';
import type { InputTrace } from './inputTrace';
import {
  replayInputTrace,
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
  const outcome = await replayInputTrace(trace, env, options);
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

/**
 * Build an action-to-key resolver from the scene's bindings.
 * @param bindings Current digital and signed-axis bindings.
 * @returns A resolver yielding key codes for an action and direction, or none.
 */
export function buildActionKeyResolver(
  bindings: InputBinding[],
): ReplayEnvironment['resolveKeys'] {
  const byName = new Map(bindings.map((b) => [b.actionName, b]));
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

/** Dispatch a keyboard event carrying a `code` on the real input channel. */
function dispatchKey(type: 'keydown' | 'keyup', code: string): void {
  const canvas = typeof document === 'undefined' ? null : document.getElementById('forge-canvas');
  if (!canvas || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Replay requires the active engine canvas.');
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
    return { entities };
  };
  const requireDispatch = (): EngineDispatch => {
    if (!config.dispatch) throw new Error('Replay requires the engine command dispatcher.');
    return config.dispatch;
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
      requireDispatch()('unpin_frame_rate', {});
    },
    pauseRuntime: () => {
      requireDispatch()('pause', {});
    },
    resumeRuntime: () => {
      requireDispatch()('resume', {});
    },
  };
}
