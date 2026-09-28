/**
 * "Customize with AI" (#10172) on the COMPACT layout, where two chat composers
 * are mounted at once.
 *
 * `revealChat()` sets `rightPanelTab = 'chat'` and opens the chat overlay. On
 * the compact layout the right `DrawerPanel` keeps its children mounted while
 * closed (it only translates off-screen), so the tab switch mounts a ChatPanel
 * inside the hidden drawer at the same moment the overlay mounts the visible
 * one. The draft must land in exactly one composer, the visible overlay's, and
 * only that one may take focus. Before the fix both composers adopted the draft
 * and focus fell to whichever effect happened to run last (JSX order).
 *
 * Real chat + workspace stores and the real DrawerPanel. ChatPanel is reduced
 * to the real ChatInput, forwarding whatever props EditorLayout passes it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@/test/utils/componentTestUtils';
import { toast } from 'sonner';
import { EditorLayout } from '../EditorLayout';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useResponsiveLayout, getLayoutConfig } from '@/hooks/useResponsiveLayout';
import { offerCustomizeWithAi, customizeDraftFor } from '@/lib/chat/customizeWithAi';

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(() => ({})), { getState: vi.fn(() => ({})) }),
  getCommandDispatcher: vi.fn(() => null),
  setCommandDispatcher: vi.fn(),
}));
vi.mock('@/stores/generationStore', () => ({ useGenerationStore: vi.fn(() => ({})) }));
vi.mock('@/hooks/useResponsiveLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useResponsiveLayout')>()),
  useResponsiveLayout: vi.fn(),
}));
vi.mock('@/hooks/useGenerationPolling', () => ({ useGenerationPolling: vi.fn() }));
vi.mock('@/lib/storage/autoSave', () => ({
  startAutoSave: vi.fn(() => ({ stop: vi.fn() })),
  setLastExportedScene: vi.fn(),
}));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }));

// The unit under test: ChatPanel is only the real composer, and it forwards
// EditorLayout's props so the layout decides which surface takes the draft.
vi.mock('../../chat/ChatPanel', async () => {
  const { ChatInput } = await import('../../chat/ChatInput');
  return {
    ChatPanel: (props: Record<string, unknown>) => <ChatInput {...props} />,
  };
});
vi.mock('../../chat/EntityPicker', () => ({ EntityPicker: () => null }));

// Everything else is scenery.
vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../CanvasArea', () => ({ CanvasArea: () => null }));
vi.mock('../SceneHierarchy', () => ({ SceneHierarchy: () => null }));
vi.mock('../InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../ScriptEditorPanel', () => ({ ScriptEditorPanel: () => null }));
vi.mock('../UIBuilderPanel', () => ({ UIBuilderPanel: () => null }));
vi.mock('../ShaderEditorPanel', () => ({ ShaderEditorPanel: () => null }));
vi.mock('../PlayControls', () => ({ PlayControls: () => null }));
vi.mock('../SceneToolbar', () => ({ SceneToolbar: () => null }));
vi.mock('../LayoutMenu', () => ({ LayoutMenu: () => null }));
vi.mock('../PanelsMenu', () => ({ PanelsMenu: () => null }));
vi.mock('../../settings/TokenBalance', () => ({ TokenBalance: () => null }));
vi.mock('../MobileToolbar', () => ({ MobileToolbar: () => null }));
vi.mock('../WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('../KeyboardShortcutsPanel', () => ({ KeyboardShortcutsPanel: () => null }));
vi.mock('../ShortcutCheatSheet', () => ({ ShortcutCheatSheet: () => null }));
vi.mock('../FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../WorkspaceProvider', () => ({ WorkspaceProvider: () => null }));
vi.mock('../SceneTransitionOverlay', () => ({ SceneTransitionOverlay: () => null }));
vi.mock('../../game/DialogueOverlay', () => ({ DialogueOverlay: () => null }));
vi.mock('../TutorialOverlay', () => ({ TutorialOverlay: () => null }));
vi.mock('../OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('../PerformanceProfiler', () => ({ PerformanceProfiler: () => null }));
vi.mock('@/hooks/useCelebrations', () => ({
  useCelebrations: () => ({ activeCelebration: null, dismissCelebration: vi.fn(), triggerMilestone: vi.fn() }),
}));
vi.mock('../../ui/Celebration', () => ({ Celebration: () => null }));
vi.mock('../GenerationStatus', () => ({ GenerationStatus: () => null }));
vi.mock('../HelpMenu', () => ({ HelpMenu: () => null }));

const sendMessage = vi.fn();
const DRAFT = customizeDraftFor('3D Platformer');

function composersIn(container: HTMLElement): HTMLTextAreaElement[] {
  return within(container).queryAllByPlaceholderText(/Describe what you want/) as HTMLTextAreaElement[];
}

beforeEach(() => {
  sendMessage.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(useResponsiveLayout).mockReturnValue(getLayoutConfig(375));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector({ sceneName: 'My Game' }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) => selector({ hydrateFromServer: vi.fn() }));
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
  useChatStore.setState({ composerDraft: '', sendMessage, rightPanelTab: 'inspector' });
  useWorkspaceStore.setState({ chatOverlayOpen: false });
  // The offer fires after a template has loaded, which is also when onboarding
  // completes; EditorLayout renders the real OnboardingGate (#6831), and a
  // fresh store would put the welcome wizard (and its focus trap) on screen.
  useOnboardingStore.setState({ isNewUser: false, onboardingCompleted: true });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ composerDraft: '', rightPanelTab: 'inspector' });
  useWorkspaceStore.setState({ chatOverlayOpen: false });
});

describe('EditorLayout compact: "Customize with AI" draft (#10172)', () => {
  it('puts the draft in the visible overlay composer only, and focuses that one', async () => {
    render(<EditorLayout />);

    offerCustomizeWithAi('3D Platformer');
    const action = vi.mocked(toast.success).mock.calls[0]?.[1]?.action;
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('toast has no action');
    act(() => {
      action.onClick({} as React.MouseEvent<HTMLButtonElement>);
    });

    // Both composers are mounted: the hidden drawer's (tab switched to chat)
    // and the overlay's. Without two, this test would prove nothing.
    const drawer = screen.getByRole('dialog', { name: 'Inspector panel' });
    const drawerComposers = await vi.waitFor(() => {
      const found = composersIn(drawer);
      if (found.length !== 1) throw new Error(`drawer composers: ${found.length}`);
      return found;
    });
    const all = await screen.findAllByPlaceholderText(/Describe what you want/);
    expect(all).toHaveLength(2);
    const hidden = drawerComposers[0];
    const visible = all.find((el) => el !== hidden) as HTMLTextAreaElement;
    expect(drawer.className).toContain('translate-x-full');

    expect(visible.value).toBe(DRAFT);
    expect(hidden.value).toBe('');
    expect(document.activeElement).toBe(visible);
    expect(useChatStore.getState().composerDraft).toBe('');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
