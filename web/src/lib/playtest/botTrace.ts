/**
 * AI gameplay bot → bounded input trace (#10007, qa.FR-1 AI parity).
 *
 * `simulatePlaytest` (`lib/ai/gameplayBot.ts`) plans a session as timed
 * `BotAction`s — move with a direction, jump, interact, wait — without ever
 * running the engine. This module turns that plan into the SAME `InputTrace`
 * a human recording produces, so the bot's session can be driven through the
 * real runtime by the one `replay_input_trace` command the manual Replay
 * button uses. That is what makes "the bot operates the actual game"
 * (#9877 F1) true, and what lets `replayParity.test.ts` prove the AI path and
 * the manual path issue identical engine commands for identical input.
 *
 * The conversion is deterministic and bounded by construction:
 *   - the plan's timeline is sampled once per engine tick; by default the
 *     whole plan is spanned across the trace's 120-tick bound, so a 60 s plan
 *     becomes 120 ticks of 500 ms each (one engine frame per half-second of
 *     bot time), never more frames than the schema admits;
 *   - a `move` holds its direction until the next action; `jump` is a one-tick
 *     tap; `wait`, `interact`, `attack` and `use_item` have no engine named
 *     action and leave the frame idle;
 *   - only names in the scene's own action vocabulary survive, so the result
 *     always passes `parseInputTrace`.
 *
 * Direction → named action follows the engine's own vocabulary
 * (`core::game_components::system_character_controller` reads `move_right`,
 * `move_left`, `move_forward`, `move_backward`, `jump`): a positive x is
 * `move_right`; a negative x is `move_left` when the scene binds it, and
 * otherwise a negative `move_right` axis — the signed-axis form the recorder
 * produces — but ONLY when `move_right` is bound as a signed axis
 * (`BotTraceOptions.axisActionNames`). The replay resolver uses the sign for
 * an axis binding alone; a digital binding answers its one key whatever the
 * sign, so a negative `move_right` on a digital-only scene would press RIGHT.
 * A digital-only scene without `move_left` therefore leaves leftward moves
 * unbound (not moving is better than moving the wrong way). Likewise for y
 * against `move_forward` / `move_backward`.
 */

import type { BotAction, PlaytestSession } from '@/lib/ai/gameplayBot';
import {
  INPUT_TRACE_VERSION,
  MAX_TRACE_TICKS,
  parseInputTrace,
  type InputActionState,
  type InputTrace,
  type InputTraceFrame,
} from './inputTrace';

/** Engine frames per second a converted trace is replayed at (the pinned rate). */
export const BOT_TRACE_TICK_HZ = 60;

/** Below this magnitude a direction component is treated as "not moving that way". */
const DIRECTION_DEADZONE = 0.01;

export interface BotTraceOptions {
  /** Identity of the scene fixture the trace targets (`InputTrace.fixtureId`). */
  fixtureId: string;
  /** The scene's action vocabulary; names outside it are dropped. */
  actionNames: string[];
  /**
   * Names bound as signed axes (`InputBinding.actionType === 'axis'`). Only
   * these may carry a negative direction when the scene has no dedicated
   * negative action; a digital binding would press its positive key for it.
   * Defaults to none, so a caller that does not say leaves such moves unbound.
   */
  axisActionNames?: readonly string[];
  /**
   * Bot-timeline milliseconds represented by one engine tick. Defaults to
   * spanning the whole plan across `MAX_TRACE_TICKS`, never finer than one
   * real frame at `BOT_TRACE_TICK_HZ`.
   */
  msPerTick?: number;
}

function pickAxis(
  vocabulary: ReadonlySet<string>,
  axisNames: ReadonlySet<string>,
  value: number,
  positiveName: string,
  negativeName: string,
): [string, InputActionState] | null {
  if (!Number.isFinite(value) || Math.abs(value) < DIRECTION_DEADZONE) return null;
  const magnitude = Math.min(1, Math.abs(value));
  if (value > 0) {
    return vocabulary.has(positiveName) ? [positiveName, { pressed: true, axis: magnitude }] : null;
  }
  if (vocabulary.has(negativeName)) return [negativeName, { pressed: true, axis: magnitude }];
  // No dedicated negative action: express it as the negative half of the
  // positive axis, which an axis binding's `negativeKeys` answers. Only for a
  // binding that IS an axis: `buildActionKeyResolver` reads the sign for an
  // axis binding alone and returns a digital binding's key regardless, so a
  // negative `move_right` on a digital-only scene would press RIGHT. Pressing
  // the wrong direction is worse than not moving, so it stays unbound.
  if (vocabulary.has(positiveName) && axisNames.has(positiveName)) {
    return [positiveName, { pressed: true, axis: -magnitude }];
  }
  return null;
}

