/**
 * The ONE place a replay request becomes a runtime boundary (#10007).
 *
 * Three entry points call this module and nothing else: the manual Replay
 * controls and the bot's "Run Playtest" in `PlaytestPanel`, the E2E hooks in
 * `EditorLayout` (`window.__FORGE_REPLAY` / `__FORGE_REPLAY_CONTROL`), and the
 * in-app AI tool `replay_input_trace` (`lib/chat/handlers/playtestHandlers.ts`).
 * All of them hand over the same `ReplayRequest`, get the same validation (and
 * the same error text), the same environment built from the same store state,
 * and the same engine command sequence — differing in nothing but the source
 * label. `__tests__/replayParity.test.ts` holds that to be true.
 *
 * ONE REPLAY AT A TIME. The clock pin is engine-global and every run unpins
 * on its own exit, so two overlapping runs would have the first's unpin and
 * key release land in the middle of the second, which would then finish on
 * the wall clock while still reporting `pinned: true`. This module therefore
 * holds a single-flight guard: a second start, from any entry point, is
 * refused with `ReplayBusyError` BEFORE it pins the clock or touches a key,
 * and the active run is left alone. The guard is released when the active
 * run's `result` settles — completed, cancelled or failed.
 *
 * LEAVING PLAY CANCELS THE ACTIVE RUN. Stop makes the engine restore its edit
 * snapshot and never tick again, so a run left in flight would hold its
 * synthetic keys and its pin until the boundary's stalled-tick timeout turned
 * the creator's Stop into a failure. Every session started here therefore
 * watches the store's `engineMode` and cancels itself on the transition to
 * `'edit'` — whichever entry point started it, so a bot or chat replay is
 * cancelled by Stop exactly as a manual one is. Keyed on `'edit'`, not on
 * leaving `'play'`: the runner's own Pause moves the engine to `'paused'`, and
 * a replay has to survive its own pause. `__tests__/replayEntryPoints.test.ts`
 * pins both rules.
 *
 * Store reads are injectable (`deps`) so the parity test can run both paths
 * against one recorded dispatcher and one simulated play-tick bus.
 */

import { getCommandDispatcher, useEditorStore } from '@/stores/editorStore';
import type { InputBinding } from '@/stores/slices/types';
import { parseInputTrace, type InputTrace } from './inputTrace';
import {
  createDomKeyboardEnvironment,
  startReplayInvocation,
  type EngineDispatch,
  type ReplayInvocationResult,
  type ReplaySession,
  type ReplaySource,
} from './replayInvocation';
import { outcomeOf, type ReplayEnvironment, type ReplayRunOptions } from './replayRunner';

/** What every entry point supplies. `trace` is untrusted until validated here. */
export interface ReplayRequest {
  trace: unknown;
  playerEntityId: string;
  /** Collectibles to observe; defaults to every entity carrying a `collectible` component. */
  collectibleEntityIds?: string[] | undefined;
}

/**
 * Delivers the store's `engineMode` whenever it changes; returns the
 * unsubscribe. The default reads the live editor store.
 */
export type EngineModeSubscription = (listener: (mode: string) => void) => () => void;

/** Store-derived inputs, overridable for tests. Each defaults to the live editor store. */
export interface ReplayEntryDeps {
  bindings?: InputBinding[];
  allGameComponents?: Record<string, ReadonlyArray<{ type: string }> | undefined> | null;
  dispatch?: EngineDispatch | null;
  subscribeEngineMode?: EngineModeSubscription;
}

/** Thrown by `startReplaySession` / `runReplay` when a replay is already running. */
export class ReplayBusyError extends Error {
  /** Who started the run that is still in flight. */
  readonly activeSource: ReplaySource;
  /** @param activeSource Source label of the run that is still in flight. */
  constructor(activeSource: ReplaySource) {
    super(
      `A replay is already running (started by the ${activeSource} controls). ` +
        'Only one replay can run at a time because it pins the engine clock; ' +
        'wait for it to finish or cancel it first.',
    );
    this.name = 'ReplayBusyError';
    this.activeSource = activeSource;
  }
}

