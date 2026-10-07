/**
 * #10007 — replay runner state machine: pause / resume / cancel / restart on a
 * pinned runtime, against a DETERMINISTIC fake engine boundary.
 *
 * The real-engine evidence for the same scenario is
 * `e2e/engine/inputReplay.spec.ts` (Scenario 3). These tests pin the runner's
 * contract that spec relies on:
 *   - the engine clock is pinned BEFORE the first tick and unpinned on every
 *     exit path (completion, cancellation, failure);
 *   - `pauseAtTick` pauses at exactly that tick boundary, releases every
 *     synthetic key, and pauses the runtime; resume re-presses what the trace
 *     holds and the run completes with the full tick count;
 *   - cancellation releases input immediately, leaves the runtime as it found
 *     it, and never reports an outcome;
 *   - a restart from the initial snapshot reproduces an uninterrupted run to
 *     within 0.01 world units, and the collector fires exactly once;
 *   - the issue's own negative: dead input still FAILS the outcome assertion
 *     through the controlled path, so pinning cannot be mistaken for passing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  startReplay,
  replayInputTrace,
  ReplayCancelledError,
  MOVE_EPSILON,
  type ReplayEnvironment,
  type ReplayHandle,
  type ReplayObservation,
  type ReplayProgress,
  type ReplayRunResult,
  type ReplayRunState,
} from '../replayRunner';
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

/**
 * Deterministic fake runtime with the clock and mode hooks the real boundary
 * exposes. A fresh instance IS the initial snapshot: the player at x=0, the
 * collectible present at x=1. Holding KeyD advances +0.05 per frame while the
 * runtime is running; a paused runtime does not advance at all, which is what
 * lets a test prove "cancellation released input" rather than "the engine
 * happened to stop".
 */
function makeFakeEngine(
  options: { bound?: boolean; acceptPin?: boolean; manualFrames?: boolean } = {},
) {
  const bound = options.bound ?? true;
  const acceptPin = options.acceptPin ?? true;
  const manualFrames = options.manualFrames ?? false;
  /** With `manualFrames`, each `advanceFrame` waits here until `step()` lets it through (or `fail()` rejects it). */
  const pendingFrames: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const held = new Set<string>();
  let playerX = 0;
  let collectiblePresent = true;
  let collectedCount = 0;
  let runtimePaused = false;
  const log: string[] = [];
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
    resolveKeys: (actionName) => (bound && actionName === 'move_right' ? ['KeyD'] : []),
    pressKeys: (codes) => {
      pressLog.push(codes);
      log.push(`press ${codes.join('+')}`);
      for (const c of codes) held.add(c);
    },
    releaseKeys: (codes) => {
      releaseLog.push(codes);
      log.push(`release ${codes.join('+')}`);
      for (const c of codes) held.delete(c);
    },
    advanceFrame: async () => {
      // A real engine frame arrives when the engine renders one; a fake that
      // resolves in a microtask finishes a whole trace before a test can act
      // on it, so a test that must act mid-trace drives frames by hand.
      if (manualFrames) {
        await new Promise<void>((resolve, reject) => {
          pendingFrames.push({ resolve, reject });
        });
      }
      if (runtimePaused) return;
      if (held.has('KeyD')) playerX += 0.05;
      if (collectiblePresent && playerX >= 1) {
        collectiblePresent = false;
        collectedCount += 1;
      }
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
      runtimePaused = true;
      log.push('runtime pause');
    },
    resumeRuntime: () => {
      runtimePaused = false;
      log.push('runtime resume');
    },
  };

  /** Let exactly one pending frame through and flush the runner's continuation. */
  const step = async () => {
    const pending = pendingFrames.shift();
    if (!pending) throw new Error('no frame is pending');
    pending.resolve();
    // Several microtask turns: the runner awaits the frame, then its own bookkeeping.
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  /** Reject the pending frame — what the boundary's stalled-tick timeout does. */
  const fail = async (error: Error) => {
    const pending = pendingFrames.shift();
    if (!pending) throw new Error('no frame is pending');
    pending.reject(error);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  return {
    env,
    log,
    pressLog,
    releaseLog,
    step,
    fail,
    getPlayerX: () => playerX,
    getCollected: () => collectedCount,
    isHeld: (code: string) => held.has(code),
    isRuntimePaused: () => runtimePaused,
  };
}

/** Resolve once the handle reports `state` (immediately if it already does). */
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
      } else if (
        progress.state === 'completed' ||
        progress.state === 'cancelled' ||
        progress.state === 'failed'
      ) {
        unsubscribe();
        reject(new Error(`run ended in ${progress.state} before reaching ${state}`));
      }
    });
  });
}

