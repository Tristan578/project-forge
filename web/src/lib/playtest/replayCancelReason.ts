/**
 * Why a replay was cancelled, in the creator's words (#10007).
 *
 * A cancelled run carries a `reason` only when the RUNNER cancelled it on the
 * editor's behalf — Stop, or a Pause or Resume in the editor toolbar that the
 * replay could not follow (`replayRunner.ts`, the engine-mode watch). The
 * creator's own Cancel (the panel's button, a panel unmount,
 * `cancelActiveReplay`, the chat tool) carries none, and the sentence it
 * produces is unchanged. ONE clause, shared by the panel's two cancelled lines
 * and by `ReplayCancelledError`'s message, so no two of them can disagree
 * about what a reason means.
 */

import type { ReplayCancelReason } from './replayRunner';

/**
 * The clause that says why the runner cancelled, ready to drop into
 * "Replay cancelled after N ticks<clause>." — a leading space and the reason,
 * or '' for a creator's own Cancel so that sentence reads exactly as before.
 * @param reason The runner's reason, or undefined for a creator's own Cancel.
 * @returns ' because …', or '' when there is no reason to give.
 */
export function replayCancelReasonClause(reason: ReplayCancelReason | undefined): string {
  switch (reason) {
    case 'engine-stopped':
      return ' because Play was stopped';
    case 'engine-paused':
      return ' because the game was paused from the toolbar';
    case 'engine-resumed':
      return ' because the game was resumed from the toolbar while the replay was paused';
    default:
      return '';
  }
}
