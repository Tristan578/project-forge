/** @vitest-environment jsdom */
/**
 * #10007 — the manual Replay controls: pending display, Pause / Resume / Cancel.
 *
 * Drives the real panel against the real browser boundary (DOM key events on
 * the editor canvas `#game-canvas`, the play-tick bus, a recording engine dispatcher) so what is
 * asserted is the control surface a creator actually uses:
 *   - the pending/progress line is on screen within the NFR-C1 limit of the
 *     Replay click (measured and printed, asserted against
 *     `REPLAY_NFR_PENDING_DISPLAY_MS`);
 *   - Pause is acknowledged in the same commit, settles at the next tick with
 *     input released and the runtime paused, and offers Resume;
 *   - Cancel while paused resumes the runtime, unpins the clock, and reports
 *     "cancelled after N ticks" with no verdict;
 *   - the bot's "Run Playtest" engine run goes through the same single-flight
 *     guard, disables Replay / Record while it runs, and is cancelled by Stop
 *     exactly as a manual replay is (review-board MAJOR 3 / m1);
 *   - Pause / Resume / Cancel meet the 24 px minimum target (m7), and a
 *     refused unpin is reported beside the verdict rather than replacing it (m5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@/test/utils/componentTestUtils';
import { PlaytestPanel } from '../PlaytestPanel';
import { EDITOR_CANVAS_ID } from '@/lib/engine/canvasId';
import { publishPlayTick, resetPlayTickBus } from '@/lib/playtest/playTickBus';
import { MAX_TRACE_TICKS } from '@/lib/playtest/inputTrace';
import { getActiveReplaySession } from '@/lib/playtest/replayEntryPoints';
import { REPLAY_NFR_PENDING_DISPLAY_MS } from '../../../../e2e/constants';

const state = vi.hoisted(() => ({
  engineMode: 'play',
  primaryId: 'player',
  sceneName: 'Fixture',
  inputBindings: [
    { actionName: 'move_right', actionType: 'axis', sources: [], positiveKeys: ['KeyD'], negativeKeys: ['KeyA'] },
  ],
  allGameComponents: { coin: [{ type: 'collectible' }] },
  sceneGraph: { nodes: { player: { name: 'Player' } }, rootIds: ['player'] },
}));

/**
 * The store's change subscription, as `replayEntryPoints` uses it to cancel
 * the active replay on Stop. `setEngineMode` is what the real store does when
 * the engine reports ENGINE_MODE_CHANGED: update the state, then notify.
 */
const storeSubscribers = vi.hoisted(
  () => new Set<(next: typeof state, prev: typeof state) => void>(),
);

const engine = vi.hoisted(() => ({
  commands: [] as string[],
  paused: false,
  /** When set, the engine refuses `unpin_frame_rate` (m5). */
  refuseUnpin: false,
  dispatch: (command: string) => {
    engine.commands.push(command);
    // The real engine answers `pause` / `resume` with ENGINE_MODE_CHANGED and
    // the store mirrors it as `engineMode` and notifies its subscribers — so
    // the entry points' Stop watch SEES 'paused' and must ignore it. (The
    // panel only sees the new mode on its next render, as it would after the
    // store's subscription fired — tests rerender to deliver it.)
    if (command === 'pause') {
      engine.paused = true;
      setEngineMode('paused');
    }
    if (command === 'resume') {
      engine.paused = false;
      setEngineMode('play');
    }
    if (command === 'unpin_frame_rate' && engine.refuseUnpin) {
      return { success: false, error: 'PendingCommands resource not initialized' };
    }
    return { success: true };
  },
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      subscribe: (listener: (next: typeof state, prev: typeof state) => void) => {
        storeSubscribers.add(listener);
        return () => {
          storeSubscribers.delete(listener);
        };
      },
    },
  ),
  getCommandDispatcher: () => engine.dispatch,
}));

/** A deterministic bot plan: hold right for half a second. */
const botSession = vi.hoisted(() => ({
  strategy: 'explorer',
  actions: [
    { type: 'move', timestamp: 0, direction: { x: 1, y: 0 } },
    { type: 'wait', timestamp: 500 },
  ],
  duration: 1000,
  outcome: 'completed',
  discoveries: [],
  metrics: { timeToComplete: 1000, deathCount: 0, itemsCollected: 0, areasExplored: 0, backtrackCount: 0 },
}));