/**
 * Resolve with the run's result, or FAIL within `ms` if it never settles. A
 * plain `await handle.result` on a stuck run only fails at the test timeout,
 * with no message; this names the defect (an unsettled result is exactly the
 * stuck-pause bug the review-board reproduced).
 */
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

/** One macrotask, so a hook that resolves "later" really resolves after the current microtask run. */
function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('startReplay — the clock is pinned before the first tick', () => {
  it('pins at 60 Hz before any input and unpins after the final observation', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env);
    const result = await handle.result;
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome.pinned).toBe(true);
    expect(result.outcome.pinHz).toBe(60);
    expect(engine.log[0]).toBe('pin 60');
    expect(engine.log.indexOf('pin 60')).toBeLessThan(engine.log.indexOf('press KeyD'));
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(result.outcome.verdict).toBe('passed');
    expect(result.outcome.ticksReplayed).toBe(TICKS);
    const byOp = Object.fromEntries(result.outcome.assertions.map((a) => [a.operationId, a.passed]));
    expect(byOp).toEqual({ 'qa.FR-1.OP-01': true, 'qa.FR-1.OP-03': true });
  });

  it('honours an explicit pin rate', async () => {
    const engine = makeFakeEngine();
    const result = await startReplay(moveRightTrace(), engine.env, { pinHz: 30 }).result;
    expect(result.status).toBe('completed');
    expect(engine.log[0]).toBe('pin 30');
    if (result.status === 'completed') expect(result.outcome.pinHz).toBe(30);
  });

  it('refuses to replay when the engine rejects the pin, injecting no input', async () => {
    const engine = makeFakeEngine({ acceptPin: false });
    const result = await startReplay(moveRightTrace(), engine.env).result;
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error.message).toMatch(/pin_frame_rate/);
    expect(result.ticksReplayed).toBe(0);
    expect(engine.pressLog).toEqual([]);
    expect(engine.getPlayerX()).toBe(0);
  });

  it('records pinned=false when the boundary has no clock hooks (unit fakes, older boundaries)', async () => {
    const engine = makeFakeEngine();
    const { pinFrameRate: _pin, unpinFrameRate: _unpin, ...bare } = engine.env;
    const result = await startReplay(moveRightTrace(), bare).result;
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.outcome.pinned).toBe(false);
      expect(result.outcome.pinHz).toBeNull();
    }
    expect(engine.log.some((l) => l.startsWith('pin'))).toBe(false);
  });
});

describe('startReplay — pause at a tick boundary', () => {
  it('pauses at exactly tick 60 with every synthetic key released and the runtime paused', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 60 });
    const paused = await waitForState(handle, 'paused');

    expect(paused.tick).toBe(60);
    expect(paused.heldKeys).toEqual([]);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.isRuntimePaused()).toBe(true);
    expect(engine.log.filter((l) => l === 'runtime pause')).toHaveLength(1);
    // Exactly 60 frames of +0.05 — the boundary is the tick, not "around it".
    expect(engine.getPlayerX()).toBeCloseTo(3.0, 10);
    expect(engine.getCollected()).toBe(1);

    handle.cancel();
    await handle.result;
  });

  it('resume re-presses the held action, resumes the runtime and completes all 120 ticks', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 60 });
    await waitForState(handle, 'paused');

    expect(handle.resume()).toBe(true);
    const result = await handle.result;
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome.ticksReplayed).toBe(TICKS);
    expect(result.outcome.verdict).toBe('passed');
    // Pressed once at tick 0, released at the pause, pressed again on resume.
    expect(engine.pressLog).toEqual([['KeyD'], ['KeyD']]);
    expect(engine.releaseLog).toEqual([['KeyD'], ['KeyD']]);
    expect(engine.log.filter((l) => l === 'runtime resume')).toHaveLength(1);
    expect(engine.isRuntimePaused()).toBe(false);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });

  it('pause() is acknowledged synchronously and takes effect at the next tick boundary', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env);
    const seen: ReplayRunState[] = [];
    handle.subscribe((p) => seen.push(p.state));
    await waitForState(handle, 'running');

    expect(handle.pause()).toBe(true);
    // Acknowledged before pause() returned: the subscriber already saw it.
    expect(seen[seen.length - 1]).toBe('pausing');
    expect(handle.getProgress().state).toBe('pausing');

    const paused = await waitForState(handle, 'paused');
    expect(paused.heldKeys).toEqual([]);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(handle.pause(), 'a second pause while paused is refused').toBe(false);
    handle.cancel();
    await handle.result;
  });

  it('resume() during "pausing" withdraws the pause without releasing input', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env);
    await waitForState(handle, 'running');
    expect(handle.pause()).toBe(true);
    expect(handle.resume()).toBe(true);
    expect(handle.getProgress().state).toBe('running');
    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(engine.log.filter((l) => l === 'runtime pause')).toHaveLength(0);
    expect(engine.pressLog).toEqual([['KeyD']]);
  });

  it('refuses controls that do not apply to the current state', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env);
    expect(handle.resume(), 'resume while not paused').toBe(false);
    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(handle.pause(), 'pause after completion').toBe(false);
    expect(handle.resume(), 'resume after completion').toBe(false);
    expect(handle.cancel(), 'cancel after completion').toBe(false);
  });
});

