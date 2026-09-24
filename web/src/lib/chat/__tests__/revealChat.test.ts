import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revealChat } from '../revealChat';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const { setRightPanelTab } = vi.hoisted(() => ({ setRightPanelTab: vi.fn() }));
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: () => ({ setRightPanelTab }) },
}));

describe('revealChat', () => {
  beforeEach(() => {
    setRightPanelTab.mockClear();
    useWorkspaceStore.setState({ chatOverlayOpen: false });
  });

  it('selects the chat tab (compact drawer) and opens the overlay (desktop)', () => {
    revealChat();

    expect(setRightPanelTab).toHaveBeenCalledTimes(1);
    expect(setRightPanelTab).toHaveBeenCalledWith('chat');
    expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);
  });

  it('leaves an already-open overlay open (sets, never toggles)', () => {
    useWorkspaceStore.setState({ chatOverlayOpen: true });

    revealChat();
    revealChat();

    expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);
  });
});
