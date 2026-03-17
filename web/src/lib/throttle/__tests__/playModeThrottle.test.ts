import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayModeThrottle, withPlayModeThrottle } from '../playModeThrottle';

describe('createPlayModeThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('edit mode (isPlayMode = false)', () => {
    it('always allows updates regardless of interval', () => {
      const throttle = createPlayModeThrottle(100);

      expect(throttle.shouldUpdate(false)).toBe(true);
      expect(throttle.shouldUpdate(false)).toBe(true);
      expect(throttle.shouldUpdate(false)).toBe(true);
    });

    it('allows updates even when called at very high frequency', () => {
      const throttle = createPlayModeThrottle(100);

      // Simulate 10 rapid calls with no time elapsed
      for (let i = 0; i < 10; i++) {
        expect(throttle.shouldUpdate(false)).toBe(true);
      }
    });
  });

  describe('play mode (isPlayMode = true)', () => {
    it('allows the first update immediately', () => {
      const throttle = createPlayModeThrottle(100);
      expect(throttle.shouldUpdate(true)).toBe(true);
    });

    it('blocks subsequent updates within the interval', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // first: allowed, sets lastUpdateTime

      vi.advanceTimersByTime(50); // 50ms later — inside window
      expect(throttle.shouldUpdate(true)).toBe(false);
    });

    it('allows an update once the interval has elapsed', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // first allowed

      vi.advanceTimersByTime(100); // exactly at interval boundary
      expect(throttle.shouldUpdate(true)).toBe(true);
    });

    it('allows an update after more than the interval has elapsed', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true);

      vi.advanceTimersByTime(150);
      expect(throttle.shouldUpdate(true)).toBe(true);
    });

    it('resets the timer after an allowed update so the next window starts fresh', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // allowed at t=0
      vi.advanceTimersByTime(100);
      throttle.shouldUpdate(true); // allowed at t=100

      vi.advanceTimersByTime(50); // only 50ms after t=100
      expect(throttle.shouldUpdate(true)).toBe(false);

      vi.advanceTimersByTime(50); // now 100ms after t=100
      expect(throttle.shouldUpdate(true)).toBe(true);
    });

    it('limits updates to the expected rate for 60fps input', () => {
      const throttle = createPlayModeThrottle(100);
      let allowed = 0;

      // Simulate 60fps over 1 second = 60 calls
      for (let i = 0; i < 60; i++) {
        if (throttle.shouldUpdate(true)) {
          allowed++;
        }
        vi.advanceTimersByTime(1000 / 60); // ~16.7ms per frame
      }

      // Should be approximately 10 (one per 100ms window over 1 second)
      // Allow ±1 for floating point rounding
      expect(allowed).toBeGreaterThanOrEqual(9);
      expect(allowed).toBeLessThanOrEqual(11);
    });

    it('respects custom interval values', () => {
      const throttle = createPlayModeThrottle(200); // 5fps

      throttle.shouldUpdate(true);

      vi.advanceTimersByTime(100);
      expect(throttle.shouldUpdate(true)).toBe(false);

      vi.advanceTimersByTime(100); // now at 200ms
      expect(throttle.shouldUpdate(true)).toBe(true);
    });
  });

  describe('reset()', () => {
    it('allows an update immediately after reset even within the throttle window', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // allowed, sets lastUpdateTime

      vi.advanceTimersByTime(50); // still within window
      expect(throttle.shouldUpdate(true)).toBe(false); // blocked

      throttle.reset(); // reset the window

      expect(throttle.shouldUpdate(true)).toBe(true); // now allowed
    });

    it('has no effect in edit mode (already always allowed)', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(false);
      throttle.reset();

      expect(throttle.shouldUpdate(false)).toBe(true);
    });

    it('allows transition back to edit mode to receive immediate updates', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // play mode: allowed
      vi.advanceTimersByTime(50);
      expect(throttle.shouldUpdate(true)).toBe(false); // play mode: blocked

      // Simulated mode transition: caller calls reset() on ENGINE_MODE_CHANGED
      throttle.reset();

      // Back in edit mode: always allowed
      expect(throttle.shouldUpdate(false)).toBe(true);
    });
  });

  describe('mode transitions mid-stream', () => {
    it('switches from throttled to unthrottled when mode changes to edit', () => {
      const throttle = createPlayModeThrottle(100);

      throttle.shouldUpdate(true); // play mode: first allowed
      vi.advanceTimersByTime(10);
      expect(throttle.shouldUpdate(true)).toBe(false); // still throttled

      // Mode changes to edit — no reset needed, edit mode bypasses throttle
      expect(throttle.shouldUpdate(false)).toBe(true); // edit: always allowed
    });

    it('reapplies throttle when mode changes back to play', () => {
      const throttle = createPlayModeThrottle(100);

      // Start in edit mode
      expect(throttle.shouldUpdate(false)).toBe(true);

      // Switch to play mode
      throttle.reset();
      expect(throttle.shouldUpdate(true)).toBe(true); // first allowed after reset

      vi.advanceTimersByTime(10);
      expect(throttle.shouldUpdate(true)).toBe(false); // throttled
    });
  });
});

describe('withPlayModeThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the handler and returns its value when shouldUpdate is true', () => {
    const handler = vi.fn((_a: string, _b: number) => true);
    const throttle = createPlayModeThrottle(100);
    const wrapped = withPlayModeThrottle(handler, throttle, false); // edit mode

    const result = wrapped('arg1', 42);

    expect(handler).toHaveBeenCalledWith('arg1', 42);
    expect(result).toBe(true);
  });

  it('skips the handler and returns false when throttled in play mode', () => {
    const handler = vi.fn(() => true);
    const throttle = createPlayModeThrottle(100);

    // Use up the first allowed update
    throttle.shouldUpdate(true);

    vi.advanceTimersByTime(10); // within window
    const wrapped = withPlayModeThrottle(handler, throttle, true); // play mode

    const result = wrapped();

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('passes all arguments through to the handler', () => {
    const handler = vi.fn((_a: string, _b: number, _c: boolean) => 'ok');
    const throttle = createPlayModeThrottle(100);
    const wrapped = withPlayModeThrottle(handler, throttle, false);

    wrapped('hello', 42, true);

    expect(handler).toHaveBeenCalledWith('hello', 42, true);
  });

  it('returns the correct handler return value', () => {
    const handler = vi.fn(() => ({ success: true, data: [1, 2, 3] }));
    const throttle = createPlayModeThrottle(100);
    const wrapped = withPlayModeThrottle(handler, throttle, false);

    const result = wrapped();

    expect(result).toEqual({ success: true, data: [1, 2, 3] });
  });
});
