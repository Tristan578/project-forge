// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildActionKeyResolver, createDomKeyboardEnvironment } from '../replayInvocation';
import { publishPlayTick, resetPlayTickBus } from '../playTickBus';

function environment() {
  return createDomKeyboardEnvironment({ bindings: [], playerEntityId: 'player', collectibleEntityIds: [] });
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
