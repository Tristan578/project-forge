'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplayProgress, ReplayRunState } from '@/lib/playtest/replayRunner';

/**
 * How often tick progress is read out while the state stays the same. State
 * changes (pinning → running, paused, cancelling) are announced immediately.
 */
export const REPLAY_ANNOUNCE_INTERVAL_MS = 1000;

/**
 * The progress line a replay shows while it runs: state, tick position, clock.
 * Shared by the visible line and the screen-reader announcement so the two
 * never disagree.
 * @param progress The runner's latest progress snapshot.
 * @returns One sentence a creator (or a screen reader) can read.
 */
export function replayStatusText(progress: ReplayProgress): string {
  const clock = progress.pinned === true ? ' on the pinned clock' : '';
  switch (progress.state) {
    case 'pinning':
      return 'Pinning the engine clock…';
    case 'running':
      return `Replaying tick ${progress.tick} of ${progress.totalTicks}${clock}`;
    case 'pausing':
      return `Pausing at tick ${progress.tick}…`;
    case 'paused':
      return `Paused at tick ${progress.tick} of ${progress.totalTicks}; input released`;
    case 'cancelling':
      return 'Cancelling and releasing input…';
    default:
      return progress.state;
  }
}

/**
 * The screen-reader announcement for a running replay (#10007, review-board m6).
 *
 * The visible progress line updates on every tick — up to 60 times a second.
 * Making THAT line the live region turned a replay into a continuous stream of
 * "Replaying tick N" announcements, which is worse for a screen-reader user
 * than no announcement at all. This visually hidden region announces every
 * STATE change at once (that is what a creator is waiting to hear) and tick
 * progress at most once per `REPLAY_ANNOUNCE_INTERVAL_MS`, trailing-edge, so
 * the most recent position is always the one read out; the visible line
 * stays live on its own, without a live role.
 * @param props.progress The runner's latest progress snapshot.
 * @returns A polite, visually hidden status region.
 */
export function ReplayLiveRegion({ progress }: { progress: ReplayProgress }) {
  const text = replayStatusText(progress);
  const [announced, setAnnounced] = useState(text);
  /**
   * The state and time of the last announcement; read and written in effects
   * only. `null` / 0 means nothing has been announced yet, so the mount effect
   * records the initial announcement without reading the clock during render.
   */
  const last = useRef<{ state: ReplayRunState | null; at: number }>({ state: null, at: 0 });
  /** The newest text, so a trailing announcement reads the latest position. */
  const latest = useRef(text);

  useEffect(() => {
    latest.current = text;
    const now = Date.now();
    const sinceLast = now - last.current.at;
    if (progress.state !== last.current.state || sinceLast >= REPLAY_ANNOUNCE_INTERVAL_MS) {
      last.current = { state: progress.state, at: now };
      setAnnounced(text);
      return undefined;
    }
    // Held back: announce the latest position once the interval has elapsed
    // since the last announcement. Re-running this effect on every tick
    // re-arms the same deadline, so a burst is announced exactly once.
    const timer = setTimeout(() => {
      last.current = { state: progress.state, at: Date.now() };
      setAnnounced(latest.current);
    }, REPLAY_ANNOUNCE_INTERVAL_MS - sinceLast);
    return () => clearTimeout(timer);
  }, [text, progress.state]);

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {announced}
    </span>
  );
}
