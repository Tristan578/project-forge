/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@/test/utils/componentTestUtils';
import { PlaytestPanel } from '../PlaytestPanel';
import { publishPlayTick, resetPlayTickBus } from '@/lib/playtest/playTickBus';
import { MAX_TRACE_TICKS } from '@/lib/playtest/inputTrace';

const state = vi.hoisted(() => ({
  engineMode: 'play',
  primaryId: 'player',
  sceneName: 'Fixture',
  inputBindings: [],
  allGameComponents: {},
  sceneGraph: { nodes: {}, rootIds: [] },
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

describe('runtime recording controls', () => {
  beforeEach(() => {
    state.engineMode = 'play';
    resetPlayTickBus();
  });
  afterEach(cleanup);

  it('makes an automatically completed recording available for replay', () => {
    render(<PlaytestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
    act(() => {
      for (let tick = 1; tick <= MAX_TRACE_TICKS; tick++) {
        publishPlayTick({ entities: {}, inputState: { pressed: {}, axes: {} }, elapsedMs: tick * 16 });
      }
    });
    expect(screen.getByRole('button', { name: 'Record input' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
  });

  it('leaves recording mode when Play stops and permits a fresh recording', () => {
    const view = render(<PlaytestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
    state.engineMode = 'edit';
    view.rerender(<PlaytestPanel />);
    expect(screen.getByRole('button', { name: 'Record input' })).toBeDisabled();
    state.engineMode = 'play';
    view.rerender(<PlaytestPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Record input' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording input' }));
    expect(screen.getByRole('button', { name: 'Replay recorded input' })).toBeEnabled();
  });
});
