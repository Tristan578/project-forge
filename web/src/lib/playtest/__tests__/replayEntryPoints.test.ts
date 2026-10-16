// @vitest-environment jsdom
/**
 * #10007 — one replay at a time, whichever entry point asks (review-board MAJOR 3 / m1).
 *
 * The clock pin is engine-global and every run unpins on its own exit, so two
 * overlapping runs would have the first's unpin (and key release) land in the
 * middle of the second, which then finishes on the wall clock while still
 * reporting `pinned: true`. `replayEntryPoints` therefore holds ONE
 * module-level single-flight guard shared by the manual panel, the E2E hooks
 * and the AI tool, and ONE engine-mode watch that cancels the active run when
 * the editor leaves Play for Edit — so a bot or chat replay is cancelled by
 * Stop exactly as a manual one is.
 *
 * Driven against the REAL browser boundary (DOM key events on the editor canvas `#game-canvas`,
 * the play-tick bus, a recording engine dispatcher), as the parity test is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@/hooks/useEngine';
import { EDITOR_CANVAS_ID } from '@/lib/engine/canvasId';
import { publishPlayTick, resetPlayTickBus, type PlayTickSnapshot } from '../playTickBus';
import { INPUT_TRACE_VERSION, type InputTrace } from '../inputTrace';
import type { EngineDispatch } from '../replayInvocation';
import { ReplayCancelledError } from '../replayRunner';

const storeState = vi.hoisted(() => ({
  engineMode: 'play' as string,
  inputBindings: [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ] as Array<Record<string, unknown>>,
  allGameComponents: { coin: [{ type: 'collectible' }] } as Record<string, Array<{ type: string }>>,
}));
const storeSubscribers = vi.hoisted(() => new Set<(state: { engineMode: string }, prev: { engineMode: string }) => void>());

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(() => storeState, {
    getState: () => storeState,
    subscribe: (listener: (state: { engineMode: string }, prev: { engineMode: string }) => void) => {
      storeSubscribers.add(listener);
      return () => {
        storeSubscribers.delete(listener);
      };
    },
  }),
  getCommandDispatcher: () => null,
}));

import {
  ReplayBusyError,
  cancelActiveReplay,
  getActiveReplaySession,
  runReplay,
  startReplaySession,
  subscribeActiveReplaySession,
} from '../replayEntryPoints';

const PLAYER = 'player';
const COIN = 'coin';
const TICKS = 12;

function holdRightTrace(): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'guard-fixture',
    actionNames: ['move_right'],
    durationMs: TICKS * 16,
    frames: Array.from({ length: TICKS }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true, axis: 1 } },
    })),
  };
}

/** What the store does when the engine reports a mode: notify subscribers with (state, prev). */
function engineModeBecomes(mode: string) {
  const prev = { ...storeState };
  storeState.engineMode = mode;
  for (const listener of storeSubscribers) listener(storeState, prev);
}

/** A simulated engine behind the real boundary, frames published by hand. */
function makeEngine(options: { acceptPin?: boolean } = {}) {
  const acceptPin = options.acceptPin ?? true;
  const canvas = document.createElement('canvas');
  canvas.id = EDITOR_CANVAS_ID;
  document.body.append(canvas);
  const commandLog: string[] = [];
  const keyLog: string[] = [];
  const held = new Set<string>();
  let x = 0;
  let coin = true;
  let frames = 0;
  canvas.addEventListener('keydown', (e) => {
    keyLog.push(`down ${e.code}`);
    held.add(e.code);
  });
  canvas.addEventListener('keyup', (e) => {
    keyLog.push(`up ${e.code}`);
    held.delete(e.code);
  });
  const dispatch: EngineDispatch = (command): CommandResponse => {
    commandLog.push(command);
    if (command === 'pin_frame_rate') return { success: acceptPin, error: acceptPin ? undefined : 'refused' };
    return { success: true };
  };
  const snapshot = (): PlayTickSnapshot => {
    const entities: PlayTickSnapshot['entities'] = { [PLAYER]: { position: [x, 0, 0] } };
    if (coin) entities[COIN] = { position: [0.3, 0, 0] };
    return {
      entities,
      inputState: { pressed: { move_right: held.has('KeyD') }, axes: { move_right: held.has('KeyD') ? 1 : 0 } },
      elapsedMs: frames * 16,
    };
  };
  /** One engine frame: let the runner subscribe, publish, let it continue. */
  const frame = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    if (held.has('KeyD')) x += 0.05;
    if (coin && x >= 0.3) coin = false;
    frames += 1;
    publishPlayTick(snapshot());
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  /** Publish frames until `done` settles. */
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
    while (!settled) await frame();
    return tracked;
  };
  return { dispatch, commandLog, keyLog, frame, drive, isHeld: (code: string) => held.has(code) };
}

const request = { playerEntityId: PLAYER, collectibleEntityIds: [COIN] };

beforeEach(() => {
  storeState.engineMode = 'play';
  storeSubscribers.clear();
});

afterEach(async () => {
  // Never leave a run active across tests: the guard is module state.
  const active = getActiveReplaySession();
  if (active) {
    active.handle.cancel();
    await active.handle.result;
  }
  document.body.replaceChildren();
  resetPlayTickBus();
});

