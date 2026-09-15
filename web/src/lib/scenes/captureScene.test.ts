// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureActiveScene, attachPrefabInstances, SCENE_EXPORTED_EVENT, SCENE_CAPTURE_TIMEOUT_MS } from './captureScene';
import type { PrefabInstance } from '../prefabs/prefabInstance';

/** Answer the pending export request the way the engine bridge does. */
function emitExport(json: string): void {
  window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, { detail: { json, name: 'Level 1' } }));
}

const SCENE_JSON = JSON.stringify({
  formatVersion: 1,
  sceneName: 'Level 1',
  entities: [{ id: 'a' }],
});

describe('captureActiveScene', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the scene the engine exports', async () => {
    const pending = captureActiveScene(() => true);
    emitExport(SCENE_JSON);

    await expect(pending).resolves.toEqual({
      status: 'captured',
      data: { formatVersion: 1, sceneName: 'Level 1', entities: [{ id: 'a' }] },
    });
  });

  it('subscribes before requesting, so an immediate answer is not missed', async () => {
    // The bridge normally answers a frame later, but nothing in the contract
    // promises that. If the listener were attached after the request, a
    // synchronous answer would resolve nothing and the capture would time out.
    const pending = captureActiveScene(() => {
      emitExport(SCENE_JSON);
      return true;
    });

    await expect(pending).resolves.toMatchObject({ status: 'captured' });
  });

  it('reports unavailable when no engine is connected', async () => {
    // Nothing was dispatched, so there is no scene to lose — the caller is
    // free to proceed rather than block on an answer that can never arrive.
    await expect(captureActiveScene(() => false)).resolves.toEqual({ status: 'unavailable' });
  });

  it('fails when the engine does not answer within the timeout', async () => {
    const pending = captureActiveScene(() => true);
    vi.advanceTimersByTime(SCENE_CAPTURE_TIMEOUT_MS);

    const result = await pending;
    expect(result.status).toBe('failed');
  });

  it('fails rather than resolving empty when the payload will not parse', async () => {
    const pending = captureActiveScene(() => true);
    emitExport('{not json');

    const result = await pending;
    expect(result.status).toBe('failed');
  });

  it('fails when the event carries no json', async () => {
    const pending = captureActiveScene(() => true);
    window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, { detail: {} }));

    const result = await pending;
    expect(result.status).toBe('failed');
  });

  it('stops listening once it has an answer', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const pending = captureActiveScene(() => true);
    emitExport(SCENE_JSON);
    await pending;

    expect(removeSpy).toHaveBeenCalledWith(SCENE_EXPORTED_EVENT, expect.any(Function));

    // A later export — an autosave, a cloud save — must not reach a settled
    // capture. Advancing past the timeout proves the timer was cleared too.
    emitExport(SCENE_JSON);
    vi.advanceTimersByTime(SCENE_CAPTURE_TIMEOUT_MS * 2);
    removeSpy.mockRestore();
  });

  it('honours a caller-supplied timeout', async () => {
    const pending = captureActiveScene(() => true, 100);
    vi.advanceTimersByTime(99);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(1);
    expect((await pending).status).toBe('failed');
  });
});

describe('attachPrefabInstances', () => {
  const instances: PrefabInstance[] = [
    { instanceId: 'pfi_a', prefabId: 'src', overrides: { name: 'Kept' } },
  ];

  it('folds instances into a captured scene', () => {
    const captured = { status: 'captured' as const, data: { formatVersion: 1, sceneName: 'L1', entities: [] } };
    const result = attachPrefabInstances(captured, instances);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    expect(result.data.prefabInstances).toEqual(instances);
  });

  it('returns a non-captured result untouched so the abort contract is preserved', () => {
    expect(attachPrefabInstances({ status: 'unavailable' }, instances)).toEqual({ status: 'unavailable' });
    const failed = { status: 'failed' as const, reason: 'x' };
    expect(attachPrefabInstances(failed, instances)).toEqual(failed);
  });
});
