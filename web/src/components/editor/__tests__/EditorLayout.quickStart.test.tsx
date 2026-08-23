/**
 * PF-1215 (#9338) — the visible entry into the game-creation pipeline.
 *
 * EditorLayout renders two mutually-exclusive layout trees (desktop and
 * compact), and the quick-start trigger has to exist in BOTH — a user on a
 * narrow viewport otherwise has no way to reach `startDecomposition` at all.
 * Every assertion here is `getAllByRole(...).toHaveLength(1)` rather than
 * `getByRole`: `getByRole` throws on duplicates, but reads as an existence
 * check, and the thing worth pinning is that exactly one trigger is on screen
 * per layout — two would mean both trees rendered.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { EditorLayout } from '../EditorLayout';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(vi.fn(() => ({})), { setState: vi.fn() }),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({ openPanel: vi.fn() })),
  }),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({})),
  }),
  getCommandDispatcher: vi.fn(() => null),
}));

vi.mock('@/stores/generationStore', () => ({ useGenerationStore: vi.fn(() => ({})) }));
vi.mock('@/hooks/useResponsiveLayout', () => ({ useResponsiveLayout: vi.fn() }));
vi.mock('@/hooks/useGenerationPolling', () => ({ useGenerationPolling: vi.fn() }));
vi.mock('@/hooks/useCelebrations', () => ({
  useCelebrations: () => ({ activeCelebration: null, dismissCelebration: vi.fn(), triggerMilestone: vi.fn() }),
}));
vi.mock('@/lib/storage/autoSave', () => ({
  startAutoSave: vi.fn(() => ({ stop: vi.fn() })),
  setLastExportedScene: vi.fn(),
}));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => <div data-testid="user-button">User</div> }));

// Child components are stubbed to isolate the layout — EXCEPT MobileToolbar,
// which is the compact layout's only home for the trigger and so must be the
// real component here.
vi.mock('../Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar">Sidebar</div> }));
vi.mock('../CanvasArea', () => ({ CanvasArea: () => <div data-testid="canvas-area">Canvas</div> }));
vi.mock('../SceneHierarchy', () => ({ SceneHierarchy: () => <div data-testid="scene-hierarchy">Hierarchy</div> }));
vi.mock('../InspectorPanel', () => ({ InspectorPanel: () => <div data-testid="inspector">Inspector</div> }));
vi.mock('../ScriptEditorPanel', () => ({ ScriptEditorPanel: () => null }));
vi.mock('../UIBuilderPanel', () => ({ UIBuilderPanel: () => null }));
vi.mock('../ShaderEditorPanel', () => ({ ShaderEditorPanel: () => null }));
vi.mock('../PlayControls', () => ({ PlayControls: () => <div data-testid="play-controls">Play</div> }));
vi.mock('../SceneToolbar', () => ({ SceneToolbar: () => <div data-testid="scene-toolbar">Toolbar</div> }));
vi.mock('../LayoutMenu', () => ({ LayoutMenu: () => null }));
vi.mock('../PanelsMenu', () => ({ PanelsMenu: () => null }));
vi.mock('../../settings/TokenBalance', () => ({ TokenBalance: () => null }));
vi.mock('../../chat/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../AddEntityMenu', () => ({ AddEntityMenu: () => <div data-testid="add-entity-menu">Add</div> }));
vi.mock('../DrawerPanel', () => ({
  DrawerPanel: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="drawer-panel">{children}</div> : null,
}));
vi.mock('../WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('../KeyboardShortcutsPanel', () => ({ KeyboardShortcutsPanel: () => null }));
vi.mock('../ShortcutCheatSheet', () => ({ ShortcutCheatSheet: () => null }));
vi.mock('../FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../WorkspaceProvider', () => ({ WorkspaceProvider: () => <div data-testid="workspace-provider">Workspace</div> }));
vi.mock('../SceneTransitionOverlay', () => ({ SceneTransitionOverlay: () => null }));
vi.mock('../../game/DialogueOverlay', () => ({ DialogueOverlay: () => null }));
vi.mock('../TutorialOverlay', () => ({ TutorialOverlay: () => null }));
vi.mock('../OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('../PerformanceProfiler', () => ({ PerformanceProfiler: () => null }));
vi.mock('../../ui/Celebration', () => ({ Celebration: () => null }));
vi.mock('../GenerationStatus', () => ({ GenerationStatus: () => null }));
vi.mock('../HelpMenu', () => ({ HelpMenu: () => <div data-testid="help-menu">Help</div> }));
vi.mock('../../onboarding/OnboardingWizard', () => ({ OnboardingWizard: () => null }));

// Stubbed so this file pins the WIRING (trigger -> open prop). The dialog's own
// behaviour is covered by QuickStartDialog.test.tsx.
vi.mock('../../onboarding/QuickStartDialog', () => ({
  QuickStartDialog: ({ open }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="quick-start-dialog">Quick start</div> : null,
}));

function setupStores(mode: 'desktop' | 'compact') {
  vi.mocked(useResponsiveLayout).mockReturnValue({
    mode,
    isMobile: mode === 'compact',
    isTablet: false,
    isDesktop: mode === 'desktop',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChatStore).mockImplementation((selector: any) =>
    selector({ rightPanelTab: 'inspector' as const, setRightPanelTab: vi.fn(), hasUnreadMessages: false })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) =>
    selector({ chatOverlayOpen: false, setChatOverlayOpen: vi.fn(), toggleChatOverlay: vi.fn() })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    selector({
      sceneName: 'My Game',
      // Read by the real MobileToolbar.
      gizmoMode: 'translate',
      setGizmoMode: vi.fn(),
      spawnEntity: vi.fn(),
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) =>
    selector({ hydrateFromServer: vi.fn() })
  );
}

const trigger = () => screen.getAllByRole('button', { name: 'Make me a game' });

describe('EditorLayout quick-start entry (PF-1215)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== 'undefined' && !window.matchMedia) {
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
  });

  afterEach(() => {
    cleanup();
  });

  it('renders exactly one "Make me a game" button on desktop', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(trigger()).toHaveLength(1);
    expect(screen.getAllByTestId('quick-start-trigger')).toHaveLength(1);
  });

  it('renders exactly one "Make me a game" button on a compact viewport', () => {
    setupStores('compact');
    render(<EditorLayout />);
    expect(trigger()).toHaveLength(1);
    expect(screen.getAllByTestId('quick-start-trigger')).toHaveLength(1);
  });

  it('opens the quick-start dialog from the desktop trigger', async () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.queryByTestId('quick-start-dialog')).toBeNull();

    fireEvent.click(trigger()[0]);

    // The dialog is lazy-loaded inside <Suspense fallback={null}>.
    expect(await screen.findByTestId('quick-start-dialog')).toBeInTheDocument();
  });

  it('opens the quick-start dialog from the compact trigger', async () => {
    setupStores('compact');
    render(<EditorLayout />);
    expect(screen.queryByTestId('quick-start-dialog')).toBeNull();

    fireEvent.click(trigger()[0]);

    expect(await screen.findByTestId('quick-start-dialog')).toBeInTheDocument();
  });
});
