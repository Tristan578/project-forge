/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@/test/utils/componentTestUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneLoadErrorNotice } from '../SceneLoadErrorNotice';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span aria-hidden="true" />,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(sceneLoadError: { reason: string; at: number } | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector({ sceneLoadError }));
}

/**
 * #10056. Before this component a rejected scene load rendered a fully normal
 * editor around an EMPTY viewport, with the project's name already in place and
 * nothing said about it — and the next save wrote that empty scene over the
 * project. This is the visible half of the fix.
 */
describe('SceneLoadErrorNotice', () => {
  afterEach(cleanup);

  it('names the reason and says saving is disabled', () => {
    mockEditorStore({ reason: 'This scene could not be opened: its prefab data is invalid.', at: 1 });

    render(<SceneLoadErrorNotice />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('its prefab data is invalid');
    // The second half matters as much as the first: without it the user reads a
    // broken Save button as a second, unrelated fault.
    expect(alert.textContent).toContain('Saving is turned off');
  });

  it('renders nothing when no scene load was rejected', () => {
    // Includes the healthy cold open, where `loadScene` returns false purely
    // because the engine dispatcher has not mounted yet. Gating on that boolean
    // instead of this field is what would have produced a false alarm on every
    // working editor open.
    mockEditorStore(null);

    render(<SceneLoadErrorNotice />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a reload rather than a dismiss, so the warning cannot outlive its cause', () => {
    mockEditorStore({ reason: 'This scene could not be opened: the engine refused to load it.', at: 1 });

    render(<SceneLoadErrorNotice />);

    expect(screen.getByRole('button', { name: /reload project/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });
});
