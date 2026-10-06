/**
 * #10007 — the AI gameplay bot's plan becomes the same bounded `InputTrace` a
 * human recording produces, deterministically and within the schema's bounds.
 */
import { describe, it, expect } from 'vitest';
import { simulatePlaytest, type BotAction } from '@/lib/ai/gameplayBot';
import { botSessionToInputTrace, namedActionsForBotAction, BOT_TRACE_TICK_HZ } from '../botTrace';
import { MAX_TRACE_TICKS, MAX_TRACE_DURATION_MS, parseInputTrace } from '../inputTrace';

const AXIS_SCENE = ['move_right', 'move_forward', 'jump'];
const DIGITAL_SCENE = ['move_right', 'move_left', 'move_forward', 'move_backward', 'jump'];

function move(timestamp: number, x: number, y: number): BotAction {
  return { type: 'move', timestamp, direction: { x, y } };
}

describe('namedActionsForBotAction', () => {
  it('maps a rightward move to move_right with the axis magnitude', () => {
    expect(namedActionsForBotAction(move(0, 0.8, 0), AXIS_SCENE)).toEqual({
      move_right: { pressed: true, axis: 0.8 },
    });
  });

  it('maps a leftward move to move_left when the scene binds it, else to a negative move_right axis', () => {
    expect(namedActionsForBotAction(move(0, -0.5, 0), DIGITAL_SCENE)).toEqual({
      move_left: { pressed: true, axis: 0.5 },
    });
    expect(namedActionsForBotAction(move(0, -0.5, 0), AXIS_SCENE)).toEqual({
      move_right: { pressed: true, axis: -0.5 },
    });
  });

  it('maps the y component to move_forward / move_backward the same way', () => {
    expect(namedActionsForBotAction(move(0, 0, 1), AXIS_SCENE)).toEqual({
      move_forward: { pressed: true, axis: 1 },
    });
    expect(namedActionsForBotAction(move(0, 0, -1), DIGITAL_SCENE)).toEqual({
      move_backward: { pressed: true, axis: 1 },
    });
  });

  it('drops names the scene does not bind, and ignores dead-zone components', () => {
    expect(namedActionsForBotAction(move(0, -1, 0), ['move_right_only_is_not_a_name'])).toEqual({});
    expect(namedActionsForBotAction(move(0, 0.001, 0.005), DIGITAL_SCENE)).toEqual({});
    expect(namedActionsForBotAction({ type: 'jump', timestamp: 0 }, ['move_right'])).toEqual({});
  });

  it('clamps an overlong direction to a unit axis', () => {
    expect(namedActionsForBotAction(move(0, 3, 0), AXIS_SCENE)).toEqual({
      move_right: { pressed: true, axis: 1 },
    });
  });

  it('gives wait / interact / attack / use_item no engine input', () => {
    for (const type of ['wait', 'interact', 'attack', 'use_item'] as const) {
      expect(namedActionsForBotAction({ type, timestamp: 0, target: 'e1' }, DIGITAL_SCENE)).toEqual({});
    }
  });
});

describe('botSessionToInputTrace', () => {
  const fixtureId = 'minimal-2d-replay';

  it('holds a move until the next action and taps a jump for one tick', () => {
    const trace = botSessionToInputTrace(
      { actions: [move(0, 1, 0), { type: 'jump', timestamp: 100 }, { type: 'wait', timestamp: 200 }] },
      { fixtureId, actionNames: DIGITAL_SCENE, msPerTick: 50 },
    );
    // 0..300 ms at 50 ms per tick = 6 ticks.
    expect(trace.frames.map((f) => Object.keys(f.actions))).toEqual([
      ['move_right'],
      ['move_right'],
      ['jump'],
      [],
      [],
      [],
    ]);
    expect(trace.frames.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('spans the whole plan across the 120-tick bound by default', () => {
    const actions: BotAction[] = Array.from({ length: 120 }, (_, i) => move(i * 500, 1, 0));
    const trace = botSessionToInputTrace({ actions }, { fixtureId, actionNames: AXIS_SCENE });
    expect(trace.frames).toHaveLength(MAX_TRACE_TICKS);
    expect(trace.durationMs).toBeLessThanOrEqual(MAX_TRACE_DURATION_MS);
    expect(trace.durationMs).toBe(Math.round(MAX_TRACE_TICKS * (1000 / BOT_TRACE_TICK_HZ)));
    // The last planned action (at 59.5 s) is reached, not truncated away.
    expect(trace.frames[trace.frames.length - 1].actions).toEqual({
      move_right: { pressed: true, axis: 1 },
    });
  });

  it('never samples finer than one real frame', () => {
    const trace = botSessionToInputTrace(
      { actions: [move(0, 1, 0), move(5, -1, 0)] },
      { fixtureId, actionNames: DIGITAL_SCENE, msPerTick: 1 },
    );
    // 5 ms + one frame of tail, at >= 16.67 ms per tick, is two ticks.
    expect(trace.frames).toHaveLength(2);
  });

  it('produces a trace that passes the shared validation gate', () => {
    const trace = botSessionToInputTrace(
      { actions: [move(0, 0.3, -0.9), { type: 'interact', timestamp: 500, target: 'x' }] },
      { fixtureId, actionNames: DIGITAL_SCENE },
    );
    expect(() => parseInputTrace(trace)).not.toThrow();
    expect(trace.fixtureId).toBe(fixtureId);
    expect(trace.actionNames).toEqual(DIGITAL_SCENE);
  });

  it('an empty plan converts to an empty, valid trace', () => {
    const trace = botSessionToInputTrace({ actions: [] }, { fixtureId, actionNames: AXIS_SCENE });
    expect(trace.frames).toEqual([]);
    expect(trace.durationMs).toBe(0);
  });

  it('drops malformed timestamps instead of producing an unordered trace', () => {
    const trace = botSessionToInputTrace(
      { actions: [move(Number.NaN, 1, 0), move(-10, 1, 0), move(0, 1, 0)] },
      { fixtureId, actionNames: AXIS_SCENE, msPerTick: 50 },
    );
    expect(trace.frames.length).toBeGreaterThan(0);
    expect(trace.frames.every((f) => Object.keys(f.actions).length === 1)).toBe(true);
  });

  it('converts a real bot session deterministically', async () => {
    const ctx = { sceneGraph: { nodes: {}, rootIds: [] }, gameComponents: {}, projectType: '2d' as const };
    const session = await simulatePlaytest(ctx, 'explorer');
    const a = botSessionToInputTrace(session, { fixtureId, actionNames: DIGITAL_SCENE });
    const b = botSessionToInputTrace(session, { fixtureId, actionNames: DIGITAL_SCENE });
    expect(a).toEqual(b);
    expect(a.frames.length).toBeGreaterThan(0);
    expect(a.frames.length).toBeLessThanOrEqual(MAX_TRACE_TICKS);
    expect(a.frames.some((f) => Object.keys(f.actions).length > 0)).toBe(true);
  });
});
