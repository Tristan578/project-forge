import { describe, it, expect, vi, afterEach } from 'vitest';
import { retryWithBackoff } from '../retryWithBackoff';

afterEach(() => {
  vi.restoreAllMocks();
});

// Stub setTimeout so tests run instantly without actually sleeping.
// We replace it with a synchronous no-op while recording the delays.
function stubSleep(delays: number[]) {
  return vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb, delay) => {
    delays.push(delay as number);
    // Run callback synchronously so tests don't need fake-timer gymnastics
    (cb as () => void)();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
}

describe('retryWithBackoff', () => {
  it('returns the value immediately when the function succeeds on the first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure and returns on the second attempt', async () => {
    const delays: number[] = [];
    stubSleep(delays);

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 100, jitter: false });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it('throws the last error after all attempts are exhausted', async () => {
    stubSleep([]);

    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error('persistent failure');
    });

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 100, jitter: false }),
    ).rejects.toThrow('persistent failure');

    expect(callCount).toBe(3);
  });

  it('respects the maxDelayMs cap', async () => {
    const delays: number[] = [];
    stubSleep(delays);

    const fn = vi.fn().mockImplementation(async () => {
      throw new Error('fail');
    });

    await retryWithBackoff(fn, {
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 2000,
      jitter: false,
    }).catch(() => {});

    // Attempt 0→1: 1000ms, Attempt 1→2: 2000ms (capped), Attempt 2→3: 2000ms (capped)
    expect(delays).toHaveLength(3);
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(2000);
    }
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(2000);
  });

  it('jitter varies the delay by ±25%', async () => {
    const seenDelays: number[] = [];
    stubSleep(seenDelays);

    // Run multiple retries to collect jittered delay values
    for (let i = 0; i < 20; i++) {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      await retryWithBackoff(fn, { maxAttempts: 2, baseDelayMs: 1000, jitter: true });
    }

    // All delays should be within the ±25% window of 1000ms
    for (const d of seenDelays) {
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }

    // There should be variance — not every delay is identical
    const unique = new Set(seenDelays.map((d) => Math.round(d)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('uses default options when none are provided', async () => {
    stubSleep([]);

    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error('fail');
    });

    await retryWithBackoff(fn).catch(() => {});

    // Default maxAttempts = 3
    expect(callCount).toBe(3);
  });
});
