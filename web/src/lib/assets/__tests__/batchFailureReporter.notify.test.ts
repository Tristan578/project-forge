/**
 * The reporter's toasts are best-effort (#10396 round 4 minors): a throw
 * from the toast layer is logged and the rest of the batch is still shown,
 * never propagated into the import handler's finally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchFailureReporter } from '../batchFailureReporter';

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

import { showError } from '@/lib/toast';

describe('createBatchFailureReporter: a throwing toast layer', () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finish() does not throw when the first toast throws, still shows the others, and logs the failure', () => {
    vi.mocked(showError).mockImplementationOnce(() => {
      throw new Error('toast layer down');
    });
    const reporter = createBatchFailureReporter();
    reporter.report('first');
    reporter.report('second');

    expect(() => reporter.finish()).not.toThrow();

    expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual(['first', 'second']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('[assets] could not show a toast');
  });

  it('the summary is best-effort too', () => {
    const reporter = createBatchFailureReporter();
    for (const m of ['a', 'b', 'c', 'd']) reporter.report(m);
    // The two named toasts succeed; the summary (third call) throws.
    vi.mocked(showError)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('toast layer down');
      });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => reporter.finish()).not.toThrow();
    expect(showError).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
