/**
 * Runtime input-trace replay runner (#9902, qa.FR-1.OP-01 / qa.FR-1.OP-03).
 *
 * ONE typed command — `replay_input_trace` — replays a bounded `InputTrace`
 * through the REAL runtime input path (named actions → key codes → the same
 * DOM-keyboard channel a human's keystrokes travel, which the engine's
 * `capture_input` reads from Bevy's `ButtonInput`), then reads OBSERVED engine
 * state and returns a pass/fail verdict backed by tick/action/outcome evidence.
 *
 * WHY THIS IS NOT `gameplayBot.ts`. `simulatePlaytest` in `lib/ai/gameplayBot.ts`
 * is a HEURISTIC: it inspects the scene graph statically and produces an
 * `overallRating` ('excellent' | 'good' | 'needs_work' | 'critical_issues')
 * WITHOUT ever running the engine. This runner runs the engine and asserts on
 * what it observed. The two must never be conflated: a `ReplayOutcome.verdict`
 * of `'failed'` is a real runtime failure and CANNOT be satisfied by a heuristic
 * rating. Deliberately, this module exposes no `rating` and imports nothing from
 * `gameplayBot`, and its result type carries `verdict`, not `overallRating`, so
 * a caller cannot accidentally read one where it meant the other.
 */

import {
  parseInputTrace,
  type InputTrace,
  type InputTraceFrame,
} from './inputTrace';

/** The single typed command both manual and AI replay invocations dispatch. */
export const REPLAY_INPUT_TRACE_COMMAND = 'replay_input_trace' as const;

/** Minimum world-unit displacement that counts as "the entity moved". */
export const MOVE_EPSILON = 0.01;

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** The observed runtime state the runner reads before and after a replay. */
export interface ReplayObservation {
  entities: Record<string, { position: [number, number, number] }>;
}

/**
 * The runtime boundary the runner drives. Every method is injectable so unit
 * tests can supply a deterministic fake engine, while the browser wires the
 * real DOM-keyboard channel, `requestAnimationFrame`, and the play-tick bus (see
 * `replayInvocation.ts`).
 */
export interface ReplayEnvironment {
  /**
   * Resolve a named action, in the state it held on a tick, to the key
   * `event.code`s currently bound to it. The `state` is passed so an AXIS
   * action presses only the direction it was recorded in (positive vs
   * negative) rather than both keys, which would cancel out.
   */
  resolveKeys(actionName: string, state: InputTraceFrame['actions'][string]): string[];
  /** Press these key codes through the real runtime input path. */
  pressKeys(codes: string[]): void | Promise<void>;
  /** Release these key codes through the real runtime input path. */
  releaseKeys(codes: string[]): void | Promise<void>;
  /** Advance the engine one frame, resolving once it has ticked. */
  advanceFrame(): Promise<void>;
  /** Read the latest observed runtime snapshot, or null if none yet. */
  observe(): ReplayObservation | null;
  /** The entity whose displacement proves input reached the runtime. */
  playerEntityId: string;
  /** Collectible entity ids expected to be collected (despawned) on replay. */
  collectibleEntityIds: string[];
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

/** Key codes active on a given tick, unioned across every pressed action. */
function keysForFrame(frame: InputTraceFrame, env: ReplayEnvironment): Set<string> {
  const codes = new Set<string>();
  for (const [actionName, state] of Object.entries(frame.actions)) {
    if (!state.pressed && (state.axis ?? 0) === 0) continue;
    for (const code of env.resolveKeys(actionName, state)) codes.add(code);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Replay a bounded input trace through the real runtime and return an
 * observed-state verdict.
 *
 * The trace is re-validated here (identical `parseInputTrace` gate as the
 * recorder and the AI path), so an invalid trace throws BEFORE any input is
 * injected. Keys are diffed frame-to-frame — released when an action ends,
 * pressed when it begins, HELD across ticks that keep it down — which is what
 * makes a held-key trace behave like a held key rather than a burst of taps.
 */
export async function replayInputTrace(
  trace: InputTrace,
  env: ReplayEnvironment,
): Promise<ReplayOutcome> {
  const validated = parseInputTrace(trace);

  const before = env.observe();
  const startPosition = before?.entities[env.playerEntityId]?.position ?? null;
  const collectiblesPresentAtStart = new Set(
    env.collectibleEntityIds.filter((id) => before?.entities[id] !== undefined),
  );

  const framesByTick = new Map<number, InputTraceFrame>();
  for (const frame of validated.frames) framesByTick.set(frame.tick, frame);
  const lastTick = validated.frames.reduce((max, f) => Math.max(max, f.tick), -1);

  const held = new Set<string>();
  let ticksReplayed = 0;
  for (let tick = 0; tick <= lastTick; tick += 1) {
    const frame = framesByTick.get(tick);
    const active = frame ? keysForFrame(frame, env) : new Set<string>();

    const toRelease = [...held].filter((code) => !active.has(code));
    const toPress = [...active].filter((code) => !held.has(code));
    if (toRelease.length > 0) await env.releaseKeys(toRelease);
    if (toPress.length > 0) await env.pressKeys(toPress);
    for (const code of toRelease) held.delete(code);
    for (const code of toPress) held.add(code);

    await env.advanceFrame();
    ticksReplayed += 1;
  }

  // Release everything and let the runtime settle so the final observation
  // reflects a resting state, not a mid-input frame.
  if (held.size > 0) await env.releaseKeys([...held]);
  held.clear();
  await env.advanceFrame();
  await env.advanceFrame();

  const after = env.observe();
  const endPosition = after?.entities[env.playerEntityId]?.position ?? null;

  const movedDistance =
    startPosition && endPosition ? distance(startPosition, endPosition) : null;
  const moved = movedDistance !== null && movedDistance > MOVE_EPSILON;

  const collected = [...collectiblesPresentAtStart].filter(
    (id) => after?.entities[id] === undefined,
  );
  const collectiblesCollected = collected.length;

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
      },
    },
    {
      operationId: 'qa.FR-1.OP-03',
      description: 'exactly one collectible collected during replay',
      passed: collectiblesCollected === 1,
      evidence: {
        collectiblesPresentAtStart: [...collectiblesPresentAtStart],
        collectedEntityIds: collected,
        collectiblesCollected,
      },
    },
  ];

  return {
    command: REPLAY_INPUT_TRACE_COMMAND,
    verdict: assertions.every((a) => a.passed) ? 'passed' : 'failed',
    ticksReplayed,
    assertions,
    playerEntityId: env.playerEntityId,
    startPosition,
    endPosition,
    movedDistance,
    collectiblesCollected,
  };
}
