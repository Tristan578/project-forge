/**
 * #10007 — the runner watches the editor's engine mode (Sentry finding on
 * PR #10369, `replayEntryPoints.ts` ~225).
 *
 * The runner owns the runtime during a replay: it pins the clock, injects
 * keys per engine tick, and its own Pause moves the engine to 'paused'. The
 * only observer of the editor's mode used to be the entry point, which
 * cancelled on 'edit' alone. Two real defects followed:
 *   (A) runner paused at a boundary, engine paused BY THE RUNNER; the creator
 *       presses Resume in the editor toolbar: the game runs again on the
 *       pinned clock with no replay input while the runner stays 'paused',
 *       and the replay's own Resume later continues the trace into a world
 *       that has moved on — a deterministic verdict, silently wrong;
 *   (B) runner running; the creator presses Pause in the toolbar: ticks stop,
 *       the boundary's 2 s stalled-tick timeout fires, and the replay FAILS
 *       with "no engine play tick received" for a deliberate pause.
 * The runner now subscribes to the mode through `ReplayEnvironment.subscribeEngineMode`
 * and cancels, with a reason, on a change it did not make. These tests drive
 * a fake engine whose pause/resume report the mode back synchronously or a
 * microtask later, and a toolbar that changes the mode behind the runner's
 * back.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  outcomeOf,
  replayInputTrace,
  startReplay,
  ReplayCancelledError,
  type ReplayEnvironment,
  type ReplayHandle,
  type ReplayObservation,
  type ReplayProgress,
  type ReplayRunResult,
  type ReplayRunState,
} from '../replayRunner';
import { replayCancelReasonClause } from '../replayCancelReason';
import { INPUT_TRACE_VERSION, type InputTrace } from '../inputTrace';

const PLAYER = 'player-1';
const COLLECTIBLE = 'coin-1';
const TICKS = 120;

function moveRightTrace(ticks: number = TICKS): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'minimal-2d-replay',
    actionNames: ['move_right'],
    durationMs: ticks * 16,
    frames: Array.from({ length: ticks }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true, axis: 1 } },
    })),
  };
}

type Listener = (mode: string) => void;

/**
 * The controller test's deterministic fake runtime, extended with the editor
 * side: a mode emitter the runner subscribes to, a record of every pause and
 * resume the RUNNER dispatched, and a toolbar that pauses, resumes or stops
 * the game behind the runner's back. `modeDelivery` says how the engine
 * reports the mode its OWN pause/resume produce: not at all (the controller
 * test's fake), inside the dispatch (the panel test's store, the worst case
 * for the ordering), or a microtask later (closer to the real engine, which
 * answers one frame on).
 */