describe('startReplay — cancellation releases input', () => {
  it('cancel while paused: no outcome, input released, runtime left running, clock unpinned', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 60 });
    await waitForState(handle, 'paused');

    expect(handle.cancel()).toBe(true);
    const result = await handle.result;
    expect(result.status).toBe('cancelled');
    if (result.status !== 'cancelled') return;
    expect(result.ticksReplayed).toBe(60);
    expect(handle.getProgress().state).toBe('cancelled');
    expect(handle.getProgress().heldKeys).toEqual([]);
    expect(engine.isHeld('KeyD')).toBe(false);
    // The runner paused the runtime for its own pause, so cancel resumes it:
    // the creator is left with the game they had, not a frozen one.
    expect(engine.isRuntimePaused()).toBe(false);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    // Nothing is pressed after the cancel.
    const cancelIndex = engine.log.lastIndexOf('runtime resume');
    expect(engine.log.slice(cancelIndex).some((l) => l.startsWith('press'))).toBe(false);
  });

  it('cancel while running: acknowledged as "cancelling", then released within one frame', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(), engine.env);
    // The pin's warm-up frame, then three replayed ticks, driven by hand so the
    // run is genuinely mid-trace with a key held when cancel() lands.
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step();
    await waitForState(handle, 'running');
    for (let i = 0; i < 3; i += 1) await engine.step();
    const ticksBefore = handle.getProgress().tick;
    expect(ticksBefore).toBe(3);
    expect(engine.isHeld('KeyD')).toBe(true);

    expect(handle.cancel()).toBe(true);
    expect(handle.getProgress().state).toBe('cancelling');
    // The frame in flight is allowed to complete afterwards; it must change
    // nothing the runner reports.
    await engine.step();
    const result = await handle.result;
    expect(result.status).toBe('cancelled');
    if (result.status !== 'cancelled') return;
    expect(result.ticksReplayed).toBeLessThan(TICKS);
    expect(result.ticksReplayed).toBeGreaterThanOrEqual(ticksBefore);
    expect(result.ticksReplayed - ticksBefore).toBeLessThanOrEqual(1);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.releaseLog).toEqual([['KeyD']]);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });

  it('cancel while a frame is in flight settles WITHOUT waiting for that frame (a stopped engine never ticks again)', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(), engine.env);
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step();
    await waitForState(handle, 'running');
    for (let i = 0; i < 3; i += 1) await engine.step();
    expect(engine.isHeld('KeyD')).toBe(true);

    // No step() after this point: the frame the runner is awaiting NEVER
    // completes, which is exactly what Stop does to the play-tick stream. The
    // cancel must still release input and settle on its own — otherwise a
    // stopped engine leaves a synthetic key down until the boundary's
    // stalled-tick timeout turns the creator's cancel into a failure.
    expect(handle.cancel()).toBe(true);
    const result = await handle.result;
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 3 });
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.releaseLog).toEqual([['KeyD']]);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(handle.getProgress().state).toBe('cancelled');
  });

  it('cancel during the settle frames still yields no verdict', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(4), engine.env);
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step(); // warm-up
    for (let i = 0; i < 4; i += 1) await engine.step(); // every tick injected
    expect(handle.getProgress().tick).toBe(4);
    expect(handle.getProgress().state).toBe('running');
    // The runner is now in its two settle frames. cancel() said it applied, so
    // the result must be a cancellation, not a verdict reached behind its back.
    expect(handle.cancel()).toBe(true);
    const result = await handle.result;
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 4 });
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });

  it('replayInputTrace surfaces a cancellation as ReplayCancelledError', async () => {
    const engine = makeFakeEngine();
    const promise = replayInputTrace(moveRightTrace(), engine.env, {
      pauseAtTick: 10,
      onHandle: (handle) => {
        void waitForState(handle, 'paused').then(() => handle.cancel());
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ReplayCancelledError);
  });
});

