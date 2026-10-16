/**
 * #10007 — the in-app AI's replay tool and the simulation-clock tools.
 *
 * `runReplay` is mocked here: what the AI path does to the ENGINE, compared
 * command for command with the manual path, is proven against a simulated
 * engine in `lib/playtest/__tests__/replayParity.test.ts`. These tests pin the
 * handler's own contract: argument validation, the one-source rule, the
 * Play-mode requirement, the strategy → trace conversion, and that an
 * invalid trace is refused with the SAME text the manual recorder produces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { playtestHandlers, REPLAY_NEEDS_ONE_SOURCE, REPLAY_REQUIRES_PLAY_MODE } from '../playtestHandlers';
import { INPUT_TRACE_VERSION, parseInputTrace } from '@/lib/playtest/inputTrace';
// The tool definition the in-app AI reads (`chat/tools.ts` and `ai/spawnforgeAgent.ts` import this copy).
import manifestJson from '@/data/commands.json';

/**
 * Round-2 finding: the description promised the verdict covers "whether
 * exactly one collectible was collected", while a strategy run opts out of
 * that assertion (see "plans a bot strategy ..." below), so a model reading
 * `verdict: 'passed'` on a strategy run would report a collectible collected
 * when `collectiblesCollected` is 0. The contract now scopes the promise to a
 * recorded trace and says what a strategy run asserts and reports.
 */
describe('replay_input_trace tool description — the contract the AI reads', () => {
  const description = manifestJson.commands.find((c) => c.name === 'replay_input_trace')?.description ?? '';

  it('scopes the collectible promise to a recorded trace', () => {
    expect(description).toContain('for a recorded trace, whether exactly one collectible was collected');
    expect(description).not.toContain('moved and whether exactly one collectible');
  });

  it('says a strategy run asserts movement only and reports the collectible count without asserting it', () => {
    expect(description).toContain('A strategy run asserts movement only');
    expect(description).toContain('reports collectiblesCollected without asserting it');
  });
});

const runReplay = vi.hoisted(() => vi.fn());
/** The single-flight guard's view: null when idle, the active session otherwise. */
const getActiveReplaySession = vi.hoisted(() => vi.fn<() => { source: string } | null>(() => null));
vi.mock('@/lib/playtest/replayEntryPoints', () => ({ runReplay, getActiveReplaySession }));

const simulatePlaytest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/gameplayBot', () => ({ simulatePlaytest }));

const PLAYER = 'player-1';

function validTrace() {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'minimal-2d-replay',
    actionNames: ['move_right'],
    durationMs: 160,
    frames: Array.from({ length: 10 }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true, axis: 1 } },
    })),
  };
}

const outcome = {
  command: 'replay_input_trace',
  verdict: 'passed',
  ticksReplayed: 10,
  assertions: [],
  playerEntityId: PLAYER,
  startPosition: [0, 0, 0],
  endPosition: [1, 0, 0],
  movedDistance: 1,
  collectiblesCollected: 1,
  pinned: true,
  pinHz: 60,
};

const playing = {
  engineMode: 'play',
  sceneName: 'Fixture',
  inputBindings: [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ],
  allGameComponents: { coin: [{ type: 'collectible' }] },
};

beforeEach(() => {
  runReplay.mockReset();
  simulatePlaytest.mockReset();
  getActiveReplaySession.mockReset();
  getActiveReplaySession.mockReturnValue(null);
  runReplay.mockResolvedValue({ command: 'replay_input_trace', source: 'ai', outcome });
});

