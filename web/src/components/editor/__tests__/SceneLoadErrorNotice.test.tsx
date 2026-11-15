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

  it('puts the reason in a named, focusable scroll box above the Reload button', () => {
    // A rejected load can append up to 512 characters of engine text, so the
    // reason scrolls inside its own capped box and the explanation and the
    // Reload button stay on a phone screen. Whether the notice actually fits
    // is a LAYOUT question jsdom cannot answer: it is measured in Chromium by
    // e2e/tests/scene-load-error-notice.spec.ts (320x568 and 375x667, a spaced
    // 512-character reason and an unbroken token). This test pins only what
    // the DOM can show: the box is keyboard-reachable (a scrollable region
    // with nothing focusable inside fails axe scrollable-region-focusable),
    // it is named, it holds the whole reason, and the button sits outside it,
    // so scrolling the reason never scrolls the button away.
    const token = 'A'.repeat(500);
    mockEditorStore({ reason: `This scene could not be opened: the engine refused to load it. Details: ${token}`, at: 1 });

    render(<SceneLoadErrorNotice />);

    const details = screen.getByRole('region', { name: 'Error details' });
    expect(details.tabIndex).toBe(0);
    expect(details.textContent).toContain(token);
    expect(details.contains(screen.getByTestId('scene-load-error-reason'))).toBe(true);
    const reload = screen.getByRole('button', { name: /reload project/i });
    expect(details.contains(reload)).toBe(false);
    expect(screen.getByRole('alert').contains(reload)).toBe(true);
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
