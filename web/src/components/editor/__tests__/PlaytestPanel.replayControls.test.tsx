/** @vitest-environment jsdom */
/**
 * #10007 — the manual Replay controls: pending display, Pause / Resume / Cancel.
 *
 * Drives the real panel against the real browser boundary (DOM key events on
 * `#forge-canvas`, the play-tick bus, a recording engine dispatcher) so what is
 * asserted is the control surface a creator actually uses:
 *   - the pending/progress line is on screen within the NFR-C1 limit of the
 *     Replay click (measured and printed, asserted against
 *     `REPLAY_NFR_PENDING_DISPLAY_MS`);
 *   - Pause is acknowledged in the same commit, settles at the next tick with
 *     input released and the runtime paused, and offers Resume;
 *   - Cancel while paused resumes the runtime, unpins the clock, and reports
 *     "cancelled after N ticks" with no verdict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@/test/utils/componentTestUtils';
import { PlaytestPanel } from '../PlaytestPanel';
import { publishPlayTick, resetPlayTickBus } from '@/lib/playtest/playTickBus';
import { MAX_TRACE_TICKS } from '@/lib/playtest/inputTrace';
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

const engine = vi.hoisted(() => ({
  commands: [] as string[],
  paused: false,
  dispatch: (command: string) => {
    engine.commands.push(command);
    // The real engine answers `pause` / `resume` with ENGINE_MODE_CHANGED and
    // the store mirrors it as `engineMode`, so the mocked store moves with it.
    // (The panel only sees the new mode on its next render, as it would after
    // the store's subscription fired — tests rerender to deliver it.)
    if (command === 'pause') {
      engine.paused = true;
      state.engineMode = 'paused';
    }
    if (command === 'resume') {
      engine.paused = false;
      state.engineMode = 'play';
    }
    return { success: true };
  },
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
  getCommandDispatcher: () => engine.dispatch,
}));

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
    engine.commands.length = 0;
    engine.paused = false;
    keyEvents.length = 0;
    resetPlayTickBus();
    const canvas = document.createElement('canvas');
    canvas.id = 'forge-canvas';
    canvas.addEventListener('keydown', (e) => keyEvents.push(`down ${e.code}`));
    canvas.addEventListener('keyup', (e) => keyEvents.push(`up ${e.code}`));
    document.body.append(canvas);
  });

  afterEach(() => {
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
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Replaying tick 2 of 120');
    // Every remaining tick plus the two settle frames.
    for (let i = 0; i < MAX_TRACE_TICKS + 2; i += 1) await frame((elapsed += 16));

    expect(await screen.findByText(/^Replay (passed|failed)$/)).toBeInTheDocument();
    expect(screen.getByText(/120 ticks · pinned 60 Hz/)).toBeInTheDocument();
    expect(keyEvents).toEqual(['down KeyD', 'up KeyD', 'down KeyD', 'up KeyD']);
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause', 'resume', 'unpin_frame_rate']);
    expect(screen.queryByTestId('replay-progress')).toBeNull();
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
    // The engine confirmed the pause: the store now says 'paused', and the panel
    // re-renders on it exactly as it would after ENGINE_MODE_CHANGED.
    expect(state.engineMode).toBe('paused');
    view.rerender(<PlaytestPanel />);
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    // A replay must survive its own pause: leaving 'play' for 'paused' is the
    // runner's doing, not the creator stopping the game.
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('Paused at tick 2 of 120; input released');
    expect(screen.getByRole('button', { name: 'Resume replay' })).toBeEnabled();
    expect(screen.queryByText(/Replay cancelled/)).toBeNull();
    expect(engine.commands).toEqual(['pin_frame_rate', 'pause']);

    fireEvent.click(screen.getByRole('button', { name: 'Resume replay' }));
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
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

    // Stop: the store leaves Play and the engine never publishes another tick.
    state.engineMode = 'edit';
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
});
