/**
 * Caps the transient toasts one import batch can raise for files that
 * could not be read, or that the store threw on while handing them to the
 * engine. Both are "failed to import" to the person, which is what the
 * summary says; the named toasts carry the precise sentence for each.
 *
 * Dropping or picking many files that all fail used to raise one toast per
 * file, stacking a wall of identical sentences. The cap is the toast STACK:
 * the app's `<Toaster>` (`web/src/app/layout.tsx`) takes sonner's default
 * of three visible toasts (`VISIBLE_TOASTS_AMOUNT`), so a fourth transient
 * toast pushes the first out of view for its whole 4 s life - a named file
 * the person never saw. So a batch raises at most `MAX_BATCH_TOASTS`: with
 * that many failures or fewer, each is named; with more, the first
 * `MAX_DETAILED_BATCH_FAILURES` are named, every other goes to the browser
 * console with an `[assets]` prefix, and the last slot is ONE line saying
 * how many more there were and where the details are.
 *
 * That decision needs the whole batch, so `report` only collects and
 * `finish` shows: a batch of three names all three, a batch of four names
 * two and summarises two, and nothing is shown before the batch is done.
 *
 * This caps the editor's own failures only. A file the engine REFUSED by
 * format is reported by the asset slice as a persistent toast deduped by
 * file (`load_texture-refused:<name>`), and every refused file must stay
 * visible because each carries its own remediation; nothing here touches
 * that path.
 */

import { showError } from '@/lib/toast';

/**
 * Notifications are best-effort (the repo convention `editorStore` follows):
 * a throw from the toast layer is logged, never propagated into the import
 * loop or the caller's finally.
 */
function notify(message: string): void {
  try {
    showError(message);
  } catch (error) {
    console.error('[assets] could not show a toast', error);
  }
}

/** The most transient toasts one batch raises: sonner's default visible stack. */
export const MAX_BATCH_TOASTS = 3;

/** Named toasts shown when a batch overflows the stack; the remaining slot is the summary. */
export const MAX_DETAILED_BATCH_FAILURES = MAX_BATCH_TOASTS - 1;

export interface BatchFailureReporter {
  /** Collect `message`; nothing is shown until `finish`. */
  report(message: string): void;
  /** Once per batch: show every failure by name, or the first few plus one summary when there are too many for the stack. */
  finish(): void;
}

export function createBatchFailureReporter(): BatchFailureReporter {
  const failures: string[] = [];
  let finished = false;
  return {
    report(message) {
      failures.push(message);
    },
    finish() {
      // A second finish on the same batch must not repeat anything.
      if (finished) return;
      finished = true;
      if (failures.length <= MAX_BATCH_TOASTS) {
        for (const message of failures) notify(message);
        return;
      }
      const named = failures.slice(0, MAX_DETAILED_BATCH_FAILURES);
      const counted = failures.slice(MAX_DETAILED_BATCH_FAILURES);
      for (const message of named) notify(message);
      for (const message of counted) console.warn(`[assets] ${message}`);
      // Always plural: the summary takes the slot a named toast would have
      // had, so it is only raised when at least two failures were counted
      // (overflow means more than the stack; the stack minus one are named).
      // "failed to import" covers every message this reporter carries: an
      // unreadable file and a file the store threw on after reading it.
      notify(`${counted.length} more files failed to import; details are in the browser console.`);
    },
  };
}