describe('startReplay — a cancel that races the pause (review-board MAJOR 1)', () => {
  it('cancel issued from inside the "paused" notification settles as cancelled, not as a pause that never ends', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 3 });
    const states: ReplayRunState[] = [];
    let secondCancel: boolean | null = null;
    handle.subscribe((p) => {
      states.push(p.state);
      // A UI that cancels the moment it sees 'paused' — the review's reproduction.
      if (p.state === 'paused') {
        expect(handle.cancel()).toBe(true);
        secondCancel = handle.cancel();
      }
    });

    const result = await settlesWithin(handle);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 3 });
    expect(secondCancel, 'a repeat cancel while cancelling does not apply').toBe(false);
    // 'paused' was announced (the cancel came from inside it), then the cancel
    // took over: nothing overwrote 'cancelling' with 'paused' afterwards.
    expect(states.slice(states.indexOf('paused'))).toEqual(['paused', 'cancelling', 'cancelled']);
    expect(handle.getProgress().state).toBe('cancelled');
    expect(handle.getProgress().heldKeys).toEqual([]);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.isRuntimePaused(), 'the runtime the runner paused is running again').toBe(false);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });

  it('cancel landing while pauseRuntime is still in flight settles as cancelled and never announces "paused"', async () => {
    const engine = makeFakeEngine();
    const pauseNow = engine.env.pauseRuntime!;
    let releasePause: (() => void) | null = null;
    // The real boundary's pause is a command round-trip; model it resolving
    // on a LATER macrotask so a cancel can land in the gap.
    engine.env.pauseRuntime = () =>
      new Promise<void>((resolve) => {
        releasePause = () => {
          void pauseNow();
          resolve();
        };
      });
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 3 });
    const states: ReplayRunState[] = [];
    handle.subscribe((p) => states.push(p.state));

    await vi.waitFor(() => expect(releasePause).not.toBeNull());
    expect(handle.getProgress().tick).toBe(3);
    expect(engine.isHeld('KeyD'), 'keys are released before the runtime is asked to pause').toBe(false);

    expect(handle.cancel()).toBe(true);
    expect(handle.getProgress().state).toBe('cancelling');
    await nextMacrotask();
    releasePause!();

    const result = await settlesWithin(handle);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 3 });
    expect(states).not.toContain('paused');
    expect(states[states.length - 1]).toBe('cancelled');
    expect(engine.isRuntimePaused(), 'the pause that landed after the cancel was undone').toBe(false);
    expect(engine.log.filter((l) => l === 'runtime pause')).toHaveLength(1);
    expect(engine.log.filter((l) => l === 'runtime resume')).toHaveLength(1);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(engine.isHeld('KeyD')).toBe(false);
  });

  it('cancel landing while the pause is releasing keys settles as cancelled without pausing the runtime at all', async () => {
    const engine = makeFakeEngine();
    const releaseNow = engine.env.releaseKeys;
    let releaseKeysLater: (() => void) | null = null;
    engine.env.releaseKeys = (codes) =>
      new Promise<void>((resolve) => {
        releaseKeysLater = () => {
          void releaseNow(codes);
          resolve();
        };
      });
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 3 });
    await vi.waitFor(() => expect(releaseKeysLater).not.toBeNull());

    expect(handle.cancel()).toBe(true);
    await nextMacrotask();
    releaseKeysLater!();

    const result = await settlesWithin(handle);
    expect(result).toEqual({ status: 'cancelled', ticksReplayed: 3 });
    expect(engine.log.filter((l) => l === 'runtime pause'), 'no pause after the cancel').toHaveLength(0);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });
});

