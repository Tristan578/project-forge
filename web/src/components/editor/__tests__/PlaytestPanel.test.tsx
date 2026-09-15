/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent } from '@/test/utils/componentTestUtils';
import { PlaytestPanel } from '../PlaytestPanel';
import { useEditorStore } from '@/stores/editorStore';
import { InputTraceRecorder, MAX_TRACE_TICKS } from '@/lib/playtest/inputTrace';
import { publishPlayTick, resetPlayTickBus } from '@/lib/playtest/playTickBus';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/gameplayBot', () => ({
  BOT_STRATEGIES: [],
  simulatePlaytest: vi.fn().mockResolvedValue({}),
  generatePlaytestReport: vi.fn(() => ({})),
}));

describe('PlaytestPanel', () => {
  let state: Pick<
    ReturnType<typeof useEditorStore.getState>,
    'primaryId' | 'sceneGraph' | 'engineMode' | 'inputBindings' | 'allGameComponents' | 'sceneName'
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPlayTickBus();
    state = {
      primaryId: 'player',
      sceneGraph: { nodes: {}, rootIds: [] },
      engineMode: 'play',
      inputBindings: [{ actionName: 'move_right', actionType: 'digital', sources: ['KeyD'] }],
      allGameComponents: {},
      sceneName: 'Replay fixture',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector(state)
    );
  });

  afterEach(() => {
    cleanup();
    resetPlayTickBus();
    vi.restoreAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<PlaytestPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  it.each(['automatic', 'manual'] as const)(
    'recovers from an invalid %s recording stop and records the updated vocabulary on restart',
    (stopMode) => {
      const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { rerender } = render(<PlaytestPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
      expect(screen.getByRole('button', { name: 'Stop recording input' })).toHaveAttribute('aria-pressed', 'true');

      // The recorder keeps its initial vocabulary while the runtime bindings change.
      state.inputBindings = [
        ...(state.inputBindings ?? []),
        { actionName: 'jump', actionType: 'digital', sources: ['Space'] },
      ];
      rerender(<PlaytestPanel />);
      act(() => {
        const ticks = stopMode === 'automatic' ? MAX_TRACE_TICKS : 1;
        for (let tick = 1; tick <= ticks; tick++) {
          publishPlayTick({
            entities: {},
            inputState: { pressed: tick === 1 ? { jump: true } : {}, axes: {} },
            elapsedMs: tick * 16,
          });
        }
      });
      if (stopMode === 'manual') {
        fireEvent.click(screen.getByRole('button', { name: 'Stop recording input' }));
      }

      expect(screen.getByRole('alert')).toHaveTextContent('Recording could not be saved. Check your input bindings, then select Record to try again.');
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith('Input recording failed:', expect.any(Error));
      expect(screen.getByRole('button', { name: 'Record input' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Record input' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      act(() => {
        publishPlayTick({
          entities: {},
          inputState: { pressed: { jump: true }, axes: {} },
          elapsedMs: (MAX_TRACE_TICKS + 1) * 16,
        });
      });
      fireEvent.click(screen.getByRole('button', { name: 'Stop recording input' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Record input' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
    },
  );
  it('reports an unexpected manual stop failure once and restores the recording controls', () => {
    const cause = new Error('Recorder boundary failed');
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<PlaytestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
    vi.spyOn(InputTraceRecorder.prototype, 'stop').mockImplementation(() => { throw cause; });
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording input' }));

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('Input recording failed:', cause);
    expect(screen.getByRole('alert')).toHaveTextContent('Recording could not be saved. Check your input bindings, then select Record to try again.');
    expect(screen.getByRole('button', { name: 'Record input' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Record input' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeDisabled();
  });

});
