/**
 * Runtime playtest handlers (#10007, qa.FR-1 AI parity).
 *
 * `replay_input_trace` is the in-app AI's entry to the SAME runtime replay the
 * manual Replay button runs: the same `replayEntryPoints.runReplay`, the same
 * validation (and error text), the same engine commands — labelled `'ai'`.
 * It accepts either a recorded trace or an AI bot strategy; a strategy is
 * planned by `simulatePlaytest` and turned into a trace by `botTrace.ts`, so
 * the bot's session actually operates the running game instead of being rated
 * from the scene graph. `__tests__/replayParity.test.ts` holds the manual and
 * AI paths to identical engine command sequences and identical outcomes.
 *
 * `pin_frame_rate` / `unpin_frame_rate` expose the simulation-clock pin the
 * runner uses, for an agent that wants a deterministic Play session of its own.
 */

import { z } from 'zod';
import type { CommandResponse } from '@/hooks/useEngine';
import type { ExecutionResult, ToolHandler } from './types';
import { parseArgs, zEntityId } from './types';
import { safeParseInputTrace } from '@/lib/playtest/inputTrace';
import { botSessionToInputTrace } from '@/lib/playtest/botTrace';
import { getActiveReplaySession, runReplay } from '@/lib/playtest/replayEntryPoints';
import { replayAxisActionNames, type EngineDispatch } from '@/lib/playtest/replayInvocation';
import type { ReplayRunOptions } from '@/lib/playtest/replayRunner';
import { simulatePlaytest, type BotStrategy, type SceneContext } from '@/lib/ai/gameplayBot';

const BOT_STRATEGY_NAMES = ['explorer', 'speedrunner', 'completionist', 'random', 'cautious'] as const;
const zStrategy = z.enum(BOT_STRATEGY_NAMES);

/**
 * Mirrors the engine's `pin_frame_rate` bounds (`core::simulation_clock`
 * `MIN_PIN_HZ..=MAX_PIN_HZ`). The floor is 4 Hz because Bevy clamps any step
 * longer than 250 ms, so a slower pin could not advance the `1 / hz` it claims.
 */
const zPinHz = z.number().int().min(4).max(240);

/** The error the manual controls express by disabling Replay outside Play mode. */
export const REPLAY_REQUIRES_PLAY_MODE =
  'Replay requires Play mode: enter Play mode, then replay recorded or AI input.';

/** Exactly one input source is accepted, so a request can never be ambiguous. */
export const REPLAY_NEEDS_ONE_SOURCE =
  'Provide exactly one of trace (a recorded input trace) or strategy (an AI bot strategy to plan and replay).';

/** The same scene context the PlaytestPanel hands the heuristic bot. */
function sceneContextOf(store: Parameters<ToolHandler>[1]['store']): SceneContext {
  const gameComponents: Record<string, { type: string }[]> = {};
  for (const [id, components] of Object.entries(store.allGameComponents ?? {})) {
    if (components) gameComponents[id] = components.map((c) => ({ type: c.type }));
  }
  return {
    sceneGraph: store.sceneGraph,
    gameComponents,
    projectType: store.projectType === '2d' ? '2d' : '3d',
  };
}