describe('startReplay — exit paths (review-board m5)', () => {
  it('a boundary failure mid-run, after the pin was accepted, releases keys and unpins before reporting failed', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(), engine.env);
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step(); // warm-up
    await waitForState(handle, 'running');
    for (let i = 0; i < 3; i += 1) await engine.step();
    expect(engine.isHeld('KeyD')).toBe(true);

    // What the browser boundary does when the engine stops ticking.
    await engine.fail(new Error('Replay stopped: no engine play tick received.'));

    const result = await settlesWithin(handle);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error.message).toBe('Replay stopped: no engine play tick received.');
    expect(result.ticksReplayed).toBe(3);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.releaseLog).toEqual([['KeyD']]);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
    expect(handle.getProgress().state).toBe('failed');
    expect(handle.getProgress().heldKeys).toEqual([]);
    expect(handle.cancel(), 'nothing left to cancel').toBe(false);
  });

  it('a refused resume fails the run and still releases the clock', async () => {
    const engine = makeFakeEngine();
    engine.env.resumeRuntime = () => {
      throw new Error('Replay: the engine did not confirm resume: PendingCommands resource not initialized');
    };
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 5 });
    await waitForState(handle, 'paused');
    expect(handle.resume()).toBe(true);

    const result = await settlesWithin(handle);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error.message).toContain('did not confirm resume');
    expect(result.ticksReplayed).toBe(5);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.log.filter((l) => l === 'unpin')).toHaveLength(1);
    expect(handle.getProgress().state).toBe('failed');
  });

  it('a failed unpin after a completed run keeps the outcome and reports the unpin failure separately', async () => {
    const engine = makeFakeEngine();
    engine.env.unpinFrameRate = () => {
      engine.log.push('unpin refused');
      throw new Error('Replay: the engine did not confirm unpin_frame_rate: PendingCommands resource not initialized');
    };
    const handle = startReplay(moveRightTrace(), engine.env);
    const result = await settlesWithin(handle);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome.verdict).toBe('passed');
    expect(result.outcome.ticksReplayed).toBe(TICKS);
    expect(result.outcome.pinned).toBe(true);
    expect(result.unpinError).toContain('unpin_frame_rate');
    expect(handle.getProgress().state).toBe('completed');
    expect(engine.log[engine.log.length - 1]).toBe('unpin refused');
  });

  it('a clean completion carries no unpin error', async () => {
    const engine = makeFakeEngine();
    const result = await startReplay(moveRightTrace(), engine.env).result;
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.unpinError).toBeUndefined();
  });

  it('a pause accepted during the last tick settles at the final boundary, and resume then completes the run', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(4), engine.env);
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step(); // warm-up
    for (let i = 0; i < 3; i += 1) await engine.step(); // ticks 0..2 seen through
    // Tick 3 — the last — is injected and its frame is in flight.
    expect(handle.getProgress().tick).toBe(3);
    expect(engine.isHeld('KeyD')).toBe(true);
    expect(handle.pause()).toBe(true);
    expect(handle.getProgress().state).toBe('pausing');

    await engine.step(); // the last tick's frame
    const paused = await waitForState(handle, 'paused');
    expect(paused.tick).toBe(4);
    expect(paused.heldKeys).toEqual([]);
    expect(engine.isHeld('KeyD')).toBe(false);
    expect(engine.isRuntimePaused()).toBe(true);

    expect(handle.resume()).toBe(true);
    await waitForState(handle, 'running');
    expect(engine.isRuntimePaused()).toBe(false);
    // 'running' is announced before the runner reaches its first settle
    // frame; let that continuation run so a frame is pending to step.
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await engine.step();
    await engine.step(); // the two settle frames
    const result = await settlesWithin(handle);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome.ticksReplayed).toBe(4);
    // No tick follows the final boundary, so nothing is re-pressed on resume.
    expect(engine.pressLog).toEqual([['KeyD']]);
    expect(engine.releaseLog).toEqual([['KeyD']]);
    expect(engine.log[engine.log.length - 1]).toBe('unpin');
  });

  it('pause() is refused once the final boundary has passed (the settle frames), instead of accepted and never settled', async () => {
    const engine = makeFakeEngine({ manualFrames: true });
    const handle = startReplay(moveRightTrace(4), engine.env);
    await vi.waitFor(() => expect(engine.log).toContain('pin 60'));
    await engine.step(); // warm-up
    for (let i = 0; i < 4; i += 1) await engine.step(); // every tick seen through
    expect(handle.getProgress().tick).toBe(4);
    expect(handle.getProgress().state).toBe('running');
    expect(handle.pause()).toBe(false);
    expect(handle.getProgress().state).toBe('running');
    await engine.step();
    await engine.step();
    const result = await settlesWithin(handle);
    expect(result.status).toBe('completed');
  });

  it('pauseAtTick equal to the trace length pauses after the last tick, before the settle frames', async () => {
    const engine = makeFakeEngine();
    const handle = startReplay(moveRightTrace(4), engine.env, { pauseAtTick: 4 });
    const paused = await waitForState(handle, 'paused');
    expect(paused.tick).toBe(4);
    expect(engine.isRuntimePaused()).toBe(true);
    expect(handle.resume()).toBe(true);
    const result = await settlesWithin(handle);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.outcome.ticksReplayed).toBe(4);
  });
});

