/**
 * Tests for the wait-helpers test utility module.
 *
 * These helpers underpin flake-avoidance in other suites (waitFor polling,
 * sleep/nextTick delays, fake-timer advancement) but had zero coverage of
 * their own. Each test asserts real timing/resolution behaviour, not just
 * that the functions can be imported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor, sleep, nextTick, advanceTimersByTime } from '../wait-helpers';

describe('wait-helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('waitFor', () => {
    it('resolves as soon as the condition becomes true', async () => {
      let calls = 0;
      const condition = () => {
        calls += 1;
        return calls >= 3;
      };

      await waitFor(condition, { interval: 1 });

      expect(calls).toBe(3);
    });

    it('awaits a condition that returns a promise rather than a bare boolean', async () => {
      // A promise is always truthy, so a waitFor that forgot to await its
      // condition would resolve on the first poll. Counting the polls is what
      // makes that failure visible: it would read 1 instead of 3.
      let polls = 0;
      const condition = async () => {
        polls += 1;
        return polls >= 3;
      };

      await waitFor(condition, { interval: 1, timeout: 500 });

      expect(polls).toBe(3);
    });

    it('throws the given message when the timeout elapses first', async () => {
      await expect(
        waitFor(() => false, { interval: 1, timeout: 20, message: 'never happened' })
      ).rejects.toThrow('never happened');
    });

    it('throws the default message when none is supplied', async () => {
      await expect(waitFor(() => false, { interval: 1, timeout: 20 })).rejects.toThrow(
        'Condition not met in time'
      );
    });
  });

  describe('sleep', () => {
    it('resolves only after the requested delay has elapsed', async () => {
      const start = Date.now();
      await sleep(15);
      expect(Date.now() - start).toBeGreaterThanOrEqual(10);
    });
  });

  describe('nextTick', () => {
    it('resolves and lets a queued microtask/macrotask run first', async () => {
      const order: string[] = [];
      order.push('before');
      const tick = nextTick().then(() => order.push('tick'));
      order.push('after-schedule');
      await tick;
      expect(order).toEqual(['before', 'after-schedule', 'tick']);
    });
  });

  describe('advanceTimersByTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('fires a pending fake timer and lets its callback run', async () => {
      const spy = vi.fn();
      // Not a sleep: this suite's subject IS timer advancement, so a real
      // pending timer is the fixture under test, not a source of flake.
      // eslint-disable-next-line no-restricted-syntax -- fixture for advanceTimersByTime
      setTimeout(spy, 1000);

      expect(spy).not.toHaveBeenCalled();

      // advanceTimersByTime() fires the 1000ms timer synchronously as part of
      // vi.advanceTimersByTime(), then awaits its own internal nextTick()
      // (a real setTimeout(0) under fake timers) before resolving — flush
      // that with runAllTimersAsync so the returned promise settles.
      const settled = advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
      await settled;
    });
  });
});
