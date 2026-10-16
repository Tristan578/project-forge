/**
 * Caps the transient toasts one import batch can raise for files the
 * browser could not READ.
 *
 * Dropping or picking many files that all fail to read used to raise one
 * toast per file, stacking a wall of identical sentences. A reporter shows
 * the first few by name, sends the rest to the browser console with a
 * prefix, and `finish` adds ONE line saying how many more there were and
 * where the details are.
 *
 * This caps read failures only. A file the engine REFUSED by format is
 * reported by the asset slice as a persistent toast deduped by file
 * (`load_texture-refused:<name>`), and every refused file must stay visible
 * because each carries its own remediation; nothing here touches that path.
 */

import { showError } from '@/lib/toast';

/** How many read failures a batch names in a toast before the rest go to the console. */
export const MAX_DETAILED_BATCH_FAILURES = 3;

export interface BatchFailureReporter {
  /** Show `message` while under the limit; past it, log it with an `[assets]` prefix and count it. */
  report(message: string): void;
  /** Once per batch: if any failures were only counted, one toast says how many and where to look. */
  finish(): void;
}

export function createBatchFailureReporter(limit = MAX_DETAILED_BATCH_FAILURES): BatchFailureReporter {
  let shown = 0;
  let overflow = 0;
  return {
    report(message) {
      if (shown < limit) {
        shown += 1;
        showError(message);
        return;
      }
      overflow += 1;
      console.warn(`[assets] ${message}`);
    },
    finish() {
      if (overflow === 0) return;
      const noun = overflow === 1 ? 'file' : 'files';
      showError(`${overflow} more ${noun} could not be read; details are in the browser console.`);
      // A second finish on the same batch must not repeat the summary.
      overflow = 0;
    },
  };
}
