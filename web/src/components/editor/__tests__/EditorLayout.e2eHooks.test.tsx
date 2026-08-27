/**
 * PF-1215 (#9338) — the build-time gate on EditorLayout's E2E window hooks.
 *
 * Four globals are attached (`__EDITOR_STORE`, `__CHAT_STORE`,
 * `__FORGE_DISPATCH`, `__FORGE_SET_DISPATCH`) and every one of them is a
 * capability a page must never hand a normal visitor. The ONLY thing standing
 * between them and a production build is `e2eHooksEnabled()`, so the gate is
 * pinned here in both directions: attached when it returns true, and NOT ONE of
 * the four present when it returns false.
 *
 * `__FORGE_SET_DISPATCH` is the newest of the four and exists because the strict
 * journey gate builds no WASM — `runPipelineFromPlan` refuses with 'Engine not
 * loaded' before a single step runs when no dispatcher is installed, which would
 * make the generated-game pipeline untestable there. It forwards to the
 * PRODUCTION `setCommandDispatcher`, so the gate drives the real `tracked`
 * dispatch path (payload-bounds guard included) rather than a parallel one; that
 * forwarding is asserted rather than assumed.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { EditorLayout } from '../EditorLayout';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { e2eHooksEnabled } from '@/lib/e2e/testHooks';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/e2e/testHooks', () => ({ e2eHooksEnabled: vi.fn(() => true) }));

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
  setCommandDispatcher: vi.fn(),
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
vi.mock('../../onboarding/QuickStartDialog', () => ({ QuickStartDialog: () => null }));

const GATED_GLOBALS = ['__EDITOR_STORE', '__CHAT_STORE', '__FORGE_DISPATCH', '__FORGE_SET_DISPATCH'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = () => window as any;

function setupStores() {
  vi.mocked(useResponsiveLayout).mockReturnValue({
    mode: 'desktop',
    isMobile: false,
    isTablet: false,
    isDesktop: true,
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
    selector({ sceneName: 'My Game', gizmoMode: 'translate', setGizmoMode: vi.fn(), spawnEntity: vi.fn() })
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) =>
    selector({ hydrateFromServer: vi.fn() })
  );
}

describe('EditorLayout E2E window hooks (PF-1215)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // jsdom's window is shared across tests in this file, so a global left by a
    // previous render would make the disabled-gate assertion vacuous.
    for (const name of GATED_GLOBALS) delete win()[name];
    vi.mocked(e2eHooksEnabled).mockReturnValue(true);
    setupStores();
  });

  afterEach(() => {
    cleanup();
    for (const name of GATED_GLOBALS) delete win()[name];
  });

  it('attaches every gated global when E2E hooks are enabled', () => {
    render(<EditorLayout />);
    for (const name of GATED_GLOBALS) {
      expect(win()[name], `${name} should be attached`).toBeDefined();
    }
    expect(typeof win().__FORGE_SET_DISPATCH).toBe('function');
  });

  it('attaches NONE of the gated globals when E2E hooks are disabled', () => {
    vi.mocked(e2eHooksEnabled).mockReturnValue(false);
    render(<EditorLayout />);
    for (const name of GATED_GLOBALS) {
      expect(win()[name], `${name} must not be attached`).toBeUndefined();
    }
  });

  it('forwards __FORGE_SET_DISPATCH to the production setCommandDispatcher', () => {
    render(<EditorLayout />);

    const fake = vi.fn(() => ({ success: true }));
    win().__FORGE_SET_DISPATCH(fake);

    // Identity, not `expect.any(Function)`: routing the caller's dispatcher
    // through the real installer is the whole point — a wrapper of our own here
    // would put the gate on a parallel path instead of the `tracked` one.
    expect(setCommandDispatcher).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setCommandDispatcher).mock.calls[0][0]).toBe(fake);
  });
});