// ---------------------------------------------------------------------------
// Single-flight guard
// ---------------------------------------------------------------------------

let activeSession: ReplaySession | null = null;
const activeListeners = new Set<(session: ReplaySession | null) => void>();

function setActiveSession(session: ReplaySession | null): void {
  activeSession = session;
  for (const listener of activeListeners) {
    try {
      listener(session);
    } catch (error) {
      console.error('[replayEntryPoints] active-session listener threw; continuing', error);
    }
  }
}

/**
 * The replay currently in flight, from any entry point, or null.
 * @returns The active session, or null when no replay is running.
 */
export function getActiveReplaySession(): ReplaySession | null {
  return activeSession;
}

/**
 * Be told when a replay becomes active and when the guard is released. Suited
 * to `useSyncExternalStore` (the session object is a stable snapshot).
 * @param listener Receives the active session, or null on release.
 * @returns The unsubscribe.
 */
export function subscribeActiveReplaySession(
  listener: (session: ReplaySession | null) => void,
): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

/**
 * Cancel the replay in flight, whichever entry point started it.
 * @returns Whether a run was active and the cancel applied.
 */
export function cancelActiveReplay(): boolean {
  return activeSession?.handle.cancel() ?? false;
}

/** The live store's `engineMode`, delivered on every change. */
const subscribeEngineModeFromStore: EngineModeSubscription = (listener) =>
  useEditorStore.subscribe((state, previous) => {
    if (state.engineMode !== previous.engineMode) listener(state.engineMode);
  });

// ---------------------------------------------------------------------------
// Request → environment
// ---------------------------------------------------------------------------

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
    subscribeEngineMode: deps.subscribeEngineMode ?? subscribeEngineModeFromStore,
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

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Start a controlled replay (pause / resume / cancel) from any entry point.
 *
 * Takes the single-flight guard (or refuses), builds the boundary, starts
 * the run, and arms the Stop watch. The guard is taken AFTER validation so
 * an invalid trace never occupies it, and the run is started only once the
 * guard is held so a refused start has dispatched nothing.
 * @param source Who asked: the manual controls or the in-app AI.
 * @param request Trace and the entities to observe.
 * @param options Pause boundary, pin rate, handle callback.
 * @param deps Store overrides.
 * @returns The session whose handle controls and reports the run.
 * @throws ReplayBusyError when a replay is already running;
 *   InputTraceValidationError for an invalid trace.
 */
export function startReplaySession(
  source: ReplaySource,
  request: ReplayRequest,
  options: ReplayRunOptions = {},
  deps: ReplayEntryDeps = {},
): ReplaySession {
  if (activeSession) throw new ReplayBusyError(activeSession.source);
  const { trace, env } = prepareReplay(request, deps);
  const subscribeEngineMode = deps.subscribeEngineMode ?? subscribeEngineModeFromStore;

  const session = startReplayInvocation(source, trace, env, options);
  setActiveSession(session);
  const stopWatching = subscribeEngineMode((mode) => {
    if (mode === 'edit') session.handle.cancel();
  });
  // `result` never rejects. Registered before any caller can await it, so
  // the guard is released before a caller's own continuation runs.
  void session.handle.result.then(() => {
    stopWatching();
    if (activeSession === session) setActiveSession(null);
  });
  return session;
}

/**
 * Run a replay to completion from any entry point. The uncontrolled form of
 * `startReplaySession`: same guard, same Stop watch; resolves with the outcome
 * and throws for a busy guard, an invalid trace, a refused pin, a boundary
 * failure, or a cancellation (including the one Stop issues).
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
  const session = startReplaySession(source, request, options, deps);
  const outcome = outcomeOf(await session.handle.result);
  return { command: session.command, source: session.source, outcome };
}
