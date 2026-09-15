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
 * The player starts at x=0; holding KeyD advances it +0.1 and holding KeyA
 * retreats it -0.1 world units per frame. A collectible sits at x=1.0 and is
 * "collected" (removed from the observed entities) the first frame the player
 * reaches it — exactly the despawn-on-collect the real engine performs. `bound`
 * models whether the movement actions are still bound to a key: when false (the
 * negative case, binding removed) every action resolves to no keys and nothing
 * moves. `move_right` binds KeyD and `move_left` binds KeyA so a trace that
 * switches actions across ticks exercises key diffing in both directions.
 *
 * `pressLog` / `releaseLog` record every `pressKeys` / `releaseKeys` call in
 * order, so a test can assert a held key is pressed once (not re-pressed each
 * tick it stays down) and released exactly when its action ends.
 */
function makeFakeEngine(options: { bound: boolean }) {
  const held = new Set<string>();
  let playerX = 0;
  let collectiblePresent = true;
  const pressLog: string[][] = [];
  const releaseLog: string[][] = [];

  const snapshot = (): ReplayObservation => {
    const entities: ReplayObservation['entities'] = {
      [PLAYER]: { position: [playerX, 0, 0] },
    };
    if (collectiblePresent) entities[COLLECTIBLE] = { position: [1, 0, 0] };
    return { entities };
  };

  const env: ReplayEnvironment = {
    resolveKeys: (actionName) => {
      if (!options.bound) return [];
      if (actionName === 'move_right') return ['KeyD'];
      if (actionName === 'move_left') return ['KeyA'];
      return [];
    },
    pressKeys: (codes) => {
      pressLog.push(codes);
      for (const c of codes) held.add(c);
    },
    releaseKeys: (codes) => {
      releaseLog.push(codes);
      for (const c of codes) held.delete(c);
    },
    advanceFrame: async () => {
      if (held.has('KeyD')) playerX += 0.1;
      if (held.has('KeyA')) playerX -= 0.1;
      if (collectiblePresent && playerX >= 1) collectiblePresent = false;
    },
    observe: snapshot,
    playerEntityId: PLAYER,
    collectibleEntityIds: [COLLECTIBLE],
  };

  return { env, pressLog, releaseLog, getPlayerX: () => playerX };
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

describe('replayInputTrace — frame-to-frame key diffing', () => {
  it('presses a held key once and releases it once when its action ends mid-trace', async () => {
    // move_right held for ticks 0–9, then explicitly released (pressed:false)
    // for ticks 10–19. The action ENDS mid-trace, so the runner must release
    // KeyD once at tick 10 and never re-press it while it stays held on 1–9.
    const trace: InputTrace = {
      version: INPUT_TRACE_VERSION,
      fixtureId: 'diff-2d-replay',
      actionNames: ['move_right'],
      durationMs: 20 * 16,
      frames: Array.from({ length: 20 }, (_, tick) => ({
        tick,
        actions: { move_right: { pressed: tick < 10 } },
      })),
    };
    const { env, pressLog, releaseLog, getPlayerX } = makeFakeEngine({ bound: true });
    await replayInputTrace(trace, env);

    // Pressed exactly once (tick 0) and HELD across ticks 1–9 — not re-pressed
    // per tick. A reversed toRelease/toPress computation would press every tick.
    expect(pressLog).toEqual([['KeyD']]);
    // Released exactly once, when the action ends at tick 10 — this is the
    // in-loop diff release, NOT the finally-block cleanup (held is already empty
    // by the time the loop ends), unlike the advanceFrame-failure test above.
    expect(releaseLog).toEqual([['KeyD']]);
    // Moved for the 10 held ticks only (10 × 0.1), then came to rest.
    expect(getPlayerX()).toBeCloseTo(1.0, 5);
  });

  it('releases a held key on a tick that has no frame at all (frame gap)', async () => {
    // Frames exist only for ticks 0 and 5; ticks 1–4 have NO frame, so
    // framesByTick.get returns undefined and the active set defaults to empty.
    // The runner must release KeyD across the gap and re-press it at tick 5.
    const trace: InputTrace = {
      version: INPUT_TRACE_VERSION,
      fixtureId: 'gap-2d-replay',
      actionNames: ['move_right'],
      durationMs: 6 * 16,
      frames: [
        { tick: 0, actions: { move_right: { pressed: true } } },
        { tick: 5, actions: { move_right: { pressed: true } } },
      ],
    };
    const { env, pressLog, releaseLog } = makeFakeEngine({ bound: true });
    await replayInputTrace(trace, env);

    // Pressed at tick 0, released across the gap (tick 1), re-pressed at tick 5.
    expect(pressLog).toEqual([['KeyD'], ['KeyD']]);
    // First release is the frame-gap release; the trailing release is the
    // finally-block cleanup for the key still held after the last frame.
    expect(releaseLog).toEqual([['KeyD'], ['KeyD']]);
  });

  it('diffs keys in both directions when the pressed action switches across ticks', async () => {
    // move_right (KeyD) for ticks 0–1, then move_left (KeyA) for ticks 2–3. On
    // the switch the runner must release the ended action's key and press the
    // new one — holding both would cancel movement out.
    const trace: InputTrace = {
      version: INPUT_TRACE_VERSION,
      fixtureId: 'switch-2d-replay',
      actionNames: ['move_right', 'move_left'],
      durationMs: 4 * 16,
      frames: [
        { tick: 0, actions: { move_right: { pressed: true } } },
        { tick: 1, actions: { move_right: { pressed: true } } },
        { tick: 2, actions: { move_left: { pressed: true } } },
        { tick: 3, actions: { move_left: { pressed: true } } },
      ],
    };
    const { env, pressLog, releaseLog } = makeFakeEngine({ bound: true });
    await replayInputTrace(trace, env);

    // KeyD pressed once (held 0–1), then KeyA pressed once (held 2–3): a held
    // key is never re-pressed per tick, and each action's key is pressed only
    // when it begins.
    expect(pressLog).toEqual([['KeyD'], ['KeyA']]);
    // KeyD released at the switch (tick 2, before KeyA is pressed); KeyA
    // released by the finally-block cleanup after the last frame.
    expect(releaseLog).toEqual([['KeyD'], ['KeyA']]);
  });
});
