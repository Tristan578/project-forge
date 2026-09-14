/**
 * Shared replay invocation surface (#9902).
 *
 * The manual Replay button and the in-app AI replay call MUST route to the same
 * typed command with the same validation. This is the one funnel: both pass
 * through `invokeReplay`, which runs the identical `replayInputTrace` runner and
 * stamps the identical `command`. The only difference recorded is `source`, for
 * evidence/telemetry — never behaviour. A trace that is invalid from the UI is
 * invalid from AI, with the same `InputTraceValidationError`.
 *
 * `createDomKeyboardEnvironment` builds the REAL runtime boundary used in the
 * browser: named actions resolve to key codes through the scene's input
 * bindings, presses dispatch DOM `KeyboardEvent`s on the same channel a human's
 * keystrokes travel (which the engine's `capture_input` reads via winit /
 * Bevy `ButtonInput`), frames advance on `requestAnimationFrame`, and state is
 * observed from the play-tick bus.
 */

import type { InputBinding } from '@/stores/slices/types';
import { getLatestPlayTick } from './playTickBus';
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
 * Run a replay from either the manual UI or the AI path. Both callers reach the
 * engine through exactly this function, so they cannot diverge in command name
 * or validation. Throws `InputTraceValidationError` on an invalid trace, before
 * the runner touches the engine.
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

/** Build an action → key-code resolver from the scene's input bindings. */
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

/** How long to wait for one engine frame when advancing via rAF. */
const FRAME_FALLBACK_MS = 32;

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      // Resolve on the SECOND frame: the first schedules the keyboard state the
      // engine reads, the second lets `capture_input` and the character system
      // run against it before the caller observes.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, FRAME_FALLBACK_MS);
    }
  });
}

/** Dispatch a keyboard event carrying a `code` on the real input channel. */
function dispatchKey(type: 'keydown' | 'keyup', code: string): void {
  if (typeof window === 'undefined' || typeof KeyboardEvent === 'undefined') return;
  const event = new KeyboardEvent(type, {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
  });
  // The engine's winit listeners are on the window; dispatch there so a
  // synthetic key reaches the same handler a real keystroke does.
  window.dispatchEvent(event);
}

/**
 * Build the real DOM-keyboard runtime environment for a browser replay.
 *
 * Observation reads the play-tick bus's latest snapshot: entity positions prove
 * movement, and a `destroy_on_collect` collectible's ABSENCE from the snapshot
 * is its collection (the engine despawns it).
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
    advanceFrame: nextAnimationFrame,
    observe,
    playerEntityId: config.playerEntityId,
    collectibleEntityIds: config.collectibleEntityIds,
  };
}