describe('startReplay — restart from the initial snapshot (Scenario 3, fake runtime)', () => {
  it('pause at 60, cancel, restart: the collector fires once and the end position matches an uninterrupted run within 0.01', async () => {
    // Reference: an uninterrupted replay on a fresh snapshot.
    const reference = makeFakeEngine();
    const ref = await startReplay(moveRightTrace(), reference.env).result;
    expect(ref.status).toBe('completed');
    if (ref.status !== 'completed') return;

    // Interrupted: pause at 60, then cancel.
    const interrupted = makeFakeEngine();
    const handle = startReplay(moveRightTrace(), interrupted.env, { pauseAtTick: 60 });
    await waitForState(handle, 'paused');
    handle.cancel();
    const cancelled = await handle.result;
    expect(cancelled.status).toBe('cancelled');

    // Restart from the initial snapshot: a fresh fake IS the restored scene.
    const restarted = makeFakeEngine();
    const again = await startReplay(moveRightTrace(), restarted.env).result;
    expect(again.status).toBe('completed');
    if (again.status !== 'completed') return;

    expect(again.outcome.collectiblesCollected).toBe(1);
    expect(restarted.getCollected()).toBe(1);
    expect(again.outcome.verdict).toBe('passed');
    const [ax] = ref.outcome.endPosition ?? [NaN, 0, 0];
    const [bx] = again.outcome.endPosition ?? [NaN, 0, 0];
    expect(Math.abs(ax - bx)).toBeLessThanOrEqual(MOVE_EPSILON);
    expect(again.outcome.pinned).toBe(true);
  });
});

describe('startReplay — the issue\'s own negative (dead input)', () => {
  it('a removed binding still fails the outcome assertion through the controlled, pinned path', async () => {
    const engine = makeFakeEngine({ bound: false });
    const result = await startReplay(moveRightTrace(), engine.env).result;
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    // Pinned, replayed to the end, and still a FAILED runtime verdict: the pin
    // makes the run reproducible, it does not make it pass.
    expect(result.outcome.pinned).toBe(true);
    expect(result.outcome.ticksReplayed).toBe(TICKS);
    expect(result.outcome.verdict).toBe('failed');
    expect(result.outcome.movedDistance).toBe(0);
    expect(result.outcome.collectiblesCollected).toBe(0);
    expect(engine.pressLog).toEqual([]);
    // Each assertion must fail ON ITS OWN. The verdict is the AND of the two,
    // so a verdict-only check would still pass if the move predicate were
    // rewritten to `true` and only the collectible check failed — a mutation
    // probe found exactly that gap.
    const byOp = Object.fromEntries(result.outcome.assertions.map((a) => [a.operationId, a.passed]));
    expect(byOp).toEqual({ 'qa.FR-1.OP-01': false, 'qa.FR-1.OP-03': false });
  });

  it('the pause boundary is a tick count, so dead input still pauses at tick 60', async () => {
    const engine = makeFakeEngine({ bound: false });
    const handle = startReplay(moveRightTrace(), engine.env, { pauseAtTick: 60 });
    const paused = await waitForState(handle, 'paused');
    expect(paused.tick).toBe(60);
    expect(engine.getPlayerX()).toBe(0);
    handle.cancel();
    const result = await handle.result;
    expect(result.status).toBe('cancelled');
  });
});
