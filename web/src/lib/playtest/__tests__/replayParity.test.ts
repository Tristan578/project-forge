// @vitest-environment jsdom
/**
 * #10007 — manual / AI parity, proven on the engine's wire.
 *
 * The manual Replay button (`startReplaySession('manual', …)`, what
 * `PlaytestPanel` calls) and the in-app AI tool (`replay_input_trace`, the
 * chat handler) are run against ONE simulated engine: the real DOM-keyboard
 * boundary dispatching real `KeyboardEvent`s on the `#forge-canvas`, the real
 * play-tick bus, and one recording command dispatcher. The simulated engine
 * moves the player while `KeyD` is down and despawns the coin when reached,
 * which is enough to make both paths produce a full verdict.
 *
 * What is compared is not "both passed" but the SEQUENCES: every engine
 * command (name and payload) in order, every key event on the canvas in order,
 * and the whole outcome object — identical except the source label. The same
 * comparison is then made for the issue's negative (dead input): both paths
 * must fail the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@/hooks/useEngine';
import { publishPlayTick, resetPlayTickBus, type PlayTickSnapshot } from '../playTickBus';
import { INPUT_TRACE_VERSION, type InputTrace } from '../inputTrace';
import type { EngineDispatch } from '../replayInvocation';
import type { ReplayOutcome } from '../replayRunner';

// --- One store state for both paths ----------------------------------------
const storeState = vi.hoisted(() => ({
  engineMode: 'play' as string,
  sceneName: 'parity-fixture',
  primaryId: 'player',
  sceneGraph: { nodes: {}, rootIds: [] as string[] },
  projectType: '2d',
  inputBindings: [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ] as Array<Record<string, unknown>>,
  allGameComponents: { coin: [{ type: 'collectible' }] } as Record<string, Array<{ type: string }>>,
}));
const dispatcherSlot = vi.hoisted(() => ({ current: null as EngineDispatch | null }));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(() => storeState, { getState: () => storeState }),
  getCommandDispatcher: () => dispatcherSlot.current,
}));

import { startReplaySession } from '../replayEntryPoints';
import { playtestHandlers } from '@/lib/chat/handlers/playtestHandlers';

const PLAYER = 'player';
const COIN = 'coin';
const TICKS = 40;

function holdRightTrace(): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'parity-fixture',
    actionNames: ['move_right'],
    durationMs: TICKS * 16,
    frames: Array.from({ length: TICKS }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true, axis: 1 } },
    })),
  };
}

/**
 * A simulated engine behind the REAL browser boundary. Key state comes from
 * the KeyboardEvents the boundary dispatches on the canvas; commands come from
 * the dispatcher the boundary calls; frames are published on the play-tick bus
 * from a driver loop that yields a macrotask per frame, exactly where a real
 * engine frame would sit.
 */
