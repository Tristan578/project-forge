import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSceneWhenReady, refusalOf } from '../playSceneLoad';
import { PLAY_SCENE_LOAD_RETRY_MS, PLAY_SCENE_LOAD_TIMEOUT_MS } from '@/lib/config/timeouts';

const NOT_READY = { success: false, error: 'PendingCommands resource not initialized' };
const OK = { success: true };

describe('refusalOf', () => {
  it('reads only an explicit success:false as a refusal', () => {
    expect(refusalOf(undefined)).toBeNull();
    expect(refusalOf(null)).toBeNull();
    expect(refusalOf('ok')).toBeNull();
    expect(refusalOf({})).toBeNull();
    expect(refusalOf(OK)).toBeNull();
    expect(refusalOf({ success: false, error: 'bad' })).toBe('bad');
    expect(refusalOf({ success: false })).toBe('no reason given');
    expect(refusalOf({ success: false, error: '' })).toBe('no reason given');
  });
});

describe('loadSceneWhenReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends load_scene as an OBJECT carrying the scene JSON, never a JSON string (#10196)', async () => {
    const send = vi.fn().mockReturnValue(OK);
    const scene = { entities: [{ id: 'e1' }], name: 'Level 1' };

    await loadSceneWhenReady(send, scene);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('load_scene', { json: JSON.stringify(scene) });
    // The engine reads `payload.json`; a string payload has no fields at all.
    expect(typeof send.mock.calls[0][1]).toBe('object');
  });

  it('retries only the not-initialised refusal until the engine accepts', async () => {
    const send = vi.fn()
      .mockReturnValueOnce(NOT_READY)
      .mockReturnValueOnce(NOT_READY)
      .mockReturnValue(OK);

    const done = loadSceneWhenReady(send, {});
    await vi.advanceTimersByTimeAsync(PLAY_SCENE_LOAD_RETRY_MS * 2);
    await done;

    expect(send).toHaveBeenCalledTimes(3);
    for (const call of send.mock.calls) expect(call[0]).toBe('load_scene');
  });

  it('rejects at once, with the engine text, on any other refusal', async () => {
    const send = vi.fn().mockReturnValue({ success: false, error: "Missing 'json' field in load_scene payload" });

    await expect(loadSceneWhenReady(send, {})).rejects.toThrow(
      "Scene failed to load: Missing 'json' field in load_scene payload",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up when the engine never becomes ready within the bound', async () => {
    const send = vi.fn().mockReturnValue(NOT_READY);

    const failed = loadSceneWhenReady(send, {});
    // Attach the rejection handler before the clock moves so the eventual
    // rejection is never unhandled.
    const outcome = expect(failed).rejects.toThrow(
      `Scene failed to load: the engine did not accept commands within ${PLAY_SCENE_LOAD_TIMEOUT_MS}ms`,
    );
    await vi.advanceTimersByTimeAsync(PLAY_SCENE_LOAD_TIMEOUT_MS + PLAY_SCENE_LOAD_RETRY_MS);
    await outcome;

    // Bounded: one attempt per retry interval across the whole window, then stop.
    const attempts = send.mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(PLAY_SCENE_LOAD_TIMEOUT_MS / PLAY_SCENE_LOAD_RETRY_MS);
    expect(attempts).toBeLessThanOrEqual(PLAY_SCENE_LOAD_TIMEOUT_MS / PLAY_SCENE_LOAD_RETRY_MS + 2);
  });

  it('honours caller-supplied bounds', async () => {
    const send = vi.fn().mockReturnValue(NOT_READY);
    const failed = loadSceneWhenReady(send, {}, { timeoutMs: 100, retryMs: 25 });
    const outcome = expect(failed).rejects.toThrow('within 100ms');
    await vi.advanceTimersByTimeAsync(200);
    await outcome;
    expect(send.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('propagates a throwing dispatcher without retrying', async () => {
    const send = vi.fn(() => { throw new Error('engine unreachable'); });

    await expect(loadSceneWhenReady(send, {})).rejects.toThrow('engine unreachable');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats a dispatcher that returns nothing as accepted (test-double contract)', async () => {
    const send = vi.fn();
    await loadSceneWhenReady(send, {});
    expect(send).toHaveBeenCalledTimes(1);
  });
});