describe('one replay at a time (single-flight guard)', () => {
  it('refuses a second start while one is active — before it pins or touches a key — and leaves the first run alone', async () => {
    const engine = makeEngine();
    const first = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    expect(getActiveReplaySession()).toBe(first);
    await engine.frame(); // the pin's warm-up frame
    await engine.frame(); // tick 0: KeyD down
    expect(engine.isHeld('KeyD')).toBe(true);
    const commandsBefore = [...engine.commandLog];
    const keysBefore = [...engine.keyLog];

    // The AI tool's entry point, the E2E hook's and the panel's all go through here.
    expect(() =>
      startReplaySession('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch }),
    ).toThrow(ReplayBusyError);
    await expect(
      runReplay('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch }),
    ).rejects.toThrow(/already running.*manual/);

    // A refused start pinned nothing, pressed nothing, released nothing.
    expect(engine.commandLog).toEqual(commandsBefore);
    expect(engine.keyLog).toEqual(keysBefore);
    expect(engine.commandLog.filter((c) => c === 'pin_frame_rate')).toHaveLength(1);
    expect(engine.commandLog).not.toContain('unpin_frame_rate');
    expect(getActiveReplaySession()).toBe(first);

    // And the first run finishes exactly as if nothing had happened.
    const result = await engine.drive(first.handle.result);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome.pinned).toBe(true);
    expect(result.outcome.ticksReplayed).toBe(TICKS);
    expect(engine.commandLog.filter((c) => c === 'unpin_frame_rate')).toHaveLength(1);
    expect(engine.commandLog[engine.commandLog.length - 1]).toBe('unpin_frame_rate');
  });

  it('releases the guard when a run completes, and a new run may start', async () => {
    const engine = makeEngine();
    const first = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    await engine.drive(first.handle.result);
    expect(getActiveReplaySession()).toBeNull();

    const second = startReplaySession('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    expect(getActiveReplaySession()).toBe(second);
    const result = await engine.drive(second.handle.result);
    expect(result.status).toBe('completed');
    expect(engine.commandLog.filter((c) => c === 'pin_frame_rate')).toHaveLength(2);
    expect(engine.commandLog.filter((c) => c === 'unpin_frame_rate')).toHaveLength(2);
  });

  it('releases the guard when a run is cancelled', async () => {
    const engine = makeEngine();
    const first = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    await engine.frame();
    await engine.frame();
    expect(cancelActiveReplay()).toBe(true);
    const result = await first.handle.result;
    expect(result.status).toBe('cancelled');
    expect(getActiveReplaySession()).toBeNull();
    expect(cancelActiveReplay(), 'nothing active to cancel').toBe(false);
    expect(() =>
      startReplaySession('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch }),
    ).not.toThrow();
  });

  it('releases the guard when a run fails (the engine refused the pin)', async () => {
    const engine = makeEngine({ acceptPin: false });
    const first = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    const result = await first.handle.result;
    expect(result.status).toBe('failed');
    expect(getActiveReplaySession()).toBeNull();
  });

  it('an invalid trace is refused without taking the guard', () => {
    const engine = makeEngine();
    const broken = { ...holdRightTrace(), frames: [{ tick: 1, actions: {} }, { tick: 1, actions: {} }] };
    expect(() => startReplaySession('manual', { trace: broken, ...request }, {}, { dispatch: engine.dispatch })).toThrow(
      /^Invalid input trace: /,
    );
    expect(getActiveReplaySession()).toBeNull();
  });

  it('tells subscribers when a run becomes active and when the guard is released', async () => {
    const engine = makeEngine();
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeActiveReplaySession((session) => seen.push(session ? session.source : null));
    const first = startReplaySession('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    expect(seen).toEqual(['ai']);
    await engine.drive(first.handle.result);
    expect(seen).toEqual(['ai', null]);
    unsubscribe();
    startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    expect(seen, 'unsubscribed listeners hear nothing more').toEqual(['ai', null]);
  });
});

describe('leaving Play mode cancels the active run, whichever entry point started it', () => {
  it("cancels an AI-started run on the store's play -> edit transition: input released, clock unpinned, no verdict", async () => {
    const engine = makeEngine();
    const outcome = runReplay('ai', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    const rejection = expect(outcome).rejects.toBeInstanceOf(ReplayCancelledError);
    await engine.frame();
    await engine.frame();
    expect(engine.isHeld('KeyD')).toBe(true);
    expect(storeSubscribers.size, 'the active run watches the engine mode').toBe(1);

    // The runner's own pause moves the engine to 'paused'; that is not Stop.
    engineModeBecomes('paused');
    expect(getActiveReplaySession()).not.toBeNull();
    engineModeBecomes('play');

    // Stop.
    engineModeBecomes('edit');
    await rejection;
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.keyLog).toEqual(['down KeyD', 'up KeyD']);
    expect(engine.commandLog).toEqual(['pin_frame_rate', 'unpin_frame_rate']);
    expect(getActiveReplaySession()).toBeNull();
    expect(storeSubscribers.size, 'the watch is removed with the run').toBe(0);
  });

  it('cancels a manual (panel / E2E hook) run the same way', async () => {
    const engine = makeEngine();
    const session = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    await engine.frame();
    engineModeBecomes('edit');
    const result = await session.handle.result;
    expect(result.status).toBe('cancelled');
    expect(engine.commandLog[engine.commandLog.length - 1]).toBe('unpin_frame_rate');
    expect(storeSubscribers.size).toBe(0);
  });

  it('removes its engine-mode watch after a completed run', async () => {
    const engine = makeEngine();
    const session = startReplaySession('manual', { trace: holdRightTrace(), ...request }, {}, { dispatch: engine.dispatch });
    expect(storeSubscribers.size).toBe(1);
    await engine.drive(session.handle.result);
    expect(storeSubscribers.size).toBe(0);
  });
});
