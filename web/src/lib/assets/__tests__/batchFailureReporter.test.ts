/**
 * The per-batch cap on read-failure toasts: the first few are shown by name,
 * the rest go to the console and are summarised once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBatchFailureReporter, MAX_DETAILED_BATCH_FAILURES } from '../batchFailureReporter';

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

  it('names three files by default', () => {
    expect(MAX_DETAILED_BATCH_FAILURES).toBe(3);
  });

  it('shows the first three verbatim; the fourth and fifth go to the console with the [assets] prefix', () => {
    const reporter = createBatchFailureReporter();
    const [m1, m2, m3, m4, m5] = messages(5);

    for (const m of [m1, m2, m3, m4, m5]) reporter.report(m!);

    expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual([m1, m2, m3]);
    expect(warn.mock.calls).toEqual([[`[assets] ${m4}`], [`[assets] ${m5}`]]);
  });

  it('finish shows exactly one summary naming how many were only counted', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(5)) reporter.report(m);

    reporter.finish();

    expect(showError).toHaveBeenCalledTimes(4);
    expect(showError).toHaveBeenLastCalledWith('2 more files could not be read; details are in the browser console.');
  });

  it('one counted failure reads as one file', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(4)) reporter.report(m);

    reporter.finish();

    expect(showError).toHaveBeenLastCalledWith('1 more file could not be read; details are in the browser console.');
  });

  it('finish with no overflow shows nothing', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(2)) reporter.report(m);

    reporter.finish();

    expect(showError).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a limit exactly reached shows no summary', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(3)) reporter.report(m);

    reporter.finish();

    expect(showError).toHaveBeenCalledTimes(3);
    expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual(messages(3));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a second finish on the same batch repeats nothing', () => {
    const reporter = createBatchFailureReporter();
    for (const m of messages(4)) reporter.report(m);

    reporter.finish();
    reporter.finish();

    expect(showError).toHaveBeenCalledTimes(4);
  });

  it('honours a caller-chosen limit', () => {
    const reporter = createBatchFailureReporter(1);
    const [m1, m2, m3] = messages(3);

    for (const m of [m1, m2, m3]) reporter.report(m!);
    reporter.finish();

    expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual([
      m1,
      '2 more files could not be read; details are in the browser console.',
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a batch with no failures at all shows nothing', () => {
    createBatchFailureReporter().finish();

    expect(showError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