function makeSimulatedEngine() {
  const canvas = document.createElement('canvas');
  canvas.id = 'forge-canvas';
  document.body.append(canvas);

  const commandLog: Array<[string, unknown]> = [];
  const keyLog: string[] = [];
  const held = new Set<string>();
  let playerX = 0;
  let coinPresent = true;
  let paused = false;
  let pinnedHz: number | null = null;
  let frames = 0;

  canvas.addEventListener('keydown', (e) => {
    keyLog.push(`down ${e.code}`);
    held.add(e.code);
  });
  canvas.addEventListener('keyup', (e) => {
    keyLog.push(`up ${e.code}`);
    held.delete(e.code);
  });

  const dispatch: EngineDispatch = (command, payload): CommandResponse => {
    commandLog.push([command, payload]);
    switch (command) {
      case 'pin_frame_rate':
        pinnedHz = (payload as { hz: number }).hz;
        return { success: true };
      case 'unpin_frame_rate':
        pinnedHz = null;
        return { success: true };
      case 'pause':
        paused = true;
        return { success: true };
      case 'resume':
        paused = false;
        return { success: true };
      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  };

  const snapshot = (): PlayTickSnapshot => {
    const entities: PlayTickSnapshot['entities'] = { [PLAYER]: { position: [playerX, 0, 0] } };
    if (coinPresent) entities[COIN] = { position: [1, 0, 0] };
    return {
      entities,
      inputState: {
        pressed: { move_right: held.has('KeyD') },
        axes: { move_right: held.has('KeyD') ? 1 : 0 },
      },
      elapsedMs: frames * 16,
    };
  };

  /** Publish frames until `done` resolves; one macrotask per frame. */
  const drive = async <T,>(done: Promise<T>): Promise<T> => {
    let settled = false;
    const tracked = done.then(
      (v) => {
        settled = true;
        return v;
      },
      (e: unknown) => {
        settled = true;
        throw e;
      },
    );
    while (!settled) {
      await new Promise<void>((r) => setImmediate(r));
      if (!paused) {
        if (held.has('KeyD')) playerX += 0.05;
        if (coinPresent && playerX >= 1) coinPresent = false;
      }
      frames += 1;
      publishPlayTick(snapshot());
    }
    return tracked;
  };

  return {
    dispatch,
    drive,
    commandLog,
    keyLog,
    getPinnedHz: () => pinnedHz,
    isPaused: () => paused,
  };
}

beforeEach(() => {
  storeState.engineMode = 'play';
  storeState.inputBindings = [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ];
});

afterEach(() => {
  document.body.replaceChildren();
  resetPlayTickBus();
  dispatcherSlot.current = null;
});

async function runManual(engine: ReturnType<typeof makeSimulatedEngine>, trace: InputTrace) {
  dispatcherSlot.current = engine.dispatch;
  const session = startReplaySession('manual', {
    trace,
    playerEntityId: PLAYER,
    collectibleEntityIds: [COIN],
  });
  const result = await engine.drive(session.handle.result);
  if (result.status !== 'completed') throw new Error(`manual run ended ${result.status}`);
  return { source: session.source, command: session.command, outcome: result.outcome };
}

async function runAi(engine: ReturnType<typeof makeSimulatedEngine>, trace: InputTrace) {
  const ctx = {
    store: storeState as unknown as Parameters<(typeof playtestHandlers)['replay_input_trace']>[1]['store'],
    dispatchCommand: engine.dispatch as unknown as (command: string, payload: unknown) => void,
  };
  const result = await engine.drive(
    playtestHandlers.replay_input_trace(
      { trace, playerEntityId: PLAYER, collectibleEntityIds: [COIN] },
      ctx,
    ),
  );
  if (!result.success) throw new Error(`ai run failed: ${result.error}`);
  return result.result as { command: string; source: string; strategy: null; outcome: ReplayOutcome };
}

describe('manual and AI invocations are the same replay on the engine wire', () => {
  it('issue identical engine commands, identical key events and identical outcomes for the same trace', async () => {
    const manualEngine = makeSimulatedEngine();
    const manual = await runManual(manualEngine, holdRightTrace());
    document.body.replaceChildren();
    resetPlayTickBus();

    const aiEngine = makeSimulatedEngine();
    const ai = await runAi(aiEngine, holdRightTrace());

    // Source is the ONLY difference.
    expect(manual.source).toBe('manual');
    expect(ai.source).toBe('ai');
    expect(manual.command).toBe('replay_input_trace');
    expect(ai.command).toBe('replay_input_trace');

    // The engine saw the same thing from both.
    expect(aiEngine.commandLog).toEqual(manualEngine.commandLog);
    expect(manualEngine.commandLog[0]).toEqual(['pin_frame_rate', { hz: 60 }]);
    expect(manualEngine.commandLog[manualEngine.commandLog.length - 1]).toEqual(['unpin_frame_rate', {}]);
    expect(aiEngine.keyLog).toEqual(manualEngine.keyLog);
    expect(manualEngine.keyLog).toEqual(['down KeyD', 'up KeyD']);

    // And both observed the same runtime.
    expect(ai.outcome).toEqual(manual.outcome);
    expect(manual.outcome.verdict).toBe('passed');
    expect(manual.outcome.pinned).toBe(true);
    expect(manual.outcome.pinHz).toBe(60);
    expect(manual.outcome.ticksReplayed).toBe(TICKS);
    expect(manual.outcome.collectiblesCollected).toBe(1);
    expect(manual.outcome.assertions.map((a) => [a.operationId, a.passed])).toEqual([
      ['qa.FR-1.OP-01', true],
      ['qa.FR-1.OP-03', true],
    ]);
    // The clock was returned to the wall clock by both.
    expect(manualEngine.getPinnedHz()).toBeNull();
    expect(aiEngine.getPinnedHz()).toBeNull();
  });

  it('fail identically on dead input (the binding removed while the scene still has a player and a coin)', async () => {
    storeState.inputBindings = [];

    const manualEngine = makeSimulatedEngine();
    const manual = await runManual(manualEngine, holdRightTrace());
    document.body.replaceChildren();
    resetPlayTickBus();

    const aiEngine = makeSimulatedEngine();
    const ai = await runAi(aiEngine, holdRightTrace());

    expect(ai.outcome).toEqual(manual.outcome);
    expect(manual.outcome.verdict).toBe('failed');
    expect(manual.outcome.movedDistance).toBe(0);
    expect(manual.outcome.collectiblesCollected).toBe(0);
    expect(manual.outcome.pinned).toBe(true);
    // Both assertions fail on their own, on both paths — not just the verdict
    // they are AND-ed into.
    expect(manual.outcome.assertions.map((a) => [a.operationId, a.passed])).toEqual([
      ['qa.FR-1.OP-01', false],
      ['qa.FR-1.OP-03', false],
    ]);
    expect(manualEngine.keyLog).toEqual([]);
    expect(aiEngine.keyLog).toEqual([]);
    expect(aiEngine.commandLog).toEqual(manualEngine.commandLog);
  });

  it('refuse an invalid trace with the same text from both entry points, before any engine command', async () => {
    const broken = { ...holdRightTrace(), frames: [{ tick: 3, actions: {} }, { tick: 1, actions: {} }] };
    const engine = makeSimulatedEngine();
    dispatcherSlot.current = engine.dispatch;

    let manualError = '';
    try {
      startReplaySession('manual', { trace: broken, playerEntityId: PLAYER, collectibleEntityIds: [COIN] });
    } catch (e) {
      manualError = e instanceof Error ? e.message : String(e);
    }
    const ai = await playtestHandlers.replay_input_trace(
      { trace: broken, playerEntityId: PLAYER, collectibleEntityIds: [COIN] },
      {
        store: storeState as unknown as Parameters<(typeof playtestHandlers)['replay_input_trace']>[1]['store'],
        dispatchCommand: engine.dispatch as unknown as (command: string, payload: unknown) => void,
      },
    );

    expect(manualError).toMatch(/^Invalid input trace: /);
    expect(ai).toEqual({ success: false, error: manualError });
    expect(engine.commandLog).toEqual([]);
    expect(engine.keyLog).toEqual([]);
  });
});
