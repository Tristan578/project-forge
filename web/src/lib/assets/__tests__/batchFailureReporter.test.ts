/**
 * The per-batch cap on failure toasts. A batch raises at most the toast
 * stack (three): that many failures or fewer are each named; more, and the
 * first two are named, the rest go to the console, and one summary takes
 * the third slot. `report` only collects; `finish` decides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBatchFailureReporter,
  MAX_BATCH_TOASTS,
  MAX_DETAILED_BATCH_FAILURES,
} from '../batchFailureReporter';

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

import { showError } from '@/lib/toast';

/** `n` distinct read-failure sentences, numbered so order is checkable. */
function messages(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Failed to read file "broken${i + 1}.png". The file may be corrupted or inaccessible.`);
}

const shown = () => vi.mocked(showError).mock.calls.map(([m]) => m);

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('createBatchFailureReporter', () => {
  let warn: ReturnType<typeof spyWarn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = spyWarn();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("the cap is sonner's visible stack of three, and the summary takes one of those slots", () => {
    expect(MAX_BATCH_TOASTS).toBe(3);
    expect(MAX_DETAILED_BATCH_FAILURES).toBe(2);
  });

  it('report shows nothing; finish shows the collected failures in order', () => {
    const reporter = createBatchFailureReporter();
    const [m1, m2] = messages(2);

    reporter.report(m1!);
    reporter.report(m2!);
    expect(showError).not.toHaveBeenCalled();

    reporter.finish();

    expect(shown()).toEqual([m1, m2]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('three failures are each named, with no summary and nothing in the console', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(3)) reporter.report(m);

    reporter.finish();

    expect(shown()).toEqual(messages(3));
    expect(warn).not.toHaveBeenCalled();
  });

  it('four failures: the first two are named, the other two go to the console with the [assets] prefix, and one summary counts them', () => {
    const reporter = createBatchFailureReporter();
    const [m1, m2, m3, m4] = messages(4);
    for (const m of [m1, m2, m3, m4]) reporter.report(m!);

    reporter.finish();

    expect(shown()).toEqual([m1, m2, '2 more files failed to import; details are in the browser console.']);
    expect(warn.mock.calls).toEqual([[`[assets] ${m3}`], [`[assets] ${m4}`]]);
  });

  it('five failures: still two named and one summary, now counting three', () => {
    const reporter = createBatchFailureReporter();
    const [m1, m2, m3, m4, m5] = messages(5);
    for (const m of [m1, m2, m3, m4, m5]) reporter.report(m!);

    reporter.finish();

    expect(shown()).toEqual([m1, m2, '3 more files failed to import; details are in the browser console.']);
    expect(warn.mock.calls).toEqual([[`[assets] ${m3}`], [`[assets] ${m4}`], [`[assets] ${m5}`]]);
  });

  it('no batch of any size raises more than the stack', () => {
    for (let n = 0; n <= 10; n++) {
      vi.clearAllMocks();
      const reporter = createBatchFailureReporter();
      for (const m of messages(n)) reporter.report(m);

      reporter.finish();

      expect(showError, `${n} failures`).toHaveBeenCalledTimes(Math.min(n, MAX_BATCH_TOASTS));
      expect(warn, `${n} failures`).toHaveBeenCalledTimes(n > MAX_BATCH_TOASTS ? n - MAX_DETAILED_BATCH_FAILURES : 0);
    }
  });

  it('a second finish on the same batch repeats nothing', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(4)) reporter.report(m);

    reporter.finish();
    reporter.finish();

    expect(showError).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a report after finish is dropped, not shown late', () => {
    const reporter = createBatchFailureReporter();
    reporter.finish();

    reporter.report(messages(1)[0]!);
    reporter.finish();

    expect(showError).not.toHaveBeenCalled();
  });

  it('a batch with no failures at all shows nothing', () => {
    createBatchFailureReporter().finish();

    expect(showError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