export const playtestHandlers: Record<string, ToolHandler> = {
  replay_input_trace: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        playerEntityId: zEntityId,
        collectibleEntityIds: z.array(zEntityId).optional(),
        trace: z.unknown().optional(),
        strategy: zStrategy.optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    const { playerEntityId, collectibleEntityIds } = p.data;
    const hasTrace = p.data.trace !== undefined;
    const hasStrategy = p.data.strategy !== undefined;
    if (hasTrace === hasStrategy) return { success: false, error: REPLAY_NEEDS_ONE_SOURCE };
    if (ctx.store.engineMode !== 'play') return { success: false, error: REPLAY_REQUIRES_PLAY_MODE };

    let trace: unknown = p.data.trace;
    const strategy: BotStrategy | undefined = p.data.strategy;
    if (strategy) {
      const session = await simulatePlaytest(sceneContextOf(ctx.store), strategy);
      const bindings = ctx.store.inputBindings ?? [];
      trace = botSessionToInputTrace(session, {
        fixtureId: ctx.store.sceneName || 'current-scene',
        actionNames: bindings.map((b) => b.actionName),
        // Only the primary player's signed-axis bindings may answer a negative
        // direction (a digital one would press its positive key for it — the
        // wrong way), read from the same map the key resolver reads.
        axisActionNames: replayAxisActionNames(bindings),
      });
    }
    const parsed = safeParseInputTrace(trace);
    if (!parsed.success) return { success: false, error: parsed.error };
    // A planned strategy never aims for a collectible, so its verdict is the
    // movement assertion alone; a recorded trace keeps the full verdict.
    const runOptions: ReplayRunOptions = strategy ? { assertCollectible: false } : {};

    // The context's dispatcher IS the engine dispatcher (`executeToolCall`
    // passes `getCommandDispatcher()`), typed `=> void` because most handlers
    // ignore the answer. The replay needs it: the clock pin is confirmed from
    // the engine's own response.
    const dispatch: EngineDispatch = (command, payload) =>
      ctx.dispatchCommand(command, payload) as CommandResponse | void;
    try {
      const result = await runReplay(
        'ai',
        { trace: parsed.trace, playerEntityId, collectibleEntityIds },
        runOptions,
        {
          bindings: ctx.store.inputBindings ?? [],
          allGameComponents: ctx.store.allGameComponents ?? {},
          dispatch,
        },
      );
      return {
        success: true,
        result: {
          command: result.command,
          source: result.source,
          strategy: strategy ?? null,
          outcome: result.outcome,
        },
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  pin_frame_rate: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ hz: zPinHz.optional() }), args);
    if (p.error) return p.error;
    const busy = replayGuardRefusal('pin_frame_rate');
    if (busy) return { success: false, error: busy };
    const hz = p.data.hz ?? 60;
    const refusal = engineRefusal(
      'pin_frame_rate',
      ctx.dispatchCommand('pin_frame_rate', { hz }) as CommandResponse | void,
    );
    if (refusal) return { success: false, error: refusal };
    return {
      success: true,
      result: {
        message:
          `Simulation clock pinned to ${hz} Hz: every rendered frame advances the game by ` +
          `exactly 1/${hz} s. Stop releases it while Play is running; a pin made in Edit mode ` +
          'stays until unpin_frame_rate.',
        hz,
      },
    };
  },

  unpin_frame_rate: async (_args, ctx): Promise<ExecutionResult> => {
    const busy = replayGuardRefusal('unpin_frame_rate');
    if (busy) return { success: false, error: busy };
    const refusal = engineRefusal(
      'unpin_frame_rate',
      ctx.dispatchCommand('unpin_frame_rate', {}) as CommandResponse | void,
    );
    if (refusal) return { success: false, error: refusal };
    return {
      success: true,
      result: { message: 'Simulation clock returned to the wall clock' },
    };
  },
};

/**
 * The raw clock tools are a fourth door past the replay single-flight guard
 * (`replayEntryPoints`): a pin or unpin issued while a replay is running
 * would land in the middle of a run that owns the clock and pins its own
 * rate. Refused while a session is active, naming the origin that holds it.
 * @param tool The clock tool that was called.
 * @returns The error text to return, or null when no replay is running.
 */
function replayGuardRefusal(tool: string): string | null {
  const active = getActiveReplaySession();
  if (!active) return null;
  return (
    `${tool} refused: a replay is already running (started by the ${active.source} controls) ` +
    'and owns the engine clock. Wait for it to finish or cancel it first.'
  );
}

/**
 * The engine's answer to a clock command, as a tool error when it is not an
 * explicit acceptance. The context's dispatcher is typed `=> void` because
 * most handlers ignore the answer; these two cannot — reporting "pinned" for
 * a pin the engine refused (or that no engine confirmed) is exactly the kind
 * of claim an agent then builds a deterministic session on.
 * @param command The clock command that was dispatched.
 * @param response What the dispatcher answered, if anything.
 * @returns The error text to return, or null when the engine accepted.
 */
function engineRefusal(command: string, response: CommandResponse | void): string | null {
  if (response?.success === true) return null;
  const reason = response?.error ?? 'no engine confirmed the command';
  return `${command} was not applied: ${reason}`;
}