describe('replay_input_trace', () => {
  it('replays a recorded trace through the shared entry point, labelled ai', async () => {
    const trace = validTrace();
    const { result, dispatchCommand } = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { trace, playerEntityId: PLAYER, collectibleEntityIds: ['coin'] },
      playing,
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      command: 'replay_input_trace',
      source: 'ai',
      strategy: null,
      outcome,
    });
    expect(runReplay).toHaveBeenCalledTimes(1);
    const [source, request, options, deps] = runReplay.mock.calls[0];
    expect(source).toBe('ai');
    expect(request).toEqual({ trace: parseInputTrace(trace), playerEntityId: PLAYER, collectibleEntityIds: ['coin'] });
    // A recorded trace keeps the FULL verdict, the collectible assertion
    // included: only a planned strategy opts out of it (below).
    expect(options).toEqual({});
    expect(options).not.toHaveProperty('assertCollectible');
    expect(deps.bindings).toEqual(playing.inputBindings);
    expect(deps.allGameComponents).toEqual(playing.allGameComponents);
    // The dispatcher the replay pins the clock through is the context's.
    deps.dispatch('pin_frame_rate', { hz: 60 });
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 60 });
  });

  /** A planned session: one move, then a wait. */
  function plannedSession(direction: { x: number; y: number }) {
    return {
      strategy: 'explorer',
      actions: [
        { type: 'move', timestamp: 0, direction },
        { type: 'wait', timestamp: 500 },
      ],
      duration: 1000,
      outcome: 'completed',
      discoveries: [],
      metrics: { timeToComplete: 1000, deathCount: 0, itemsCollected: 0, areasExplored: 0, backtrackCount: 0 },
    };
  }

  it('plans a bot strategy and replays the resulting trace without the collectible assertion', async () => {
    simulatePlaytest.mockResolvedValue(plannedSession({ x: 1, y: 0 }));
    const { result } = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'explorer', playerEntityId: PLAYER },
      playing,
    );
    expect(result.success).toBe(true);
    expect((result.result as { strategy: string }).strategy).toBe('explorer');
    expect(simulatePlaytest).toHaveBeenCalledWith(
      expect.objectContaining({ gameComponents: { coin: [{ type: 'collectible' }] } }),
      'explorer',
    );
    const [, request, options] = runReplay.mock.calls[0];
    expect(request.playerEntityId).toBe(PLAYER);
    expect(request.collectibleEntityIds).toBeUndefined();
    // The plan became a trace in the scene's own vocabulary.
    expect(request.trace.actionNames).toEqual(['move_right']);
    expect(request.trace.frames[0].actions).toEqual({ move_right: { pressed: true, axis: 1 } });
    expect(request.trace.frames.length).toBeGreaterThan(0);
    // The plan never aims for a collectible, so its verdict is the movement
    // assertion alone (the recorded-trace branch above keeps OP-03).
    expect(options).toEqual({ assertCollectible: false });
  });

  // `buildActionKeyResolver` answers a digital binding's key whatever the
  // sign, so the negative-axis fallback is allowed only for names the
  // bindings mark as an axis — derived here from the store's bindings.
  it('derives the axis names from the bindings: a leftward plan is a negative move_right axis only when move_right is an axis', async () => {
    simulatePlaytest.mockResolvedValue(plannedSession({ x: -1, y: 0 }));
    const onAxis = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'explorer', playerEntityId: PLAYER },
      playing,
    );
    expect(onAxis.result.success).toBe(true);
    expect(runReplay.mock.calls[0][1].trace.frames[0].actions).toEqual({ move_right: { pressed: true, axis: -1 } });

    simulatePlaytest.mockResolvedValue(plannedSession({ x: -1, y: 0 }));
    const onDigital = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'explorer', playerEntityId: PLAYER },
      { ...playing, inputBindings: [{ actionName: 'move_right', actionType: 'digital', sources: ['KeyD'] }] },
    );
    expect(onDigital.result.success).toBe(true);
    const digitalTrace = runReplay.mock.calls[1][1].trace;
    expect(digitalTrace.frames.length).toBeGreaterThan(0);
    // Unbound, not reversed: pressing right for a leftward move is worse than not moving.
    expect(digitalTrace.frames[0].actions).toEqual({});
  });

  // Round-2 finding: a two-player scene keeps a row per slot for one name in
  // the flat list, each with its own actionType. The axis names come from the
  // PRIMARY player's row (the one the key resolver answers and the engine's
  // controller reads), not from any row of that name.
  it("derives the axis names from the PRIMARY player's row, not a second player's row of the same name", async () => {
    const primaryAxis = { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] };
    const secondDigital = { actionName: 'move_right', actionType: 'digital', sources: ['ArrowRight'], player: 1 };
    simulatePlaytest.mockResolvedValue(plannedSession({ x: -1, y: 0 }));
    const primaryIsAxis = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'explorer', playerEntityId: PLAYER },
      { ...playing, inputBindings: [primaryAxis, secondDigital] },
    );
    expect(primaryIsAxis.result.success).toBe(true);
    const axisTrace = runReplay.mock.calls[runReplay.mock.calls.length - 1][1].trace;
    expect(axisTrace.frames[0].actions).toEqual({ move_right: { pressed: true, axis: -1 } });

    const primaryDigital = { actionName: 'move_right', actionType: 'digital', sources: ['KeyD'] };
    const secondAxis = {
      actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['ArrowRight'], negativeKeys: ['ArrowLeft'], player: 1,
    };
    simulatePlaytest.mockResolvedValue(plannedSession({ x: -1, y: 0 }));
    const primaryIsDigital = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'explorer', playerEntityId: PLAYER },
      { ...playing, inputBindings: [primaryDigital, secondAxis] },
    );
    expect(primaryIsDigital.result.success).toBe(true);
    const digitalTrace = runReplay.mock.calls[runReplay.mock.calls.length - 1][1].trace;
    expect(digitalTrace.frames.length).toBeGreaterThan(0);
    // Player 1's axis row must not turn the primary's digital move_right into a negative axis.
    expect(digitalTrace.frames[0].actions).toEqual({});
  });

  it('refuses a request with both or neither input source', async () => {
    const both = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { trace: validTrace(), strategy: 'random', playerEntityId: PLAYER },
      playing,
    );
    expect(both.result).toEqual({ success: false, error: REPLAY_NEEDS_ONE_SOURCE });
    const neither = await invokeHandler(playtestHandlers, 'replay_input_trace', { playerEntityId: PLAYER }, playing);
    expect(neither.result).toEqual({ success: false, error: REPLAY_NEEDS_ONE_SOURCE });
    expect(runReplay).not.toHaveBeenCalled();
  });

  it('refuses to replay outside Play mode, as the manual controls do', async () => {
    const { result } = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { trace: validTrace(), playerEntityId: PLAYER },
      { ...playing, engineMode: 'edit' },
    );
    expect(result).toEqual({ success: false, error: REPLAY_REQUIRES_PLAY_MODE });
    expect(runReplay).not.toHaveBeenCalled();
  });

  it('refuses an invalid trace with the recorder\'s own validation text, before touching the engine', async () => {
    const { result } = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { trace: { ...validTrace(), frames: [{ tick: 5, actions: {} }, { tick: 5, actions: {} }] }, playerEntityId: PLAYER },
      playing,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Invalid input trace: /);
    expect(result.error).toContain('duplicate tick 5');
    expect(runReplay).not.toHaveBeenCalled();
  });

  it('reports a runner failure as a tool error instead of throwing', async () => {
    runReplay.mockRejectedValue(new Error('Replay refused: the engine did not accept pin_frame_rate at 60 Hz'));
    const { result } = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { trace: validTrace(), playerEntityId: PLAYER },
      playing,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('pin_frame_rate');
  });

  it('rejects an unknown strategy and a missing player id', async () => {
    const strategy = await invokeHandler(
      playtestHandlers,
      'replay_input_trace',
      { strategy: 'yolo', playerEntityId: PLAYER },
      playing,
    );
    expect(strategy.result.success).toBe(false);
    const player = await invokeHandler(playtestHandlers, 'replay_input_trace', { trace: validTrace() }, playing);
    expect(player.result.success).toBe(false);
  });
});

