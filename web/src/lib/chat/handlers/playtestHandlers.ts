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
import { runReplay } from '@/lib/playtest/replayEntryPoints';
import type { EngineDispatch } from '@/lib/playtest/replayInvocation';
import { simulatePlaytest, type BotStrategy, type SceneContext } from '@/lib/ai/gameplayBot';

const BOT_STRATEGY_NAMES = ['explorer', 'speedrunner', 'completionist', 'random', 'cautious'] as const;
const zStrategy = z.enum(BOT_STRATEGY_NAMES);

/** Mirrors the engine's `pin_frame_rate` bounds (`core::simulation_clock`). */
const zPinHz = z.number().int().min(1).max(240);

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
      trace = botSessionToInputTrace(session, {
        fixtureId: ctx.store.sceneName || 'current-scene',
        actionNames: (ctx.store.inputBindings ?? []).map((b) => b.actionName),
      });
    }
    const parsed = safeParseInputTrace(trace);
    if (!parsed.success) return { success: false, error: parsed.error };

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
        {},
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
    const hz = p.data.hz ?? 60;
    ctx.dispatchCommand('pin_frame_rate', { hz });
    return {
      success: true,
      result: { message: `Simulation clock pinned to ${hz} Hz (one tick per rendered frame)`, hz },
    };
  },

  unpin_frame_rate: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.dispatchCommand('unpin_frame_rate', {});
    return {
      success: true,
      result: { message: 'Simulation clock returned to the wall clock' },
    };
  },
};
