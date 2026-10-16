// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@/hooks/useEngine';
import { EDITOR_CANVAS_ID } from '@/lib/engine/canvasId';
import type { InputBinding } from '@/stores/slices/types';
import {
  buildActionKeyResolver,
  createDomKeyboardEnvironment,
  type EngineDispatch,
} from '../replayInvocation';
import { botSessionToInputTrace } from '../botTrace';
import { replayInputTrace, type ReplayEnvironment } from '../replayRunner';
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
    canvas.id = EDITOR_CANVAS_ID;
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

  /**
   * The precondition, exactly (#10007, the first live run of the gate). The
   * boundary needs ONE thing: the editor's engine canvas, the element whose
   * id `CanvasArea` renders and `init_engine` attaches to, because winit's
   * keyboard listeners sit on that element. Nothing else — not focus, not
   * layout visibility (headless SwiftShader keeps the canvas `invisible`
   * until the first frame and never focuses it). The id used to be a
   * literal that no component renders ('forge-canvas'), and every test here
   * fabricated it, so the check passed against an element the app never has.
   */
  it('targets the element with the editor canvas id, unfocused and hidden, and nothing else', async () => {
    expect(EDITOR_CANVAS_ID).toBe('game-canvas');
    const canvas = document.createElement('canvas');
    canvas.id = EDITOR_CANVAS_ID;
    canvas.className = 'invisible';
    canvas.tabIndex = -1;
    document.body.append(canvas);
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    const pressed = vi.fn();
    canvas.addEventListener('keydown', pressed);

    await environment().pressKeys(['KeyD']);
    expect(pressed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(other);
  });

  it('refuses a <canvas> under any other id, the old literal included', () => {
    const stray = document.createElement('canvas');
    stray.id = 'forge-canvas';
    document.body.append(stray);
    expect(() => environment().pressKeys(['KeyD'])).toThrow(/engine canvas/);
  });

  it('refuses a non-canvas element that carries the id', () => {
    const impostor = document.createElement('div');
    impostor.id = EDITOR_CANVAS_ID;
    document.body.append(impostor);
    expect(() => environment().pressKeys(['KeyD'])).toThrow(/engine canvas/);
  });

  it('fails explicitly when the engine canvas is missing, naming the id it looked for', () => {
    expect(() => environment().pressKeys(['KeyD'])).toThrow(`#${EDITOR_CANVAS_ID}`);
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

/**
 * #10007 (review finding) — end to end from the bot's plan to the resolver.
 * `buildActionKeyResolver` reads the sign for an AXIS binding only and
 * answers a DIGITAL binding's key whatever the sign, so a leftward plan on a
 * scene that binds only a digital `move_right` used to press KeyD — the wrong
 * direction. The trace conversion now emits the negative-axis fallback only
 * for a name the bindings mark as an axis; replayed through the real
 * resolver, KeyD is never pressed for a leftward move on that scene.
 */
describe('a leftward bot move never presses a digital move_right key', () => {
  /** The bot's plan on a scene's bindings, replayed through the real resolver into a key log. */
  async function keysPressedFor(direction: { x: number; y: number }, bindings: InputBinding[]): Promise<string[]> {
    const trace = botSessionToInputTrace(
      { actions: [{ type: 'move', timestamp: 0, direction }, { type: 'wait', timestamp: 100 }] },
      {
        fixtureId: 'resolver-fixture',
        actionNames: bindings.map((b) => b.actionName),
        axisActionNames: bindings.filter((b) => b.actionType === 'axis').map((b) => b.actionName),
        msPerTick: 50,
      },
    );
    const pressed: string[] = [];
    const env: ReplayEnvironment = {
      resolveKeys: buildActionKeyResolver(bindings),
      pressKeys: (codes) => {
        pressed.push(...codes);
      },
      releaseKeys: () => {},
      advanceFrame: async () => {},
      observe: () => null,
      playerEntityId: 'player',
      collectibleEntityIds: [],
    };
    await replayInputTrace(trace, env);
    return pressed;
  }

  const digitalRightOnly: InputBinding[] = [
    { actionName: 'move_right', actionType: 'digital', sources: ['KeyD'] },
  ];
  const axisRight: InputBinding[] = [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ];

  it('presses KeyD for a rightward move on the digital-only scene (the pipeline is live)', async () => {
    expect(await keysPressedFor({ x: 1, y: 0 }, digitalRightOnly)).toEqual(['KeyD']);
  });

  it('presses nothing for a leftward move on the digital-only scene — never KeyD', async () => {
    expect(await keysPressedFor({ x: -1, y: 0 }, digitalRightOnly)).toEqual([]);
  });

  it('presses KeyA for a leftward move when move_right is a signed axis', async () => {
    expect(await keysPressedFor({ x: -1, y: 0 }, axisRight)).toEqual(['KeyA']);
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

  // The engine answers every command; a boundary that ignores the answer
  // reports a clock as released, or a runtime as paused, when it is not.
  it.each([
    ['unpinFrameRate', 'unpin_frame_rate'],
    ['pauseRuntime', 'pause'],
    ['resumeRuntime', 'resume'],
  ] as const)('%s throws when the engine refuses %s, naming the command and the reason', async (method, command) => {
    const { dispatch } = recordingDispatch({ success: false, error: 'PendingCommands resource not initialized' });
    const env = environment(dispatch);
    await expect(async () => {
      await env[method]?.();
    }).rejects.toThrow(new RegExp(`${command}.*PendingCommands resource not initialized`));
  });

  it.each([
    ['unpinFrameRate', 'unpin_frame_rate'],
    ['pauseRuntime', 'pause'],
    ['resumeRuntime', 'resume'],
  ] as const)('%s throws when a stand-in dispatcher answers nothing (no engine confirmed %s)', async (method, command) => {
    const { dispatch } = recordingDispatch(undefined);
    const env = environment(dispatch);
    await expect(async () => {
      await env[method]?.();
    }).rejects.toThrow(new RegExp(`${command}`));
  });

  it('fails explicitly when no engine dispatcher is attached', () => {
    const env = environment(null);
    expect(() => env.pinFrameRate?.(60)).toThrow('engine command dispatcher');
    expect(() => env.unpinFrameRate?.()).toThrow('engine command dispatcher');
    expect(() => env.pauseRuntime?.()).toThrow('engine command dispatcher');
    expect(() => env.resumeRuntime?.()).toThrow('engine command dispatcher');
  });
});