describe('pin_frame_rate / unpin_frame_rate', () => {
  /** The engine accepted the command — the answer a live engine gives. */
  const accepted = { dispatchResponse: { success: true } };

  it('pins at the default rate when none is given', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', {}, {}, accepted);
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 60 });
  });

  it('pins at an explicit rate inside the engine\'s bounds', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz: 30 }, {}, accepted);
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 30 });
  });

  // 1-3 Hz are refused with the engine: Bevy clamps a step longer than 250 ms,
  // so a pin below 4 Hz could not advance the `1 / hz` it claims.
  it.each([0, 1, 3, 241, 59.5, '60'])('refuses hz=%s before dispatching', async (hz) => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz });
    expect(result.success).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it('unpins', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'unpin_frame_rate', {}, {}, accepted);
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('unpin_frame_rate', {});
  });

  // The raw clock tools are a fourth door past the single-flight guard: a pin
  // or unpin issued while a replay runs would land in the middle of a run
  // that owns the clock. They are refused while a session is active, naming
  // the origin that holds it, and dispatch nothing.
  describe('respect the replay guard', () => {
    it.each(['pin_frame_rate', 'unpin_frame_rate'])(
      '%s is refused while a replay is running, naming the active origin, without dispatching',
      async (tool) => {
        getActiveReplaySession.mockReturnValue({ source: 'manual' });
        const { result, dispatchCommand } = await invokeHandler(playtestHandlers, tool, {}, {}, accepted);
        expect(result.success).toBe(false);
        expect(result.error).toContain(tool);
        expect(result.error).toMatch(/already running/);
        expect(result.error).toContain('manual');
        expect(dispatchCommand).not.toHaveBeenCalled();
      },
    );

    it.each(['pin_frame_rate', 'unpin_frame_rate'])('%s is accepted when no replay is running', async (tool) => {
      getActiveReplaySession.mockReturnValue(null);
      const { result, dispatchCommand } = await invokeHandler(playtestHandlers, tool, {}, {}, accepted);
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledTimes(1);
    });

    it('the pin tool tells the agent what releases the pin, exactly', async () => {
      const { result } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz: 30 }, {}, accepted);
      expect(result.success).toBe(true);
      const message = (result.result as { message: string }).message;
      expect(message).toContain('Stop releases it while Play is running');
      expect(message).toContain('a pin made in Edit mode stays until unpin_frame_rate');
      expect(message).not.toMatch(/never outlives/);
    });
  });

  // The handlers used to answer `success: true` whatever the engine said, so
  // an agent was told its clock was pinned by an engine that had refused.
  describe('report the engine\'s own answer', () => {
    const refused = { success: false, error: 'PendingCommands resource not initialized' };

    it('pin_frame_rate fails when the engine refuses the pin, carrying the engine\'s reason', async () => {
      const { result } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz: 60 }, {}, { dispatchResponse: refused });
      expect(result.success).toBe(false);
      expect(result.error).toContain('pin_frame_rate');
      expect(result.error).toContain('PendingCommands resource not initialized');
    });

    it('unpin_frame_rate fails when the engine refuses the unpin', async () => {
      const { result } = await invokeHandler(playtestHandlers, 'unpin_frame_rate', {}, {}, { dispatchResponse: refused });
      expect(result.success).toBe(false);
      expect(result.error).toContain('unpin_frame_rate');
      expect(result.error).toContain('PendingCommands resource not initialized');
    });

    it.each(['pin_frame_rate', 'unpin_frame_rate'])(
      '%s fails when the dispatcher answers nothing: a stand-in cannot confirm a clock change',
      async (tool) => {
        const { result } = await invokeHandler(playtestHandlers, tool, {}, {}, { dispatchResponse: undefined });
        expect(result.success).toBe(false);
        expect(result.error).toContain(tool);
      },
    );
  });
});
