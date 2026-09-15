/**
 * #9902 (qa.FR-1.OP-01 / qa.FR-1.OP-03) — runtime replay runner.
 *
 * Drives `replayInputTrace` / `invokeReplay` against a DETERMINISTIC fake engine
 * boundary. The separate `e2e/engine/inputReplay.spec.ts` requires a live-engine
 * run before its assertions can count as runtime evidence. These tests prove:
 *   - manual and AI source labels use the same runner contract;
 *   - simulated movement and collection produce a passed verdict;
 *   - the dead-input negative case FAILS the outcome assertion and is NOT a
 *     heuristic `gameplayBot` rating.
 */
import { describe, it, expect } from 'vitest';
import {
  replayInputTrace,
  REPLAY_INPUT_TRACE_COMMAND,
  MOVE_EPSILON,
  type ReplayEnvironment,
  type ReplayObservation,
} from '../replayRunner';
import { invokeReplay } from '../replayInvocation';
import { InputTraceValidationError, type InputTrace, INPUT_TRACE_VERSION } from '../inputTrace';
import { simulatePlaytest } from '@/lib/ai/gameplayBot';

const PLAYER = 'player-1';
const COLLECTIBLE = 'coin-1';

/** A trace that holds `move_right` for `ticks` frames. */
function moveRightTrace(ticks: number): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'minimal-2d-replay',
    actionNames: ['move_right'],
    durationMs: ticks * 16,
    frames: Array.from({ length: ticks }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true } },
    })),
  };
}

/**
 * Deterministic fake 2D runtime.
 *
 * The player starts at x=0; holding KeyD advances it +0.1 world units per
 * frame. A collectible sits at x=1.0 and is "collected" (removed from the
 * observed entities) the first frame the player reaches it — exactly the
 * despawn-on-collect the real engine performs. `bound` models whether the
 * `move_right` action is still bound to a key: when false (the negative case,
 * binding removed) the action resolves to no keys and nothing moves.
 */
function makeFakeEngine(options: { bound: boolean }) {
  const held = new Set<string>();
  let playerX = 0;
  let collectiblePresent = true;
  const pressLog: string[][] = [];

  const snapshot = (): ReplayObservation => {
    const entities: ReplayObservation['entities'] = {
      [PLAYER]: { position: [playerX, 0, 0] },
    };
    if (collectiblePresent) entities[COLLECTIBLE] = { position: [1, 0, 0] };
    return { entities };
  };

  const env: ReplayEnvironment = {
    resolveKeys: (actionName) =>
      options.bound && actionName === 'move_right' ? ['KeyD'] : [],
    pressKeys: (codes) => {
      pressLog.push(codes);
      for (const c of codes) held.add(c);
    },
    releaseKeys: (codes) => {
      for (const c of codes) held.delete(c);
    },
    advanceFrame: async () => {
      if (held.has('KeyD')) playerX += 0.1;
      if (collectiblePresent && playerX >= 1) collectiblePresent = false;
    },
    observe: snapshot,
    playerEntityId: PLAYER,
    collectibleEntityIds: [COLLECTIBLE],
  };

  return { env, pressLog, getPlayerX: () => playerX };
}

describe('replayInputTrace — simulated success path', () => {
  it('releases injected keys if advancing a frame fails', async () => {
    const { env } = makeFakeEngine({ bound: true });
    const released: string[][] = [];
    env.releaseKeys = (keys) => { released.push(keys); };
    env.advanceFrame = async () => { throw new Error('engine stopped'); };
    await expect(replayInputTrace(moveRightTrace(20), env)).rejects.toThrow('engine stopped');
    expect(released).toEqual([['KeyD']]);
  });

  it('moves the entity and collects exactly one item (verdict passed)', async () => {
    const { env, getPlayerX } = makeFakeEngine({ bound: true });
    const outcome = await replayInputTrace(moveRightTrace(20), env);

    expect(outcome.command).toBe(REPLAY_INPUT_TRACE_COMMAND);
    expect(outcome.verdict).toBe('passed');
    expect(getPlayerX()).toBeGreaterThan(MOVE_EPSILON);
    expect(outcome.collectiblesCollected).toBe(1);

    const moveAssertion = outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-01');
    const collectAssertion = outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-03');
    expect(moveAssertion?.passed).toBe(true);
    expect(collectAssertion?.passed).toBe(true);
    // Evidence, not just a boolean.
    expect(moveAssertion?.evidence.startPosition).toEqual([0, 0, 0]);
    expect(moveAssertion?.evidence.ticksReplayed).toBe(20);
  });
});

