/**
 * The ONE place a replay request becomes a runtime boundary (#10007).
 *
 * Three entry points call this module and nothing else: the manual Replay
 * controls in `PlaytestPanel`, the E2E hooks in `EditorLayout`
 * (`window.__FORGE_REPLAY` / `__FORGE_REPLAY_CONTROL`), and the in-app AI tool
 * `replay_input_trace` (`lib/chat/handlers/playtestHandlers.ts`). All three
 * hand over the same `ReplayRequest`, get the same validation (and the same
 * error text), the same environment built from the same store state, and the
 * same engine command sequence — differing in nothing but the source label.
 * `__tests__/replayParity.test.ts` holds that to be true.
 *
 * Store reads are injectable (`deps`) so the parity test can run both paths
 * against one recorded dispatcher and one simulated play-tick bus.
 */

import { getCommandDispatcher, useEditorStore } from '@/stores/editorStore';
import type { InputBinding } from '@/stores/slices/types';
import { parseInputTrace, type InputTrace } from './inputTrace';
import {
  createDomKeyboardEnvironment,
  invokeReplay,
  startReplayInvocation,
  type EngineDispatch,
  type ReplayInvocationResult,
  type ReplaySession,
  type ReplaySource,
} from './replayInvocation';
import type { ReplayEnvironment, ReplayRunOptions } from './replayRunner';

/** What every entry point supplies. `trace` is untrusted until validated here. */
export interface ReplayRequest {
  trace: unknown;
  playerEntityId: string;
  /** Collectibles to observe; defaults to every entity carrying a `collectible` component. */
  collectibleEntityIds?: string[] | undefined;
}

/** Store-derived inputs, overridable for tests. Each defaults to the live editor store. */
export interface ReplayEntryDeps {
  bindings?: InputBinding[];
  allGameComponents?: Record<string, ReadonlyArray<{ type: string }> | undefined> | null;
  dispatch?: EngineDispatch | null;
}

/**
 * Every entity that carries a `collectible` game component — the default
 * observation set, identical for the manual panel and the AI tool.
 * @param allGameComponents The store's per-entity game component lists.
 * @returns Entity ids in store order.
 */
export function collectibleEntityIdsFrom(
  allGameComponents: ReplayEntryDeps['allGameComponents'],
): string[] {
  return Object.entries(allGameComponents ?? {})
    .filter(([, components]) => (components ?? []).some((c) => c.type === 'collectible'))
    .map(([id]) => id);
}

function resolveDeps(deps: ReplayEntryDeps): Required<ReplayEntryDeps> {
  const state = useEditorStore.getState();
  return {
    bindings: deps.bindings ?? state.inputBindings ?? [],
    allGameComponents: deps.allGameComponents ?? state.allGameComponents ?? {},
    dispatch: deps.dispatch === undefined ? getCommandDispatcher() : deps.dispatch,
  };
}

/**
 * Validate a request's trace and build the real browser runtime boundary for it.
 * @param request Trace and the entities to observe.
 * @param deps Store overrides.
 * @returns The validated trace and the environment to replay it in.
 * @throws InputTraceValidationError before anything touches the engine.
 */
export function prepareReplay(
  request: ReplayRequest,
  deps: ReplayEntryDeps = {},
): { trace: InputTrace; env: ReplayEnvironment } {
  const trace = parseInputTrace(request.trace);
  const resolved = resolveDeps(deps);
  const env = createDomKeyboardEnvironment({
    bindings: resolved.bindings,
    playerEntityId: request.playerEntityId,
    collectibleEntityIds:
      request.collectibleEntityIds ?? collectibleEntityIdsFrom(resolved.allGameComponents),
    dispatch: resolved.dispatch,
  });
  return { trace, env };
}

/**
 * Run a replay to completion from any entry point.
 * @param source Who asked: the manual controls or the in-app AI.
 * @param request Trace and the entities to observe.
 * @param options Pause boundary, pin rate, handle callback.
 * @param deps Store overrides.
 * @returns The outcome with its source label.
 */
export async function runReplay(
  source: ReplaySource,
  request: ReplayRequest,
  options: ReplayRunOptions = {},
  deps: ReplayEntryDeps = {},
): Promise<ReplayInvocationResult> {
  const { trace, env } = prepareReplay(request, deps);
  return invokeReplay(source, trace, env, options);
}

/**
 * Start a controlled replay (pause / resume / cancel) from any entry point.
 * @param source Who asked: the manual controls or the in-app AI.
 * @param request Trace and the entities to observe.
 * @param options Pause boundary, pin rate, handle callback.
 * @param deps Store overrides.
 * @returns The session whose handle controls and reports the run.
 */
export function startReplaySession(
  source: ReplaySource,
  request: ReplayRequest,
  options: ReplayRunOptions = {},
  deps: ReplayEntryDeps = {},
): ReplaySession {
  const { trace, env } = prepareReplay(request, deps);
  return startReplayInvocation(source, trace, env, options);
}
