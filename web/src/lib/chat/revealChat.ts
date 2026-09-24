/**
 * Bring the chat into view on whichever layout is mounted.
 *
 * Two surfaces show the chat, and each layout renders only one of them:
 * - the compact drawer renders whichever `rightPanelTab` is selected
 *   (`RightPanelTabs` / `RightPanelContent` mount only inside it);
 * - the desktop dockview has no chat panel at all, so `rightPanelTab` renders
 *   nothing there and `ChatOverlay` is the only chat surface.
 *
 * Every caller that posts a message the user must see (a refused Play, an idea
 * handed to the AI) used to set the tab and stop, which on desktop posts to a
 * panel nobody can open (#10166). This sets both, and it always SETS, never
 * toggles: revealing an already-open overlay must leave it open.
 */
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function revealChat(): void {
  // `setRightPanelTab('chat')` also clears the unread badge, preserving the
  // store's `tab === 'chat' ⟹ hasUnreadMessages === false` invariant.
  useChatStore.getState().setRightPanelTab('chat');
  useWorkspaceStore.getState().setChatOverlayOpen(true);
}