describe('replayInputTrace — manual/AI parity', () => {
  it('manual and AI invocations route to the same typed command with the same result', async () => {
    const manual = makeFakeEngine({ bound: true });
    const ai = makeFakeEngine({ bound: true });
    const trace = moveRightTrace(20);

    const manualResult = await invokeReplay('manual', trace, manual.env);
    const aiResult = await invokeReplay('ai', trace, ai.env);

    expect(manualResult.command).toBe(REPLAY_INPUT_TRACE_COMMAND);
    expect(aiResult.command).toBe(manualResult.command);
    expect(aiResult.source).toBe('ai');
    expect(manualResult.source).toBe('manual');
    // Identical runtime verdict from either entry point.
    expect(aiResult.outcome.verdict).toBe(manualResult.outcome.verdict);
    expect(aiResult.outcome.verdict).toBe('passed');
  });

  it('rejects an invalid trace identically from both paths, before touching the engine', async () => {
    const bad = { version: 999 } as unknown as InputTrace;
    const manual = makeFakeEngine({ bound: true });
    const ai = makeFakeEngine({ bound: true });

    await expect(invokeReplay('manual', bad, manual.env)).rejects.toBeInstanceOf(
      InputTraceValidationError,
    );
    await expect(invokeReplay('ai', bad, ai.env)).rejects.toBeInstanceOf(
      InputTraceValidationError,
    );
    // No input was injected because validation ran first.
    expect(manual.pressLog).toHaveLength(0);
    expect(ai.pressLog).toHaveLength(0);
  });
});

describe('replayInputTrace — negative case (dead input)', () => {
  it('fails the outcome assertion when the input binding is removed', async () => {
    // Same scene (player + collectible present), but the move action is no
    // longer bound to any key — so replay injects keys that drive nothing.
    const { env, getPlayerX } = makeFakeEngine({ bound: false });
    const outcome = await replayInputTrace(moveRightTrace(20), env);

    expect(outcome.verdict).toBe('failed');
    expect(getPlayerX()).toBe(0);
    expect(outcome.collectiblesCollected).toBe(0);
    expect(outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-01')?.passed).toBe(false);
    expect(outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-03')?.passed).toBe(false);
  });

  it('the failed verdict is a runtime outcome, not a heuristic bot rating', async () => {
    const { env } = makeFakeEngine({ bound: false });
    const outcome = await replayInputTrace(moveRightTrace(20), env);

    // The runtime outcome carries a `verdict`, never an `overallRating`.
    expect(outcome.verdict).toBe('failed');
    expect('overallRating' in outcome).toBe(false);
    expect('verdict' in outcome).toBe(true);

    // The heuristic bot, by contrast, never runs the engine and produces a
    // rating with NO runtime verdict — so its output cannot stand in for this
    // failure. A scene the runtime proved broken can still read 'good' to the
    // heuristic, which is exactly why the two must stay separately named.
    const session = await simulatePlaytest(
      {
        sceneGraph: {
          nodes: {
            [PLAYER]: { entityId: PLAYER, name: 'Player', components: [], parentId: null, children: [], visible: true },
            [COLLECTIBLE]: { entityId: COLLECTIBLE, name: 'Coin', components: [], parentId: null, children: [], visible: true },
          },
          rootIds: [PLAYER, COLLECTIBLE],
        },
        gameComponents: {
          [PLAYER]: [{ type: 'characterController' }],
          [COLLECTIBLE]: [{ type: 'collectible' }],
        },
      },
      'completionist',
    );
    expect('verdict' in session).toBe(false);
    expect(session).toHaveProperty('outcome');
  });
});
