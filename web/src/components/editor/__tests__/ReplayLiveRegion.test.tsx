/** @vitest-environment jsdom */
/**
 * #10007 (review-board m6) — the replay progress announcement.
 *
 * The visible progress line changes on every tick (up to 60/s). Read out
 * verbatim by a screen reader that would be a continuous stream; a live region
 * that re-announces every 16 ms is worse than none. The announcer therefore
 * announces STATE changes immediately and tick progress at most about once
 * per second, trailing-edge, so the last position is always announced; the
 * visible text (rendered elsewhere, without a live role) stays live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@/test/utils/componentTestUtils';
import type { ReplayProgress } from '@/lib/playtest/replayRunner';
import { REPLAY_ANNOUNCE_INTERVAL_MS, ReplayLiveRegion, replayStatusText } from '../ReplayLiveRegion';

function progress(over: Partial<ReplayProgress> = {}): ReplayProgress {
  return { state: 'running', tick: 0, totalTicks: 120, heldKeys: [], pinned: true, ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReplayLiveRegion', () => {
  it('is a polite, visually hidden status region', () => {
    render(<ReplayLiveRegion progress={progress({ state: 'pinning' })} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.className).toContain('sr-only');
    expect(region).toHaveTextContent('Pinning the engine clock');
  });

  it('announces every state change immediately', () => {
    const view = render(<ReplayLiveRegion progress={progress({ state: 'pinning' })} />);
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'running', tick: 0 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 0 of 120 on the pinned clock');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'pausing', tick: 7 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pausing at tick 7');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'paused', tick: 8 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Paused at tick 8 of 120; input released');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'cancelling', tick: 8 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cancelling and releasing input');
  });

  it('announces tick progress at most about once per second, trailing-edge, while the state stays the same', () => {
    const view = render(<ReplayLiveRegion progress={progress({ tick: 0 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 0 of 120');

    // Sixty ticks at 16 ms (960 ms, under the interval): the announcement does not move.
    const tickMs = 16;
    for (let tick = 1; tick <= 60; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(tickMs);
      });
      view.rerender(<ReplayLiveRegion progress={progress({ tick })} />);
    }
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 0 of 120');

    // When the interval elapses (40 ms later), the LATEST position is
    // announced, not the first one that was held back.
    act(() => {
      vi.advanceTimersByTime(REPLAY_ANNOUNCE_INTERVAL_MS - 60 * tickMs);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 60 of 120');

    // A fresh burst right after it is held back again until the next interval.
    for (let tick = 61; tick <= 70; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(tickMs);
      });
      view.rerender(<ReplayLiveRegion progress={progress({ tick })} />);
    }
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 60 of 120');
    act(() => {
      vi.advanceTimersByTime(REPLAY_ANNOUNCE_INTERVAL_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 70 of 120');
  });

  it('a state change during a held-back burst is announced at once, and resets the interval', () => {
    const view = render(<ReplayLiveRegion progress={progress({ tick: 0 })} />);
    for (let tick = 1; tick <= 20; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
      view.rerender(<ReplayLiveRegion progress={progress({ tick })} />);
    }
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 0 of 120');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'paused', tick: 20 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Paused at tick 20 of 120; input released');
    // Resumed: the first running announcement is immediate (a state change),
    // the ticks after it are held back again.
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'running', tick: 20 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 20 of 120');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'running', tick: 21 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replaying tick 20 of 120');
  });

  it('is rendered while idle, empty, so the first state of a run is announced from an existing region', () => {
    // Several screen readers do not announce the initial content of a live
    // region that was just inserted; the region therefore exists before any
    // run and starts empty (review-board round 2, minor 6).
    const view = render(<ReplayLiveRegion progress={null} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'pinning' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pinning the engine clock');
    view.rerender(<ReplayLiveRegion progress={null} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('carries the test id it is given, so two announcers on one page can be told apart', () => {
    render(<ReplayLiveRegion progress={null} testId="bot-replay-announcer" />);
    expect(screen.getByTestId('bot-replay-announcer')).toHaveAttribute('role', 'status');
  });

  it('announces a terminal state once, then clears itself so it is empty while idle', () => {
    // The panel keeps the terminal progress after a run (it must not clear
    // the announcer in the same render the terminal state arrives in, or
    // nothing is announced); the announcer says it once and then empties.
    const view = render(<ReplayLiveRegion progress={progress({ tick: 7 })} />);
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'completed', tick: 120 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replay completed');
    act(() => {
      vi.advanceTimersByTime(REPLAY_ANNOUNCE_INTERVAL_MS);
    });
    expect(screen.getByRole('status').textContent).toBe('');
    // The same terminal progress kept around re-announces nothing…
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'completed', tick: 120 })} />);
    expect(screen.getByRole('status').textContent).toBe('');
    // …and the other two terminal states behave the same way.
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'cancelled', tick: 5 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replay cancelled after 5 ticks; input released');
    act(() => {
      vi.advanceTimersByTime(REPLAY_ANNOUNCE_INTERVAL_MS);
    });
    expect(screen.getByRole('status').textContent).toBe('');
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'failed', tick: 9 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Replay failed after 9 ticks');
    // A new run starting right after is announced as usual.
    view.rerender(<ReplayLiveRegion progress={progress({ state: 'pinning', tick: 0 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pinning the engine clock');
  });

  it('replayStatusText names every state a creator can see', () => {
    expect(replayStatusText(progress({ state: 'pinning' }))).toBe('Pinning the engine clock…');
    expect(replayStatusText(progress({ state: 'running', tick: 3, pinned: false }))).toBe('Replaying tick 3 of 120');
    expect(replayStatusText(progress({ state: 'running', tick: 3 }))).toBe('Replaying tick 3 of 120 on the pinned clock');
    expect(replayStatusText(progress({ state: 'pausing', tick: 3 }))).toBe('Pausing at tick 3…');
    expect(replayStatusText(progress({ state: 'paused', tick: 4 }))).toBe('Paused at tick 4 of 120; input released');
    expect(replayStatusText(progress({ state: 'cancelling' }))).toBe('Cancelling and releasing input…');
    expect(replayStatusText(progress({ state: 'completed', tick: 120 }))).toBe('Replay completed');
    expect(replayStatusText(progress({ state: 'cancelled', tick: 5 }))).toBe('Replay cancelled after 5 ticks; input released');
    expect(replayStatusText(progress({ state: 'failed', tick: 9 }))).toBe('Replay failed after 9 ticks');
  });
});