/**
 * The named actions one bot action holds while it is current.
 * @param action A planned bot action.
 * @param actionNames The scene's action vocabulary.
 * @param axisActionNames Names bound as signed axes; only these may carry a
 *   negative direction in place of a missing negative action.
 * @returns Named-action states for a trace frame; empty for actions with no engine input.
 */
export function namedActionsForBotAction(
  action: BotAction,
  actionNames: readonly string[],
  axisActionNames: readonly string[] = [],
): Record<string, InputActionState> {
  const vocabulary = new Set(actionNames);
  const axisNames = new Set(axisActionNames);
  const actions: Record<string, InputActionState> = {};
  if (action.type === 'move' && action.direction) {
    const horizontal = pickAxis(vocabulary, axisNames, action.direction.x, 'move_right', 'move_left');
    const vertical = pickAxis(vocabulary, axisNames, action.direction.y, 'move_forward', 'move_backward');
    if (horizontal) actions[horizontal[0]] = horizontal[1];
    if (vertical) actions[vertical[0]] = vertical[1];
  } else if (action.type === 'jump' && vocabulary.has('jump')) {
    actions.jump = { pressed: true };
  }
  return actions;
}

/** Milliseconds the plan spans: the last action's start plus one step. */
function planEndMs(actions: readonly BotAction[]): number {
  if (actions.length === 0) return 0;
  const last = actions[actions.length - 1].timestamp;
  const step = actions.length > 1 ? last - actions[actions.length - 2].timestamp : 0;
  return Math.max(0, last) + Math.max(step, 1000 / BOT_TRACE_TICK_HZ);
}

/**
 * Convert a bot session into a validated, bounded input trace.
 * @param session The planned session from `simulatePlaytest`.
 * @param options Fixture identity, action vocabulary and optional sampling period.
 * @returns A trace that passes `parseInputTrace`, replayable by `replay_input_trace`.
 */
export function botSessionToInputTrace(
  session: Pick<PlaytestSession, 'actions'>,
  options: BotTraceOptions,
): InputTrace {
  const sorted = [...session.actions]
    .filter((a) => Number.isFinite(a.timestamp) && a.timestamp >= 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const endMs = planEndMs(sorted);
  const minimumMsPerTick = 1000 / BOT_TRACE_TICK_HZ;
  const msPerTick = Math.max(
    minimumMsPerTick,
    options.msPerTick ?? Math.ceil(endMs / MAX_TRACE_TICKS),
  );
  const tickCount = Math.min(MAX_TRACE_TICKS, Math.ceil(endMs / msPerTick));

  const frames: InputTraceFrame[] = [];
  const axisActionNames = options.axisActionNames ?? [];
  let actionIndex = -1;
  let jumpTapped = false;
  for (let tick = 0; tick < tickCount; tick += 1) {
    const botTime = tick * msPerTick;
    while (actionIndex + 1 < sorted.length && sorted[actionIndex + 1].timestamp <= botTime) {
      actionIndex += 1;
      jumpTapped = false;
    }
    let actions: Record<string, InputActionState> = {};
    if (actionIndex >= 0) {
      const current = sorted[actionIndex];
      if (current.type === 'jump') {
        // A jump is a tap: pressed on the first tick it is current, then idle.
        if (!jumpTapped) {
          actions = namedActionsForBotAction(current, options.actionNames, axisActionNames);
          jumpTapped = true;
        }
      } else {
        actions = namedActionsForBotAction(current, options.actionNames, axisActionNames);
      }
    }
    frames.push({ tick, actions });
  }

  return parseInputTrace({
    version: INPUT_TRACE_VERSION,
    fixtureId: options.fixtureId,
    actionNames: [...options.actionNames],
    durationMs: Math.round(frames.length * minimumMsPerTick),
    frames,
  });
}