vi.mock('@/lib/ai/gameplayBot', () => ({
  BOT_STRATEGIES: { explorer: { name: 'Explorer', description: 'Visits every room.' } },
  simulatePlaytest: vi.fn(async () => botSession),
  generatePlaytestReport: vi.fn(() => ({
    sessions: [botSession],
    totalDiscoveries: 0,
    criticalCount: 0,
    majorCount: 0,
    minorCount: 0,
    uniqueDiscoveries: [],
    strategyComparison: {},
    overallRating: 'good',
  })),
}));

function setEngineMode(mode: string) {
  const prev = { ...state };
  state.engineMode = mode;
  for (const listener of storeSubscribers) listener(state, prev);
}

const keyEvents: string[] = [];

function tick(elapsedMs: number, holding: boolean) {
  publishPlayTick({
    entities: { player: { position: [0, 0, 0] }, coin: { position: [1, 0, 0] } },
    inputState: {
      pressed: { move_right: holding },
      axes: { move_right: holding ? 1 : 0 },
    },
    elapsedMs,
  });
}

/**
 * One engine frame: let the runner reach its `advanceFrame` (it subscribes to
 * the bus a microtask after the control that started it), publish a play tick,
 * then let the runner's continuation run.
 */
async function frame(elapsedMs: number) {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    tick(elapsedMs, false);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function recordHoldRightTrace() {
  fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
  act(() => {
    for (let t = 1; t <= MAX_TRACE_TICKS; t += 1) tick(t * 16, true);
  });
  expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
}

describe('runtime replay controls', () => {
  beforeEach(() => {
    state.engineMode = 'play';
    storeSubscribers.clear();
    engine.commands.length = 0;
    engine.paused = false;
    engine.refuseUnpin = false;
    keyEvents.length = 0;
    resetPlayTickBus();
    const canvas = document.createElement('canvas');
    canvas.id = EDITOR_CANVAS_ID;
    canvas.addEventListener('keydown', (e) => keyEvents.push(`down ${e.code}`));
    canvas.addEventListener('keyup', (e) => keyEvents.push(`up ${e.code}`));
    document.body.append(canvas);
  });

  afterEach(async () => {
    // The guard is module state: never leave a run active across tests.
    const active = getActiveReplaySession();
    if (active) {
      active.handle.cancel();
      await active.handle.result;
    }
    cleanup();
    document.body.replaceChildren();
  });

  it('shows the pending line within the NFR limit, pauses with input released, and cancels without a verdict', async () => {
    render(<PlaytestPanel />);
    recordHoldRightTrace();

    // --- Replay: the pending line is in the same commit as the click ---------
    const clickedAt = performance.now();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    const progress = screen.getByTestId('replay-progress');
    const pendingMs = performance.now() - clickedAt;
    console.log(`[nfr] replay pending display: ${pendingMs.toFixed(2)} ms (limit ${REPLAY_NFR_PENDING_DISPLAY_MS} ms)`);
    expect(pendingMs).toBeLessThanOrEqual(REPLAY_NFR_PENDING_DISPLAY_MS);
    expect(progress).toHaveTextContent('Pinning the engine clock');
    expect(engine.commands[0]).toBe('pin_frame_rate');

    // The pin's warm-up frame, then three replayed ticks: KeyD is held.
    let elapsed = 0;
    await frame((elapsed += 16));
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Replaying tick 0 of 120 on the pinned clock');
    for (let i = 0; i < 3; i += 1) await frame((elapsed += 16));
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Replaying tick 3 of 120');
    expect(keyEvents).toEqual(['down KeyD']);

    // --- Pause: acknowledged now, settled at the next tick boundary --------
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Pausing at tick 3');
    await frame((elapsed += 16));
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Paused at tick 4 of 120; input released');
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD']);
    expect(engine.paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Resume replay' })).toBeEnabled();

    // --- Cancel while paused: runtime resumed, clock unpinned, no verdict ----
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replay' }));
    expect(await screen.findByText(/Replay cancelled after 4 ticks/)).toBeInTheDocument();
    expect(screen.queryByTestId('replay-progress')).toBeNull();
    expect(screen.queryByText(/^Replay (passed|failed)$/)).toBeNull();
    expect(engine.paused).toBe(false);
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause', 'resume', 'unpin_frame_rate']);
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
  });

  it('resume re-presses the held key and the replay runs to a verdict', async () => {
    render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    let elapsed = 0;
    await frame((elapsed += 16));
    await frame((elapsed += 16));
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    await frame((elapsed += 16));
    expect(screen.getByRole('button', { name: 'Resume replay' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Resume replay' }));
    await flush();
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Replaying tick 2 of 120');
    // Every remaining tick plus the two settle frames.
    for (let i = 0; i < MAX_TRACE_TICKS + 2; i += 1) await frame((elapsed += 16));

    expect(await screen.findByText(/^Replay (passed|failed)$/)).toBeInTheDocument();
    expect(screen.getByText(/120 ticks · pinned 60 Hz/)).toBeInTheDocument();
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD', 'down KeyD', 'up KeyD']);
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause', 'resume', 'unpin_frame_rate']);
    expect(screen.queryByTestId('replay-progress')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("the runner's own pause moves the engine to 'paused' WITHOUT cancelling the replay", async () => {
    const view = render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    let elapsed = 0;
    await frame((elapsed += 16));
    await frame((elapsed += 16));
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    await frame((elapsed += 16));
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Paused at tick 2 of 120; input released');
    // The engine confirmed the pause: the store now says 'paused', its
    // subscribers (the entry points' Stop watch included) were notified, and
    // the panel re-renders on it exactly as it would after ENGINE_MODE_CHANGED.
    expect(state.engineMode).toBe('paused');
    view.rerender(<PlaytestPanel />);
    await flush();

    // A replay must survive its own pause: leaving 'play' for 'paused' is the
    // runner's doing, not the creator stopping the game.
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Paused at tick 2 of 120; input released');
    expect(screen.getByRole('button', { name: 'Resume replay' })).toBeEnabled();
    expect(screen.queryByText(/Replay cancelled/)).toBeNull();
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause']);

    fireEvent.click(screen.getByRole('button', { name: 'Resume replay' }));
    await flush();
    expect(state.engineMode).toBe('play');
    view.rerender(<PlaytestPanel />);
    for (let i = 0; i < MAX_TRACE_TICKS + 2; i += 1) await frame((elapsed += 16));
    expect(await screen.findByText(/^Replay (passed|failed)$/)).toBeInTheDocument();
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause', 'resume', 'unpin_frame_rate']);
  });

  it('stopping Play mid-replay cancels it at once: input released, clock unpinned, no verdict', async () => {
    const view = render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    let elapsed = 0;
    await frame((elapsed += 16));
    for (let i = 0; i < 3; i += 1) await frame((elapsed += 16));
    expect(keyEvents).toEqual(['down KeyD']);

    // Stop: the store leaves Play (and notifies), and the engine never
    // publishes another tick.
    act(() => setEngineMode('edit'));
    view.rerender(<PlaytestPanel />);

    // findBy's default 1 s window is the assertion: the boundary's own
    // stalled-tick timeout is 2 s, so a cancel that merely waited for the next
    // frame would arrive late, as a failure, and miss this.
    expect(await screen.findByText(/Replay cancelled after 3 ticks/)).toBeInTheDocument();
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD']);
    expect(engine.commands).toEqual(['pin_frame_rate', 'unpin_frame_rate']);
    expect(screen.queryByTestId('replay-progress')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/^Replay (passed|failed)$/)).toBeNull();
  });

  it('a refused unpin after a completed replay keeps the verdict and reports that the clock could not be released', async () => {
    engine.refuseUnpin = true;
    render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    let elapsed = 0;
    for (let i = 0; i < MAX_TRACE_TICKS + 3; i += 1) await frame((elapsed += 16));

    expect(await screen.findByText(/^Replay (passed|failed)$/)).toBeInTheDocument();
    expect(screen.getByText(/120 ticks · pinned 60 Hz/)).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/clock could not be released/);
    expect(alert).toHaveTextContent(/unpin_frame_rate/);
    expect(alert).toHaveTextContent(/PendingCommands resource not initialized/);
    expect(engine.commands[engine.commands.length - 1]).toBe('unpin_frame_rate');
  });

  it('Pause, Resume and Cancel meet the 24 px minimum target size (WCAG 2.5.8)', async () => {
    render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    for (const name of ['Pause replay', 'Cancel replay']) {
      const button = screen.getByRole('button', { name });
      expect(button.className, `${name} is under the 24 px minimum`).toContain('min-h-6');
      expect(button.className, `${name} is under the 24 px minimum`).toContain('min-w-6');
    }
    let elapsed = 0;
    await frame((elapsed += 16));
    await frame((elapsed += 16));
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    await frame((elapsed += 16));
    const resume = screen.getByRole('button', { name: 'Resume replay' });
    expect(resume.className).toContain('min-h-6');
    expect(resume.className).toContain('min-w-6');
  });

  it('the visible progress line is not a live region; a persistent, throttled announcer beside it is', async () => {
    render(<PlaytestPanel />);
    // Present before any run, empty: a freshly inserted live region's first
    // content is not announced by several screen readers.
    const idle = screen.getByTestId('replay-announcer');
    expect(idle).toHaveAttribute('aria-live', 'polite');
    expect(idle.className).toContain('sr-only');
    expect(idle.textContent).toBe('');
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    const visible = screen.getByTestId('replay-progress');
    expect(visible).not.toHaveAttribute('aria-live');
    expect(visible).not.toHaveAttribute('role');
    expect(screen.getByTestId('replay-announcer')).toHaveTextContent('Pinning the engine clock');
    let elapsed = 0;
    await frame((elapsed += 16));
    // A state change (pinning -> running) is announced at once...
    expect(screen.getByTestId('replay-announcer')).toHaveTextContent('Replaying tick 0 of 120');
    for (let i = 0; i < 5; i += 1) await frame((elapsed += 16));
    // ...while tick progress inside the same state is held back; the visible
    // line is live regardless.
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Replaying tick 5 of 120');
    expect(screen.getByTestId('replay-announcer')).toHaveTextContent('Replaying tick 0 of 120');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replay' }));
    await screen.findByText(/Replay cancelled after 5 ticks/);
    // Still present once the run is over, empty again.
    expect(screen.getByTestId('replay-announcer').textContent).toBe('');
  });
});

describe('the bot run and the manual run share one replay guard (review-board MAJOR 3 / m1)', () => {
  beforeEach(() => {
    state.engineMode = 'play';
    storeSubscribers.clear();
    engine.commands.length = 0;
    engine.paused = false;
    engine.refuseUnpin = false;
    keyEvents.length = 0;
    resetPlayTickBus();
    const canvas = document.createElement('canvas');
    canvas.id = EDITOR_CANVAS_ID;
    canvas.addEventListener('keydown', (e) => keyEvents.push(`down ${e.code}`));
    canvas.addEventListener('keyup', (e) => keyEvents.push(`up ${e.code}`));
    document.body.append(canvas);
  });

  afterEach(async () => {
    const active = getActiveReplaySession();
    if (active) {
      active.handle.cancel();
      await active.handle.result;
    }
    cleanup();
    document.body.replaceChildren();
  });

  it("Run Playtest's engine run takes the guard: Replay and Record are disabled meanwhile, and Stop cancels it cleanly", async () => {
    const view = render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Run playtest with explorer strategy' }));
    await flush();
    // The bot's plan became a trace and the engine clock was pinned for it.
    expect(engine.commands).toEqual(['pin_frame_rate']);
    expect(getActiveReplaySession()?.source).toBe('ai');
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record input' })).toBeDisabled();

    let elapsed = 0;
    await frame((elapsed += 16)); // warm-up
    await frame((elapsed += 16)); // tick 0: the bot holds right
    expect(keyEvents).toEqual(['down KeyD']);

    // Stop. Before the fix this surfaced ~2 s later as "Replay stopped: no
    // engine play tick received."; now the run is cancelled at once.
    act(() => setEngineMode('edit'));
    view.rerender(<PlaytestPanel />);
    expect(await screen.findByText(/AI bot runtime replay cancelled after 1 tick/)).toBeInTheDocument();
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD']);
    expect(engine.commands).toEqual(['pin_frame_rate', 'unpin_frame_rate']);
    expect(getActiveReplaySession()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/no engine play tick received/)).toBeNull();
  });

  it('a manual replay in flight disables Run Playtest, and the guard is released when it ends', async () => {
    render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    expect(screen.getByRole('button', { name: 'Run playtest with explorer strategy' })).toBeDisabled();
    expect(getActiveReplaySession()?.source).toBe('manual');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel replay' }));
    expect(await screen.findByText(/Replay cancelled after 0 ticks/)).toBeInTheDocument();
    expect(getActiveReplaySession()).toBeNull();
    expect(screen.getByRole('button', { name: 'Run playtest with explorer strategy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
  });

  it("the bot's engine run shows its own progress line with Cancel, and the Runtime Replay section says why Replay waits", async () => {
    render(<PlaytestPanel />);
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Run playtest with explorer strategy' }));
    await flush();
    expect(screen.getByTestId('bot-replay-progress')).toHaveTextContent('AI bot: Pinning the engine clock');
    expect(screen.getByTestId('bot-replay-announcer')).toHaveTextContent('Pinning the engine clock');
    const hint = screen.getByTestId('replay-busy-hint');
    expect(hint).toHaveTextContent('A replay is running (ai). Wait for it to finish or press Stop.');
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeDisabled();

    let elapsed = 0;
    await frame((elapsed += 16)); // warm-up
    await frame((elapsed += 16)); // tick 0
    expect(screen.getByTestId('bot-replay-progress')).toHaveTextContent('AI bot: Replaying tick 1 of');
    const cancel = screen.getByRole('button', { name: 'Cancel AI bot replay' });
    expect(cancel.className).toContain('min-h-6');
    fireEvent.click(cancel);
    expect(await screen.findByText(/AI bot runtime replay cancelled after 1 tick/)).toBeInTheDocument();
    expect(screen.queryByTestId('bot-replay-progress')).toBeNull();
    expect(screen.queryByTestId('replay-busy-hint')).toBeNull();
    expect(engine.commands).toEqual(['pin_frame_rate', 'unpin_frame_rate']);
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD']);
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
  });

  it('a manual replay in flight says why Run Playtest waits', async () => {
    render(<PlaytestPanel />);
    expect(screen.queryByTestId('bot-busy-hint')).toBeNull();
    recordHoldRightTrace();
    fireEvent.click(screen.getByRole('button', { name: 'Replay recorded input' }));
    expect(screen.getByTestId('bot-busy-hint')).toHaveTextContent('A replay is running (manual). Wait for it to finish or press Stop.');
    expect(screen.getByRole('button', { name: 'Run playtest with explorer strategy' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replay' }));
    await screen.findByText(/Replay cancelled after 0 ticks/);
    expect(screen.queryByTestId('bot-busy-hint')).toBeNull();
  });

  it("the bot's engine run reports its verdict when it completes", async () => {
    render(<PlaytestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run playtest with explorer strategy' }));
    await flush();
    expect(engine.commands).toEqual(['pin_frame_rate']);
    let elapsed = 0;
    // Warm-up, every tick of the bot's trace, two settle frames; a generous
    // bound, the run finishes when it finishes.
    for (let i = 0; i < 200 && getActiveReplaySession(); i += 1) await frame((elapsed += 16));
    expect(await screen.findByText(/^AI bot runtime replay (passed|failed)$/)).toBeInTheDocument();
    expect(engine.commands[engine.commands.length - 1]).toBe('unpin_frame_rate');
    expect(getActiveReplaySession()).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeDisabled(); // no trace recorded
    expect(screen.getByRole('button', { name: 'Record input' })).toBeEnabled();
  });
});
