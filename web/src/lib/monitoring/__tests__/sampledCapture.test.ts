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
});
