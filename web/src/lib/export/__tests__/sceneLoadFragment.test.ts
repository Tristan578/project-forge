/**
 * The exported runtime's scene load (#10013 discovery).
 *
 * Measured against the real runtime build (webgpu,runtime at 9261e23f): the
 * engine's `load_scene` handler reads `payload.json`, and a command issued
 * before the Bevy app's first update is refused with "PendingCommands resource
 * not initialized". The exporters called `handle_command('load_scene',
 * JSON.stringify(scene))` straight after `init_engine`, which fails on BOTH
 * counts (`Missing 'json' field in load_scene payload`), so an exported game
 * never loaded its own scene — and a performance fixture run would have
 * measured an empty world. These tests execute the generated JS.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateSceneLoadFragment, SCENE_LOAD_TIMEOUT_MS } from '../sceneLoadFragment';

type Send = (cmd: string, payload: unknown) => unknown;

/** Compile the fragment and return its loader, with injectable timers. */
function compile(now: () => number) {
  const src = `${generateSceneLoadFragment()}\nreturn __forgeLoadScene;`;
  const factory = new Function('performance', 'setTimeout', src) as (
    perf: { now: () => number },
    st: (fn: () => void, ms: number) => void,
  ) => (send: Send, scene: unknown) => Promise<unknown>;
  return factory({ now }, (fn) => fn());
}

describe('generateSceneLoadFragment', () => {
  it('sends the scene as a { json } object payload, never a bare JSON string', async () => {
    const send = vi.fn((_cmd: string, _payload: unknown) => ({ success: true }));
    const load = compile(() => 0);
    const scene = { formatVersion: 3, entities: [{ entityId: 'a' }] };
    await expect(load(send, scene)).resolves.toEqual({ success: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('load_scene', { json: JSON.stringify(scene) });
  });

  it('retries while the engine has not finished initialising, then loads', async () => {
    let calls = 0;
    const send = vi.fn(() => {
      calls += 1;
      return calls < 4 ? { success: false, error: 'PendingCommands resource not initialized' } : { success: true };
    });
    let t = 0;
    const load = compile(() => (t += 50));
    await expect(load(send, { entities: [] })).resolves.toEqual({ success: true });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('rejects immediately with the engine error when the scene itself is refused', async () => {
    const send = vi.fn(() => ({ success: false, error: 'Invalid scene file: missing field `entities`' }));
    const load = compile(() => 0);
    await expect(load(send, {})).rejects.toThrow(/Scene failed to load: Invalid scene file/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up after the bounded wait instead of retrying forever', async () => {
    const send = vi.fn(() => ({ success: false, error: 'PendingCommands resource not initialized' }));
    let t = 0;
    const load = compile(() => (t += 1000));
    await expect(load(send, {})).rejects.toThrow(/not initialized/);
    expect(send.mock.calls.length).toBeLessThanOrEqual(SCENE_LOAD_TIMEOUT_MS / 1000 + 2);
  });

  it('treats a missing response as a failure, not a success', async () => {
    const send = vi.fn(() => undefined);
    const load = compile(() => 0);
    await expect(load(send, {})).rejects.toThrow(/no response/);
  });
});
