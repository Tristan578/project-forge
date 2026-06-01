import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { captureException } from '@/lib/monitoring/sentry-server';
import {
  sampledCaptureException,
  SAMPLE_THROTTLE_MS,
  _resetSampledCapture,
} from '../sampledCapture';

const mockCapture = vi.mocked(captureException);

describe('sampledCaptureException', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCapture.mockClear();
    _resetSampledCapture();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards the first failure for an action to captureException and returns true', () => {
    const err = new Error('upstash down');
    const sent = sampledCaptureException('checkDbRateLimit.failOpen', err);
    expect(sent).toBe(true);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(err, { action: 'checkDbRateLimit.failOpen' });
  });

  it('merges extra context under the action tag', () => {
    const err = new Error('boom');
    sampledCaptureException('rateLimit.failOpen', err, { keyPrefix: 'public' });
    expect(mockCapture).toHaveBeenCalledWith(err, {
      action: 'rateLimit.failOpen',
      keyPrefix: 'public',
    });
  });

  it('suppresses repeat captures for the same action within the throttle window (returns false)', () => {
    sampledCaptureException('checkDbRateLimit.failOpen', new Error('1'));
    // A burst of further failures in the same window must NOT each hit Sentry.
    for (let i = 0; i < 50; i++) {
      const sent = sampledCaptureException('checkDbRateLimit.failOpen', new Error(`burst-${i}`));
      expect(sent).toBe(false);
    }
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('throttles each action independently', () => {
    sampledCaptureException('checkDbRateLimit.failOpen', new Error('db'));
    sampledCaptureException('rateLimit.failOpen', new Error('rl'));
    // Two distinct actions → two distinct first-captures.
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('captures again once the throttle window has elapsed', () => {
    sampledCaptureException('checkDbRateLimit.failOpen', new Error('first'));
    expect(mockCapture).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SAMPLE_THROTTLE_MS + 1);

    const sent = sampledCaptureException('checkDbRateLimit.failOpen', new Error('second'));
    expect(sent).toBe(true);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('never propagates a captureException failure to the caller (preserves fail-open)', () => {
    // The whole point of the callers (checkDbRateLimit / rateLimit) is to fail
    // open or degrade when Upstash is down. Reporting that bypass is best-effort:
    // if the Sentry SDK itself throws, it must NOT escape and break the caller's
    // fail-open guarantee.
    mockCapture.mockImplementationOnce(() => {
      throw new Error('Sentry SDK crash');
    });

    let sent: boolean | undefined;
    expect(() => {
      sent = sampledCaptureException('checkDbRateLimit.failOpen', new Error('upstash down'));
    }).not.toThrow();
    // The attempt still counts as forwarded so the throttle window engages.
    expect(sent).toBe(true);

    // The throttle still advanced — a follow-up in the same window is suppressed.
    expect(sampledCaptureException('checkDbRateLimit.failOpen', new Error('again'))).toBe(false);
  });
});
