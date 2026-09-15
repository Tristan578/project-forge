/**
 * Shared replay invocation surface (#9902).
 *
 * The manual Replay button uses this invocation function. It also accepts an
 * AI source label for future registration, but no chat command currently calls
 * it; that integration is tracked in #10007. Unit tests cover the shared runner
 * contract and do not establish an available AI product entry point.
 *
 * `createDomKeyboardEnvironment` builds the REAL runtime boundary used in the
 * browser: named actions resolve to key codes through the scene's input
 * bindings, presses dispatch DOM `KeyboardEvent`s on the same channel a human's
 * keystrokes travel (which the engine's `capture_input` reads via winit /
 * Bevy `ButtonInput`), frames advance when the play-tick bus reports them, and state is
 * observed from the play-tick bus.
 */

import type { InputBinding } from '@/stores/slices/types';
import { getLatestPlayTick, subscribePlayTick } from './playTickBus';
import type { InputTrace } from './inputTrace';
import {
  replayInputTrace,
  REPLAY_INPUT_TRACE_COMMAND,
  type ReplayEnvironment,
  type ReplayObservation,
  type ReplayOutcome,
} from './replayRunner';

/** Who initiated a replay. Affects evidence only, never validation or runner. */
export type ReplaySource = 'manual' | 'ai';

/** The uniform result of a replay invocation from either entry point. */
export interface ReplayInvocationResult {
  command: typeof REPLAY_INPUT_TRACE_COMMAND;
  source: ReplaySource;
  outcome: ReplayOutcome;
}

/**
 * Run a replay with a caller-provided source label. Throws
 * `InputTraceValidationError` on an invalid trace before touching the engine.
 * @param source Caller-provided origin label; does not imply AI registration.
 * @param trace Bounded recording to validate and replay.
 * @param env Input injection and observation boundary.
 * @returns The replay outcome with its source label and command identifier.
 */
export async function invokeReplay(
  source: ReplaySource,
  trace: InputTrace,
  env: ReplayEnvironment,
): Promise<ReplayInvocationResult> {
  const outcome = await replayInputTrace(trace, env);
  return { command: REPLAY_INPUT_TRACE_COMMAND, source, outcome };
}

// ---------------------------------------------------------------------------
// Real browser runtime boundary
// ---------------------------------------------------------------------------

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

/**
 * Build the real DOM-keyboard runtime environment for a browser replay.
 *
 * Observations report positions and entity disappearance. The replay fixture
 * must ensure disappearance represents collection, rather than another cause.
 * @param config Current bindings and the player/collectible ids to observe.
 * @returns A canvas-keyboard environment that advances on observed play ticks.
 */
export function createDomKeyboardEnvironment(config: {
  bindings: InputBinding[];
  playerEntityId: string;
  collectibleEntityIds: string[];
}): ReplayEnvironment {
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
  };
}
