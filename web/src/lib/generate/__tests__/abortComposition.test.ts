import { describe, it, expect } from 'vitest';
import { composeAbortSignal } from '../abortComposition';

describe('composeAbortSignal', () => {
  it('returns a timeout-only signal when external is undefined', () => {
    const signal = composeAbortSignal(undefined, 5000);
    expect(signal).toBeInstanceOf(AbortSignal);
    // A fresh timeout signal should not be immediately aborted
    expect(signal.aborted).toBe(false);
  });

  it('returns an already-aborted signal when external is pre-aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('already done'));
    const signal = composeAbortSignal(controller.signal, 5000);
    expect(signal.aborted).toBe(true);
  });

  it('aborts with the external reason when external fires before the timeout', () => {
    const controller = new AbortController();
    const reason = new Error('deadline exceeded');
    const signal = composeAbortSignal(controller.signal, 60_000);

    expect(signal.aborted).toBe(false);
    controller.abort(reason);
    // AbortSignal.any propagates the reason of the first signal to fire
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });
});
