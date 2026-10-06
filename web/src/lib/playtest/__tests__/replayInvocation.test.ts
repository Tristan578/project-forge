// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@/hooks/useEngine';
import {
  buildActionKeyResolver,
  createDomKeyboardEnvironment,
  type EngineDispatch,
} from '../replayInvocation';
import { publishPlayTick, resetPlayTickBus } from '../playTickBus';

function environment(dispatch: EngineDispatch | null = null) {
  return createDomKeyboardEnvironment({
    bindings: [],
    playerEntityId: 'player',
    collectibleEntityIds: [],
    dispatch,
  });
}

afterEach(() => {
  document.body.replaceChildren();
  resetPlayTickBus();
  vi.useRealTimers();
});

describe('browser replay boundary', () => {
  it('resolves digital and signed axis bindings without pressing the opposite direction', () => {
    const resolve = buildActionKeyResolver([
      { actionName: 'jump', actionType: 'digital', sources: ['Space'] },
      { actionName: 'move', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
    ]);
    expect(resolve('jump', { pressed: true })).toEqual(['Space']);
    expect(resolve('move', { pressed: true, axis: 1 })).toEqual(['KeyD']);
    expect(resolve('move', { pressed: true, axis: -1 })).toEqual(['KeyA']);
    expect(resolve('move', { pressed: false, axis: 0 })).toEqual([]);
    expect(resolve('move', { pressed: false })).toEqual([]);
    expect(resolve('missing', { pressed: true })).toEqual([]);
  });

  it('dispatches keyboard events to the canvas where winit listens', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'forge-canvas';
    document.body.append(canvas);
    const pressed = vi.fn();
    const released = vi.fn();
    canvas.addEventListener('keydown', pressed);
    canvas.addEventListener('keyup', released);

    const env = environment();
    await env.pressKeys(['KeyD']);
    await env.releaseKeys(['KeyD']);

    expect(pressed).toHaveBeenCalledOnce();
    expect(pressed.mock.calls[0][0]).toMatchObject({ code: 'KeyD', target: canvas });
    expect(released).toHaveBeenCalledOnce();
    expect(released.mock.calls[0][0]).toMatchObject({ code: 'KeyD', target: canvas });
  });

  it('fails explicitly when the engine canvas is missing', () => {
    expect(() => environment().pressKeys(['KeyD'])).toThrow('active engine canvas');
  });

  it('waits for a real play tick instead of elapsed animation frames', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const pending = environment().advanceFrame().then(settled);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();

    publishPlayTick({ entities: {}, inputState: { pressed: {}, axes: {} }, elapsedMs: 100 });
    await pending;
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a stopped runtime within the timeout', async () => {
    vi.useFakeTimers();
    const pending = environment().advanceFrame();
    const rejection = expect(pending).rejects.toThrow('no engine play tick');
    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('browser replay boundary — clock and runtime mode through the engine dispatcher (#10007)', () => {
  function recordingDispatch(answer: CommandResponse | void) {
    const log: Array<[string, unknown]> = [];
    const dispatch: EngineDispatch = (command, payload) => {
      log.push([command, payload]);
      return answer;
    };
    return { dispatch, log };
  }

  it('pins through pin_frame_rate and reports the engine\'s acceptance', async () => {
    const { dispatch, log } = recordingDispatch({ success: true });
    const env = environment(dispatch);
    expect(await env.pinFrameRate?.(60)).toBe(true);
    expect(log).toEqual([['pin_frame_rate', { hz: 60 }]]);
  });

  it('reports a refused pin so the runner can stop before injecting input', async () => {
    const { dispatch } = recordingDispatch({ success: false, error: 'Unknown command: pin_frame_rate' });
    expect(await environment(dispatch).pinFrameRate?.(60)).toBe(false);
  });

  it('treats a dispatcher that answers nothing as NOT pinned (a stand-in cannot confirm a pin)', async () => {
    const { dispatch } = recordingDispatch(undefined);
    expect(await environment(dispatch).pinFrameRate?.(60)).toBe(false);
  });

  it('unpins, pauses and resumes through the engine\'s own commands', async () => {
    const { dispatch, log } = recordingDispatch({ success: true });
    const env = environment(dispatch);
    await env.unpinFrameRate?.();
    await env.pauseRuntime?.();
    await env.resumeRuntime?.();
    expect(log.map(([command]) => command)).toEqual(['unpin_frame_rate', 'pause', 'resume']);
  });

  it('fails explicitly when no engine dispatcher is attached', () => {
    const env = environment(null);
    expect(() => env.pinFrameRate?.(60)).toThrow('engine command dispatcher');
    expect(() => env.unpinFrameRate?.()).toThrow('engine command dispatcher');
    expect(() => env.pauseRuntime?.()).toThrow('engine command dispatcher');
    expect(() => env.resumeRuntime?.()).toThrow('engine command dispatcher');
  });
});
