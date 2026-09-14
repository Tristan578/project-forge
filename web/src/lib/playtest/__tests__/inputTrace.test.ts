/**
 * #9902 (qa.FR-1.OP-01) — bounded input-trace schema + recorder.
 *
 * Proves the schema validates real traces, ENFORCES the 30 s / 120-tick bounds
 * (rejecting anything past them), and that the recorder caps itself at capture
 * time from the play-tick bus.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseInputTrace,
  safeParseInputTrace,
  InputTraceValidationError,
  InputTraceRecorder,
  MAX_TRACE_TICKS,
  MAX_TRACE_DURATION_MS,
  INPUT_TRACE_VERSION,
  type InputTrace,
} from '../inputTrace';
import { publishPlayTick, resetPlayTickBus } from '../playTickBus';

function validTrace(overrides: Partial<InputTrace> = {}): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: 'minimal-2d-replay',
    actionNames: ['move_right', 'jump'],
    durationMs: 2_000,
    frames: [
      { tick: 0, actions: { move_right: { pressed: true } } },
      { tick: 1, actions: { move_right: { pressed: true }, jump: { pressed: true } } },
    ],
    ...overrides,
  };
}

describe('inputTrace schema validation', () => {
  it('accepts a well-formed trace and returns it typed', () => {
    const trace = parseInputTrace(validTrace());
    expect(trace.frames).toHaveLength(2);
    expect(trace.frames[1].actions.jump.pressed).toBe(true);
  });

  it('rejects an unknown version', () => {
    expect(() => parseInputTrace(validTrace({ version: 2 as unknown as 1 }))).toThrow(
      InputTraceValidationError,
    );
  });

  it('rejects an action not in the declared vocabulary', () => {
    const bad = validTrace({
      frames: [{ tick: 0, actions: { fly: { pressed: true } } }],
    });
    const result = safeParseInputTrace(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('not in the trace');
  });

  it('rejects frames that are not strictly tick-ordered', () => {
    const bad = validTrace({
      frames: [
        { tick: 5, actions: { move_right: { pressed: true } } },
        { tick: 2, actions: { move_right: { pressed: true } } },
      ],
    });
    expect(safeParseInputTrace(bad).success).toBe(false);
  });

  it('rejects a duplicate tick', () => {
    const bad = validTrace({
      frames: [
        { tick: 3, actions: { move_right: { pressed: true } } },
        { tick: 3, actions: { jump: { pressed: true } } },
      ],
    });
    expect(safeParseInputTrace(bad).success).toBe(false);
  });
});

describe('inputTrace bound enforcement', () => {
  it('accepts exactly 120 frames on ticks 0..119', () => {
    const frames = Array.from({ length: MAX_TRACE_TICKS }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true } },
    }));
    expect(() => parseInputTrace(validTrace({ frames }))).not.toThrow();
  });

  it('rejects a 121st frame (over the 120-tick cap)', () => {
    const frames = Array.from({ length: MAX_TRACE_TICKS + 1 }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true } },
    }));
    expect(safeParseInputTrace(validTrace({ frames })).success).toBe(false);
  });

  it('rejects a tick index at or past the 120-tick bound', () => {
    const bad = validTrace({
      frames: [{ tick: MAX_TRACE_TICKS, actions: { move_right: { pressed: true } } }],
    });
    expect(safeParseInputTrace(bad).success).toBe(false);
  });

  it('rejects a duration past the 30-second bound', () => {
    const bad = validTrace({ durationMs: MAX_TRACE_DURATION_MS + 1 });
    expect(safeParseInputTrace(bad).success).toBe(false);
  });

  it('accepts a duration exactly at the 30-second bound', () => {
    expect(() =>
      parseInputTrace(validTrace({ durationMs: MAX_TRACE_DURATION_MS })),
    ).not.toThrow();
  });
});

describe('InputTraceRecorder', () => {
  beforeEach(() => {
    resetPlayTickBus();
  });

  it('captures per-tick named actions from the play-tick bus', () => {
    const recorder = new InputTraceRecorder('minimal-2d-replay', ['move_right', 'jump']);
    recorder.start();
    publishPlayTick({
      entities: {},
      inputState: { pressed: { move_right: true }, axes: {} },
      elapsedMs: 16,
    });
    publishPlayTick({
      entities: {},
      inputState: { pressed: { move_right: true, jump: true }, axes: {} },
      elapsedMs: 32,
    });
    const trace = recorder.stop();
    expect(trace.frames).toHaveLength(2);
    expect(trace.frames[0].actions).toEqual({ move_right: { pressed: true } });
    expect(trace.frames[1].actions.jump.pressed).toBe(true);
    expect(trace.durationMs).toBe(32);
  });

  it('records an axis value when the engine reports a nonzero axis', () => {
    const recorder = new InputTraceRecorder('fx', ['move_horizontal']);
    recorder.start();
    publishPlayTick({
      entities: {},
      inputState: { pressed: {}, axes: { move_horizontal: 1 } },
      elapsedMs: 16,
    });
    const trace = recorder.stop();
    expect(trace.frames[0].actions.move_horizontal.axis).toBe(1);
  });

  it('skips input-free ticks but keeps tick indices aligned to engine frames', () => {
    const recorder = new InputTraceRecorder('fx', ['move_right']);
    recorder.start();
    publishPlayTick({ entities: {}, inputState: { pressed: {}, axes: {} }, elapsedMs: 16 });
    publishPlayTick({
      entities: {},
      inputState: { pressed: { move_right: true }, axes: {} },
      elapsedMs: 32,
    });
    const trace = recorder.stop();
    expect(trace.frames).toHaveLength(1);
    // Tick 0 was consumed by the input-free frame, so the recorded frame is tick 1.
    expect(trace.frames[0].tick).toBe(1);
  });

  it('stops capturing at the 120-tick bound', () => {
    const recorder = new InputTraceRecorder('fx', ['move_right']);
    recorder.start();
    for (let i = 0; i < MAX_TRACE_TICKS + 10; i += 1) {
      publishPlayTick({
        entities: {},
        inputState: { pressed: { move_right: true }, axes: {} },
        elapsedMs: (i + 1) * 16,
      });
    }
    expect(recorder.isRecording()).toBe(false);
    expect(recorder.ticksCaptured()).toBe(MAX_TRACE_TICKS);
    const trace = recorder.stop();
    expect(trace.frames.length).toBeLessThanOrEqual(MAX_TRACE_TICKS);
  });

  it('stops capturing once elapsed wall-clock passes the 30-second bound', () => {
    const recorder = new InputTraceRecorder('fx', ['move_right']);
    recorder.start();
    publishPlayTick({
      entities: {},
      inputState: { pressed: { move_right: true }, axes: {} },
      elapsedMs: MAX_TRACE_DURATION_MS + 1,
    });
    expect(recorder.isRecording()).toBe(false);
    expect(recorder.stop().frames).toHaveLength(0);
  });
});
