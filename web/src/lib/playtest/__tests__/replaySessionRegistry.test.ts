/**
 * #10007 (review-board round 2, minor 7) — the E2E hook's session registry.
 *
 * `window.__FORGE_REPLAY_CONTROL` addresses controlled replays by id. The
 * original map in EditorLayout never deleted an entry, so every session a
 * spec started stayed referenced (handle, progress, closure) for the life of
 * the page. The registry drops SETTLED sessions, but only when the next one
 * is registered rather than the instant they settle: the live spec reads
 * `state(id)` AFTER `result(id)` has resolved (it asserts the engine's own
 * evaluated input is released once the run is cancelled), so the most recent
 * finished session must stay addressable until a newer one replaces it.
 * Growth is therefore bounded to one settled entry plus the active one.
 */
import { describe, expect, it } from 'vitest';
import type { ReplayHandle, ReplayRunResult } from '../replayRunner';
import { createReplaySessionRegistry } from '../replaySessionRegistry';

function fakeHandle(): { handle: ReplayHandle; settle: (result?: ReplayRunResult) => void } {
  let resolve!: (result: ReplayRunResult) => void;
  const result = new Promise<ReplayRunResult>((r) => {
    resolve = r;
  });
  const handle = {
    result,
    pause: () => false,
    resume: () => false,
    cancel: () => false,
    getProgress: () => ({ state: 'running' as const, tick: 0, totalTicks: 1, heldKeys: [], pinned: true }),
    subscribe: () => () => {},
  } satisfies ReplayHandle;
  return { handle, settle: (r = { status: 'cancelled', ticksReplayed: 0 }) => resolve(r) };
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe('createReplaySessionRegistry', () => {
  it('hands out distinct ids and finds what it registered', () => {
    const registry = createReplaySessionRegistry();
    const a = fakeHandle();
    const b = fakeHandle();
    const idA = registry.register({ playerEntityId: 'p', handle: a.handle });
    const idB = registry.register({ playerEntityId: 'q', handle: b.handle });
    expect(idA).not.toBe(idB);
    expect(registry.get(idA).handle).toBe(a.handle);
    expect(registry.get(idB).playerEntityId).toBe('q');
    expect(registry.size()).toBe(2);
  });

  it('throws for an unknown id, naming it', () => {
    const registry = createReplaySessionRegistry();
    expect(() => registry.get('replay-99')).toThrow('Unknown replay session: replay-99');
  });

  it('keeps a settled session addressable until the next one is registered, then drops it', async () => {
    const registry = createReplaySessionRegistry();
    const first = fakeHandle();
    const idFirst = registry.register({ playerEntityId: 'p', handle: first.handle });
    first.settle();
    await flush();
    // The spec reads state(id) after result(id): still here.
    expect(registry.get(idFirst).handle).toBe(first.handle);
    expect(registry.size()).toBe(1);

    const second = fakeHandle();
    const idSecond = registry.register({ playerEntityId: 'p', handle: second.handle });
    expect(() => registry.get(idFirst)).toThrow(`Unknown replay session: ${idFirst}`);
    expect(registry.get(idSecond).handle).toBe(second.handle);
    expect(registry.size()).toBe(1);
  });

  it('never drops a session that has not settled, however many are registered after it', async () => {
    const registry = createReplaySessionRegistry();
    const active = fakeHandle();
    const idActive = registry.register({ playerEntityId: 'p', handle: active.handle });
    for (let i = 0; i < 5; i += 1) {
      const settled = fakeHandle();
      registry.register({ playerEntityId: 'p', handle: settled.handle });
      settled.settle();
      await flush();
    }
    registry.register({ playerEntityId: 'p', handle: fakeHandle().handle });
    expect(registry.get(idActive).handle).toBe(active.handle);
    // The active one and the newest one; every settled one in between is gone.
    expect(registry.size()).toBe(2);
  });
});