function makeFakeEngine(
  options: { acceptPin?: boolean; manualFrames?: boolean; modeDelivery?: 'none' | 'sync' | 'async' } = {},
) {
  const acceptPin = options.acceptPin ?? true;
  const manualFrames = options.manualFrames ?? false;
  const modeDelivery = options.modeDelivery ?? 'none';
  const pendingFrames: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const held = new Set<string>();
  let playerX = 0;
  let collectiblePresent = true;
  let runtimePaused = false;
  let pauseCalls = 0;
  let resumeCalls = 0;
  const log: string[] = [];
  const releaseLog: string[][] = [];

  const listeners = new Set<Listener>();
  /** Every listener ever subscribed, so a test can call one after the runner let go of it. */
  const captured: Listener[] = [];
  /** Modes that reached at least one listener. */
  const delivered: string[] = [];
  const emit = (mode: string) => {
    if (listeners.size > 0) delivered.push(mode);
    for (const listener of [...listeners]) listener(mode);
  };
  const deliverOwn = (mode: string) => {
    if (modeDelivery === 'sync') emit(mode);
    if (modeDelivery === 'async') queueMicrotask(() => emit(mode));
  };

  const snapshot = (): ReplayObservation => {
    const entities: ReplayObservation['entities'] = { [PLAYER]: { position: [playerX, 0, 0] } };
    if (collectiblePresent) entities[COLLECTIBLE] = { position: [1, 0, 0] };
    const moving = held.has('KeyD');
    return { entities, input: { pressed: { move_right: moving }, axes: { move_right: moving ? 1 : 0 } } };
  };

  const env: ReplayEnvironment = {
    resolveKeys: (actionName) => (actionName === 'move_right' ? ['KeyD'] : []),
    pressKeys: (codes) => {
      log.push(`press ${codes.join('+')}`);
      for (const c of codes) held.add(c);
    },
    releaseKeys: (codes) => {
      releaseLog.push(codes);
      log.push(`release ${codes.join('+')}`);
      for (const c of codes) held.delete(c);
    },
    advanceFrame: async () => {
      if (manualFrames) {
        await new Promise<void>((resolve, reject) => {
          pendingFrames.push({ resolve, reject });
        });
      }
      if (runtimePaused) return;
      if (held.has('KeyD')) playerX += 0.05;
      if (collectiblePresent && playerX >= 1) collectiblePresent = false;
    },
    observe: snapshot,
    playerEntityId: PLAYER,
    collectibleEntityIds: [COLLECTIBLE],
    pinFrameRate: (hz) => {
      log.push(`pin ${hz}`);
      return acceptPin;
    },
    unpinFrameRate: () => {
      log.push('unpin');
    },
    pauseRuntime: () => {
      pauseCalls += 1;
      runtimePaused = true;
      log.push('runtime pause');
      deliverOwn('paused');
    },
    resumeRuntime: () => {
      resumeCalls += 1;
      runtimePaused = false;
      log.push('runtime resume');
      deliverOwn('play');
    },
    subscribeEngineMode: (listener) => {
      log.push('watch engine mode');
      listeners.add(listener);
      captured.push(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const step = async () => {
    const pending = pendingFrames.shift();
    if (!pending) throw new Error('no frame is pending');
    pending.resolve();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  const fail = async (error: Error) => {
    const pending = pendingFrames.shift();
    if (!pending) throw new Error('no frame is pending');
    pending.reject(error);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  /** The editor toolbar: the engine's mode changes without the runner asking. */
  const toolbar = {
    pause: () => {
      runtimePaused = true;
      emit('paused');
    },
    resume: () => {
      runtimePaused = false;
      emit('play');
    },
    stop: () => {
      runtimePaused = false;
      emit('edit');
    },
  };

  return {
    env,
    log,
    releaseLog,
    step,
    fail,
    toolbar,
    emit,
    captured,
    delivered,
    listenerCount: () => listeners.size,
    pendingFrameCount: () => pendingFrames.length,
    pauseCalls: () => pauseCalls,
    resumeCalls: () => resumeCalls,
    isHeld: (code: string) => held.has(code),
    isRuntimePaused: () => runtimePaused,
  };
}

/** Resolve once the handle reports `state`; reject if the run ends first. */
function waitForState(handle: ReplayHandle, state: ReplayRunState): Promise<ReplayProgress> {
  return new Promise((resolve, reject) => {
    const current = handle.getProgress();
    if (current.state === state) {
      resolve(current);
      return;
    }
    const unsubscribe = handle.subscribe((progress) => {
      if (progress.state === state) {
        unsubscribe();
        resolve(progress);
      } else if (progress.state === 'completed' || progress.state === 'cancelled' || progress.state === 'failed') {
        unsubscribe();
        reject(new Error(`run ended in ${progress.state} before reaching ${state}`));
      }
    });
  });
}

/** The run's result, or a named failure within `ms` — a stuck run must not fail only at the test timeout. */
async function settlesWithin(handle: ReplayHandle, ms = 1500): Promise<ReplayRunResult> {
  const holder: { value: ReplayRunResult | null } = { value: null };
  void handle.result.then((result) => {
    holder.value = result;
  });
  await vi.waitFor(
    () => {
      if (!holder.value) throw new Error(`result still unsettled after ${ms} ms (state ${handle.getProgress().state})`);
    },
    { timeout: ms, interval: 10 },
  );
  return holder.value as ReplayRunResult;
}

/** Start on manual frames, see the warm-up frame through, and replay `ticks` ticks by hand. */
async function runningAfter(engine: ReturnType<typeof makeFakeEngine>, handle: ReplayHandle, ticks: number) {
  await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
  await engine.step(); // the pin's warm-up frame
  await waitForState(handle, 'running');
  for (let i = 0; i < ticks; i += 1) await engine.step();
  expect(handle.getProgress().tick).toBe(ticks);
}

describe('the runner watches the editor engine mode (#10007)', () => {
  it("(a) toolbar Resume while the runner had paused the game: cancelled with 'engine-resumed', no resume dispatched, unpinned, no held keys", async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 5 });
    await waitForState(handle, 'paused');
    expect(engine.isRuntimePaused()).toBe(true);
    expect(engine.pauseCalls()).toBe(1);
    expect(engine.isHeld('KeyD')).toBe(false);

    // Scenario (A): the creator resumes the game from the toolbar, not from
    // the replay. The engine runs on with no replay input; the trace cannot
    // be continued from here.
    engine.toolbar.resume();
    expect(handle.getProgress().state).toBe('cancelling');
    const result = await settlesWithin(handle);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 5, reason: 'engine-resumed' });
    expect(handle.getProgress().state).toBe('cancelled');
    expect(engine.resumeCalls(), 'the game is already running: the runner must not resume it again').toBe(0);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(handle.getProgress().heldKeys).toEqual([]);
    expect(engine.isRuntimePaused()).toBe(false);
    expect(engine.listenerCount(), 'the watch is removed with the run').toBe(0);
  });

  it("(b) toolbar Pause while running: cancelled with 'engine-paused' at once, the game left paused, keys released, unpinned — the frame in flight is abandoned, not timed out", async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(), engine.env);
    await runningAfter(engine, handle, 3);
    expect(engine.isHeld('KeyD')).toBe(true);
    expect(engine.pendingFrameCount(), "tick 3's frame is in flight").toBe(1);

    // Scenario (B): the creator pauses from the toolbar. A paused engine
    // publishes no tick, so NO step() follows: the run must settle on its
    // own. The boundary's stalled-tick timeout is 2 s away and would report
    // a failure ("no engine play tick received"), not this cancellation.
    engine.toolbar.pause();
    expect(handle.getProgress().state).toBe('cancelling');
    const result = await settlesWithin(handle, 500);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 3, reason: 'engine-paused' });
    expect(engine.pendingFrameCount(), 'the awaited frame was abandoned, never completed').toBe(1);
    expect(engine.pauseCalls(), 'the runner never paused the runtime itself').toBe(0);
    expect(engine.resumeCalls(), "the creator's pause stands: nothing resumes the game").toBe(0);
    expect(engine.isRuntimePaused()).toBe(true);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.releaseLog).toEqual([['KeyD']]);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(handle.getProgress().state).toBe('cancelled');
    expect(engine.listenerCount()).toBe(0);
  });

  it.each(['sync', 'async'] as const)(
    "(c) the runner's own pause and resume never cancel — the engine reports 'paused' and 'play' back %s",
    async (modeDelivery) => {
      const engine = makeFakeEngine({ modeDelivery });
      const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 5 });
      const paused = await waitForState(handle, 'paused');
      expect(paused.tick).toBe(5);
      // The delivery reached the watch — the case is not vacuous — and was
      // recognised as the runner's own.
      expect(engine.delivered).toEqual(['paused']);
      expect(handle.getProgress().state).toBe('paused');

      expect(handle.resume()).toBe(true);
      const result = await settlesWithin(handle);
      expect(engine.delivered).toEqual(['paused', 'play']);
      expect(result.status).toBe('completed');
      if (result.status !== 'completed') return;
      expect(result.outcome.verdict).toBe('passed');
      expect(result.outcome.ticksReplayed).toBe(TICKS);
      expect(engine.pauseCalls()).toBe(1);
      expect(engine.resumeCalls()).toBe(1);
      expect(engine.log[engine.log.length - 1]).toBe('unpin');
      expect(engine.listenerCount()).toBe(0);
    },
  );

  it("(d) Stop: cancelled with 'engine-stopped', keys released, unpinned", async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(), engine.env);
    await runningAfter(engine, handle, 2);
    expect(engine.isHeld('KeyD')).toBe(true);

    engine.toolbar.stop();
    const result = await settlesWithin(handle, 500);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 2, reason: 'engine-stopped' });
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(engine.listenerCount()).toBe(0);
  });

  describe('(e) the watch is subscribed before the pin and removed on every exit path', () => {
    it('completed', async () => {
      const engine = makeFakeEngine();
      const handle = startReplay(moveRightTrace(), engine.env);
      expect(engine.listenerCount(), 'subscribed synchronously, inside startReplay').toBe(1);
      expect(engine.log.indexOf('watch engine mode')).toBeLessThan(engine.log.indexOf('pin 60'));
      const result = await handle.result;
      expect(result.status).toBe('completed');
      expect(engine.listenerCount()).toBe(0);
    });

    it("cancelled through the handle (the creator's own Cancel)", async () => {
      const engine = makeFakeEngine({ manualFrames: true });
      const handle = startReplay(moveRightTrace(), engine.env);
      await runningAfter(engine, handle, 1);
      expect(engine.listenerCount()).toBe(1);
      expect(handle.cancel()).toBe(true);
      const result = await settlesWithin(handle, 500);
      expect(result.status).toBe('cancelled');
      expect(engine.listenerCount()).toBe(0);
    });

    it('failed (the boundary stalled mid-run)', async () => {
      const engine = makeFakeEngine({ manualFrames: true });
      const handle = startReplay(moveRightTrace(), engine.env);
      await runningAfter(engine, handle, 1);
      expect(engine.listenerCount()).toBe(1);
      await engine.fail(new Error('Replay stopped: no engine play tick received.'));
      const result = await settlesWithin(handle);
      expect(result.status).toBe('failed');
      expect(engine.listenerCount()).toBe(0);
    });

    it('failed before the first tick (the engine refused the pin)', async () => {
      const engine = makeFakeEngine({ acceptPin: false });
      const handle = startReplay(moveRightTrace(), engine.env);
      expect(engine.listenerCount(), 'subscribed before the pin was even asked for').toBe(1);
      const result = await handle.result;
      expect(result.status).toBe('failed');
      if (result.status !== 'failed') return;
      expect(result.error.message).toMatch(/pin_frame_rate/);
      expect(engine.listenerCount()).toBe(0);
    });
  });

  describe('(f) a mode the watch has no rule for, or that arrives too late, changes nothing', () => {
    it('a mode delivered after the run is terminal is ignored: no throw, no state change', async () => {
      const engine = makeFakeEngine();
      const handle = startReplay(moveRightTrace(), engine.env);
      const result = await handle.result;
      expect(result.status).toBe('completed');
      const [listener] = engine.captured;
      expect(listener).toBeDefined();
      // A store that still held the listener says the editor stopped.
      expect(() => listener?.('edit')).not.toThrow();
      expect(() => listener?.('paused')).not.toThrow();
      expect(handle.getProgress().state).toBe('completed');
      expect(handle.cancel(), 'nothing left to cancel').toBe(false);
    });

    it("a mode delivered while the creator's own cancel is settling does not give it a reason", async () => {
      const engine = makeFakeEngine({ manualFrames: true });
      const handle = startReplay(moveRightTrace(), engine.env);
      await runningAfter(engine, handle, 2);
      expect(handle.cancel()).toBe(true);
      expect(handle.getProgress().state).toBe('cancelling');
      engine.toolbar.stop();
      const result = await settlesWithin(handle, 500);
      expect(result).toEqual({ status: 'cancelled', ticksReplayed: 2 });
      expect(result).not.toHaveProperty('reason');
    });

    it("a 'play' while the runner is running is not a resume it missed: the run completes", async () => {
      const engine = makeFakeEngine({ manualFrames: true });
      const handle = startReplay(moveRightTrace(4), engine.env);
      await runningAfter(engine, handle, 1);
      engine.emit('play');
      expect(handle.getProgress().state).toBe('running');
      for (let i = 0; i < 5; i += 1) await engine.step(); // ticks 1..3 and the two settle frames
      const result = await settlesWithin(handle);
      expect(result.status).toBe('completed');
      expect(engine.delivered).toEqual(['play']);
    });
  });

  it("the creator's own cancel carries no reason; a runner's cancel is reported with its reason, in words", async () => {
    const own = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), own.env, { pauseAtTick: 2 });
    await waitForState(handle, 'paused');
    expect(handle.cancel()).toBe(true);
    const result = await settlesWithin(handle);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 2 });
    expect(result).not.toHaveProperty('reason');
    expect(() => outcomeOf(result)).toThrow('Replay cancelled after 2 ticks; no outcome was produced.');

    // The uncontrolled form (`replayInputTrace`, what the chat tool's entry
    // point awaits, is `outcomeOf(await startReplay(...).result)`) throws the
    // reason and says it in the creator's words — the same clause the panel
    // shows. Driven through the handle so a run that never ends fails here,
    // named, rather than at the test timeout.
    const resumed = makeFakeEngine();
    const resumedHandle = startReplay(moveRightTrace(), resumed.env, { pauseAtTick: 2 });
    await waitForState(resumedHandle, 'paused');
    resumed.toolbar.resume();
    const resumedResult = await settlesWithin(resumedHandle);
    expect(resumedResult).toEqual({ status: 'cancelled', ticksReplayed: 2, reason: 'engine-resumed' });
    let thrown: unknown = null;
    try {
      outcomeOf(resumedResult);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReplayCancelledError);
    const cancelled = thrown as ReplayCancelledError;
    expect(cancelled.reason).toBe('engine-resumed');
    expect(cancelled.ticksReplayed).toBe(2);
    expect(cancelled.message).toBe(
      'Replay cancelled after 2 ticks because the game was resumed from the toolbar while the replay was paused; no outcome was produced.',
    );

    // And `replayInputTrace` itself surfaces that same error (its one job).
    const stopped = makeFakeEngine({ manualFrames: true });
    const promise = replayInputTrace(moveRightTrace(), stopped.env, {
      onHandle: (h) => {
        void waitForState(h, 'running').then(() => stopped.toolbar.stop());
      },
    });
    await vi.waitFor(() => expect(stopped.log).toContain('pin 60'));
    await stopped.step(); // the warm-up frame; 'running' follows and Stop lands
    const error: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ReplayCancelledError);
    expect((error as ReplayCancelledError).reason).toBe('engine-stopped');
    expect((error as ReplayCancelledError).message).toBe(
      'Replay cancelled after 0 ticks because Play was stopped; no outcome was produced.',
    );
  });
});

describe('replayCancelReasonClause', () => {
  it('says why, in the creator\'s words, and says nothing for the creator\'s own Cancel', () => {
    expect(replayCancelReasonClause('engine-stopped')).toBe(' because Play was stopped');
    expect(replayCancelReasonClause('engine-paused')).toBe(' because the game was paused from the toolbar');
    expect(replayCancelReasonClause('engine-resumed')).toBe(
      ' because the game was resumed from the toolbar while the replay was paused',
    );
    expect(replayCancelReasonClause(undefined)).toBe('');
  });
});
