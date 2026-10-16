// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResponse } from '@/hooks/useEngine';
import { EDITOR_CANVAS_ID } from '@/lib/engine/canvasId';
import type { InputBinding } from '@/stores/slices/types';
import {
  buildActionKeyResolver,
  createDomKeyboardEnvironment,
  replayActionNames,
  replayAxisActionNames,
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

  /**
   * #10007 (round-2 finding) — a two-player scene keeps BOTH slots' rows for
   * one action name in the flat list (`scriptSlice.setInputBinding` keys a
   * row by name and slot), each with its own `actionType`. The resolver used
   * to key the list by name alone, so whichever slot's row came last answered
   * — and the engine's character controller reads the primary slot only
   * (`InputState::get_axis` is `get_axis_for(0, ..)`). It answers the
   * primary player's row now, whatever the order.
   */
  it("answers the PRIMARY player's row for a name two slots bind, whichever row comes last", () => {
    const primaryAxis: InputBinding = {
      actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'],
    };
    const secondDigital: InputBinding = { actionName: 'move_right', actionType: 'digital', sources: ['ArrowRight'], player: 1 };
    for (const bindings of [[primaryAxis, secondDigital], [secondDigital, primaryAxis]]) {
      const resolve = buildActionKeyResolver(bindings);
      expect(resolve('move_right', { pressed: true, axis: -1 })).toEqual(['KeyA']);
      expect(resolve('move_right', { pressed: true, axis: 1 })).toEqual(['KeyD']);
    }
  });

  it('answers nothing for a name only a second player binds — the controller never reads that slot', () => {
    const resolve = buildActionKeyResolver([{ actionName: 'attack', actionType: 'digital', sources: ['KeyF'], player: 1 }]);
    expect(resolve('attack', { pressed: true })).toEqual([]);
  });

  it('treats an explicit player: 0 as the primary slot, exactly like an absent player', () => {
    const resolve = buildActionKeyResolver([
      { actionName: 'move_right', actionType: 'digital', sources: ['ArrowRight'], player: 1 },
      { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'], player: 0 },
    ]);
    expect(resolve('move_right', { pressed: true, axis: -1 })).toEqual(['KeyA']);
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
 * #10007 (review finding) — the axis names handed to the bot's trace
 * conversion come from the same rows the key resolver answers: the primary
 * player's. A second player's row of the same name must not make a name an
 * axis (round-2 finding: any-match over the flat list did, while the
 * resolver answered the last row by name).
 */
describe('replayActionNames', () => {
  it("lists the primary player's names only, one each, in binding order, whatever the slot order", () => {
    const primaryAxis: InputBinding = {
      actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'],
    };
    const secondLeft: InputBinding = { actionName: 'move_left', actionType: 'digital', sources: ['ArrowLeft'], player: 1 };
    const primaryJump: InputBinding = { actionName: 'jump', actionType: 'digital', sources: ['Space'], player: 0 };
    expect(replayActionNames([primaryAxis, secondLeft, primaryJump])).toEqual(['move_right', 'jump']);
    expect(replayActionNames([secondLeft, primaryJump, primaryAxis])).toEqual(['jump', 'move_right']);
    expect(replayActionNames([secondLeft])).toEqual([]);
    expect(replayActionNames([])).toEqual([]);
  });
});

describe('replayAxisActionNames', () => {
  const primaryAxis: InputBinding = {
    actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'],
  };
  const primaryDigital: InputBinding = { actionName: 'move_right', actionType: 'digital', sources: ['KeyD'] };
  const secondAxis: InputBinding = {
    actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['ArrowRight'], negativeKeys: ['ArrowLeft'], player: 1,
  };
  const secondDigital: InputBinding = { actionName: 'move_right', actionType: 'digital', sources: ['ArrowRight'], player: 1 };

  it("lists the primary player's signed axes, in either order of the flat list", () => {
    expect(replayAxisActionNames([primaryAxis, secondDigital])).toEqual(['move_right']);
    expect(replayAxisActionNames([secondDigital, primaryAxis])).toEqual(['move_right']);
  });

  it("does not call a name an axis because a SECOND player's row is one", () => {
    expect(replayAxisActionNames([primaryDigital, secondAxis])).toEqual([]);
    expect(replayAxisActionNames([secondAxis, primaryDigital])).toEqual([]);
    expect(replayAxisActionNames([secondAxis])).toEqual([]);
  });

  it('treats an explicit player: 0 as the primary slot, and an empty scene as no axes', () => {
    expect(replayAxisActionNames([{ ...primaryAxis, player: 0 }])).toEqual(['move_right']);
    expect(replayAxisActionNames([])).toEqual([]);
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
  /**
   * The bot's plan on a scene's bindings, replayed through the real resolver
   * into a key log. The vocabulary and the axis names are derived exactly as
   * PlaytestPanel and the chat handler derive them (`replayActionNames`,
   * `replayAxisActionNames`).
   */
  async function keysPressedFor(direction: { x: number; y: number }, bindings: InputBinding[]): Promise<string[]> {
    const trace = botSessionToInputTrace(
      { actions: [{ type: 'move', timestamp: 0, direction }, { type: 'wait', timestamp: 100 }] },
      {
        fixtureId: 'resolver-fixture',
        actionNames: replayActionNames(bindings),
        axisActionNames: replayAxisActionNames(bindings),
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

  it("a move_left bound only on player 1's slot does not divert a leftward move from the primary's signed axis", async () => {
    // With the vocabulary taken from every slot, the bot would plan
    // `move_left` (which the primary-only resolver cannot answer) instead of
    // the negative `move_right` axis, and press nothing where KeyA was there.
    const primaryAxisSecondLeft: InputBinding[] = [
      ...axisRight,
      { actionName: 'move_left', actionType: 'digital', sources: ['ArrowLeft'], player: 1 },
    ];
    expect(await keysPressedFor({ x: -1, y: 0 }, primaryAxisSecondLeft)).toEqual(['KeyA']);
  });

  /**
   * Round-2 finding: the whole two-player binding matrix. Slot 0 (the primary
   * player, `player` absent) and slot 1 each bind `move_right` as absent, a
   * digital key or a signed axis, in both orders of the flat list, for a
   * leftward and a rightward move. What is pressed is decided by the PRIMARY
   * row alone — player 1's keys (Arrow*) are never pressed, and a primary
   * digital `move_right` never answers a leftward move with KeyD even when
   * player 1 binds the name as an axis. Before the fix, [primary axis +
   * second digital] pressed ArrowRight (or KeyD) for a leftward move.
   */
  describe('two-player binding matrix: only the primary row decides', () => {
    type Shape = 'absent' | 'digital' | 'axis';
    const SHAPES: readonly Shape[] = ['absent', 'digital', 'axis'];
    const PRIMARY_KEYS = { positive: 'KeyD', negative: 'KeyA' };
    const SECOND_KEYS = { positive: 'ArrowRight', negative: 'ArrowLeft' };

    function row(shape: Shape, keys: { positive: string; negative: string }, player?: number): InputBinding[] {
      const slot = player === undefined ? {} : { player };
      if (shape === 'absent') return [];
      if (shape === 'digital') return [{ actionName: 'move_right', actionType: 'digital', sources: [keys.positive], ...slot }];
      return [{
        actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: [keys.positive], negativeKeys: [keys.negative], ...slot,
      }];
    }

    /** What the primary row alone answers: its sign for an axis, its one key for a digital, nothing otherwise. */
    function expectedKeys(primary: Shape, x: number): string[] {
      if (primary === 'axis') return [x > 0 ? PRIMARY_KEYS.positive : PRIMARY_KEYS.negative];
      if (primary === 'digital') return x > 0 ? [PRIMARY_KEYS.positive] : [];
      return [];
    }

    const MATRIX: Array<{ primary: Shape; second: Shape; order: 'primary first' | 'second first'; x: number }> = [];
    for (const primary of SHAPES) {
      for (const second of SHAPES) {
        for (const order of ['primary first', 'second first'] as const) {
          for (const x of [-1, 1]) MATRIX.push({ primary, second, order, x });
        }
      }
    }

    it('enumerates every cell (3 x 3 shapes, both orders, both directions)', () => {
      expect(MATRIX).toHaveLength(36);
    });

    it.each(MATRIX)(
      'primary $primary + second $second ($order), x = $x',
      async ({ primary, second, order, x }) => {
        const primaryRows = row(primary, PRIMARY_KEYS);
        const secondRows = row(second, SECOND_KEYS, 1);
        const bindings = order === 'primary first' ? [...primaryRows, ...secondRows] : [...secondRows, ...primaryRows];
        const pressed = await keysPressedFor({ x, y: 0 }, bindings);
        expect(pressed).toEqual(expectedKeys(primary, x));
        expect(pressed).not.toContain(SECOND_KEYS.positive);
        expect(pressed).not.toContain(SECOND_KEYS.negative);
      },
    );

    it('mirrors on y: a primary signed-axis move_forward answers a backward move with its own negative key', async () => {
      const bindings: InputBinding[] = [
        { actionName: 'move_forward', actionType: 'digital', sources: ['ArrowUp'], player: 1 },
        { actionName: 'move_forward', actionType: 'axis', sources: [], positiveKeys: ['KeyW'], negativeKeys: ['KeyS'] },
      ];
      expect(await keysPressedFor({ x: 0, y: -1 }, bindings)).toEqual(['KeyS']);
      expect(await keysPressedFor({ x: 0, y: 1 }, bindings)).toEqual(['KeyW']);
    });

    it("mirrors on y: a primary digital move_forward leaves a backward move unbound even though player 1's is an axis", async () => {
      const bindings: InputBinding[] = [
        { actionName: 'move_forward', actionType: 'digital', sources: ['KeyW'] },
        { actionName: 'move_forward', actionType: 'axis', sources: [], positiveKeys: ['ArrowUp'], negativeKeys: ['ArrowDown'], player: 1 },
      ];
      expect(await keysPressedFor({ x: 0, y: -1 }, bindings)).toEqual([]);
      expect(await keysPressedFor({ x: 0, y: 1 }, bindings)).toEqual(['KeyW']);
    });
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

  // #10007 (Sentry finding on PR #10369): the runner watches the editor's
  // engine mode through the boundary, so the entry points' store subscription
  // has to travel through this config to reach it — and a caller with no
  // editor gets an environment without the hook, not one that is `undefined`.
  it('carries the engine-mode subscription into the environment when configured, and omits it otherwise', () => {
    const subscribe = vi.fn(() => () => {});
    const env = createDomKeyboardEnvironment({
      bindings: [],
      playerEntityId: 'player',
      collectibleEntityIds: [],
      dispatch: null,
      subscribeEngineMode: subscribe,
    });
    expect(env.subscribeEngineMode).toBe(subscribe);
    expect(environment()).not.toHaveProperty('subscribeEngineMode');
  });
});
