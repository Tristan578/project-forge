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

  it('wraps a long unbroken token in the reason instead of overflowing the notice', () => {
    // An engine refusal can quote a scene value verbatim (bounded at 512
    // characters upstream). The notice is a shrink-to-fit fixed box, so its
    // width comes from its content's MIN-CONTENT width. `break-words`
    // (overflow-wrap: break-word) does not lower that, so a 500-character
    // token grew the notice to its cap and ran it off a 375px screen
    // (measured in Chromium). `wrap-anywhere` (overflow-wrap: anywhere)
    // does. jsdom has no layout, so this pins the classes that keep the
    // notice inside the viewport: `wrap-anywhere` on the reason, `min-w-0`
    // on it and its flex-item column, and a max width capped at the viewport.
    const token = 'A'.repeat(500);
    mockEditorStore({ reason: `This scene could not be opened: the engine refused to load it. Details: ${token}`, at: 1 });

    render(<SceneLoadErrorNotice />);

    const reason = screen.getByTestId('scene-load-error-reason');
    expect(reason.textContent).toContain(token);
    expect(reason.classList.contains('wrap-anywhere')).toBe(true);
    expect(reason.classList.contains('break-words')).toBe(false);
    expect(reason.classList.contains('min-w-0')).toBe(true);
    expect(reason.parentElement?.classList.contains('min-w-0')).toBe(true);
    const notice = screen.getByRole('alert');
    expect(notice.classList.contains('max-w-[min(36rem,calc(100vw-1.5rem))]')).toBe(true);
    expect(notice.classList.contains('max-w-xl')).toBe(false);
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
