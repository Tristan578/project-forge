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

const runReplay = vi.hoisted(() => vi.fn());
vi.mock('@/lib/playtest/replayEntryPoints', () => ({ runReplay }));

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
    expect(options).toEqual({});
    expect(deps.bindings).toEqual(playing.inputBindings);
    expect(deps.allGameComponents).toEqual(playing.allGameComponents);
    // The dispatcher the replay pins the clock through is the context's.
    deps.dispatch('pin_frame_rate', { hz: 60 });
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 60 });
  });

  it('plans a bot strategy and replays the resulting trace', async () => {
    simulatePlaytest.mockResolvedValue({
      strategy: 'explorer',
      actions: [
        { type: 'move', timestamp: 0, direction: { x: 1, y: 0 } },
        { type: 'wait', timestamp: 500 },
      ],
      duration: 1000,
      outcome: 'completed',
      discoveries: [],
      metrics: { timeToComplete: 1000, deathCount: 0, itemsCollected: 0, areasExplored: 0, backtrackCount: 0 },
    });
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
    const request = runReplay.mock.calls[0][1];
    expect(request.playerEntityId).toBe(PLAYER);
    expect(request.collectibleEntityIds).toBeUndefined();
    // The plan became a trace in the scene's own vocabulary.
    expect(request.trace.actionNames).toEqual(['move_right']);
    expect(request.trace.frames[0].actions).toEqual({ move_right: { pressed: true, axis: 1 } });
    expect(request.trace.frames.length).toBeGreaterThan(0);
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
  it('pins at the default rate when none is given', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', {});
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 60 });
  });

  it('pins at an explicit rate inside the engine\'s bounds', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz: 30 });
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('pin_frame_rate', { hz: 30 });
  });

  it.each([0, 241, 59.5, '60'])('refuses hz=%s before dispatching', async (hz) => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'pin_frame_rate', { hz });
    expect(result.success).toBe(false);
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it('unpins', async () => {
    const { result, dispatchCommand } = await invokeHandler(playtestHandlers, 'unpin_frame_rate', {});
    expect(result.success).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith('unpin_frame_rate', {});
  });
});
