/**
 * Tests for EditorLayout — desktop/compact rendering, tab navigation,
 * keyboard shortcuts, chat overlay, mobile banner.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { EditorLayout } from '../EditorLayout';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { useGenerationPolling } from '@/hooks/useGenerationPolling';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(vi.fn(() => ({})), {
    setState: vi.fn(),
  }),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({ openPanel: vi.fn() })),
  }),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => null),
}));

vi.mock('@/lib/storage/autoSave', () => ({
  startAutoSave: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(() => ({})),
}));

vi.mock('@/hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: vi.fn(),
}));

vi.mock('@/hooks/useGenerationPolling', () => ({
  useGenerationPolling: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  UserButton: () => <div data-testid="user-button">User</div>,
}));

// Mock all child components to isolate EditorLayout
vi.mock('../Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar">Sidebar</div> }));
vi.mock('../CanvasArea', () => ({ CanvasArea: () => <div data-testid="canvas-area">Canvas</div> }));
vi.mock('../SceneHierarchy', () => ({ SceneHierarchy: () => <div data-testid="scene-hierarchy">Hierarchy</div> }));
vi.mock('../InspectorPanel', () => ({ InspectorPanel: () => <div data-testid="inspector">Inspector</div> }));
vi.mock('../ScriptEditorPanel', () => ({ ScriptEditorPanel: () => <div data-testid="script-editor">Script</div> }));
vi.mock('../UIBuilderPanel', () => ({ UIBuilderPanel: () => <div data-testid="ui-builder">UI</div> }));
vi.mock('../ShaderEditorPanel', () => ({ ShaderEditorPanel: () => null }));
vi.mock('../PlayControls', () => ({ PlayControls: () => <div data-testid="play-controls">Play</div> }));
vi.mock('../SceneToolbar', () => ({ SceneToolbar: () => <div data-testid="scene-toolbar">Toolbar</div> }));
vi.mock('../LayoutMenu', () => ({ LayoutMenu: () => <div data-testid="layout-menu">Layout</div> }));
vi.mock('../PanelsMenu', () => ({ PanelsMenu: () => <div data-testid="panels-menu">Panels</div> }));
vi.mock('../../settings/TokenBalance', () => ({ TokenBalance: () => <div data-testid="token-balance">Tokens</div> }));
vi.mock('../../chat/ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel">Chat</div> }));
vi.mock('../DrawerPanel', () => ({
  DrawerPanel: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="drawer-panel">{children}</div> : null,
}));
vi.mock('../MobileToolbar', () => ({
  MobileToolbar: ({ onToggleLeft, onToggleRight }: { onToggleLeft: () => void; onToggleRight: () => void }) => (
    <div data-testid="mobile-toolbar">
      <button data-testid="toggle-left" onClick={onToggleLeft}>Left</button>
      <button data-testid="toggle-right" onClick={onToggleRight}>Right</button>
    </div>
  ),
}));
vi.mock('../WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('../KeyboardShortcutsPanel', () => ({
  KeyboardShortcutsPanel: ({ open }: { open: boolean }) =>
    open ? <div data-testid="shortcuts-panel">Shortcuts</div> : null,
}));
vi.mock('../ShortcutCheatSheet', () => ({
  ShortcutCheatSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="cheat-sheet">Cheat Sheet</div> : null,
}));
vi.mock('../FeedbackDialog', () => ({
  FeedbackDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="feedback-dialog">Feedback</div> : null,
}));
vi.mock('../WorkspaceProvider', () => ({ WorkspaceProvider: () => <div data-testid="workspace-provider">Workspace</div> }));
vi.mock('../SceneTransitionOverlay', () => ({ SceneTransitionOverlay: () => null }));
vi.mock('../../game/DialogueOverlay', () => ({ DialogueOverlay: () => null }));
vi.mock('../TutorialOverlay', () => ({ TutorialOverlay: () => null }));
vi.mock('../OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('@/lib/storage/autoSave', () => ({
  startAutoSave: vi.fn(() => ({ stop: vi.fn() })),
  setLastExportedScene: vi.fn(),
}));
vi.mock('../PerformanceProfiler', () => ({ PerformanceProfiler: () => null }));
vi.mock('../GenerationStatus', () => ({ GenerationStatus: () => <div data-testid="gen-status">Gen</div> }));
vi.mock('../HelpMenu', () => ({
  HelpMenu: ({ onOpenShortcuts, onOpenFeedback }: { onOpenShortcuts: () => void; onOpenFeedback: () => void }) => (
    <div data-testid="help-menu">
      <button data-testid="open-shortcuts" onClick={onOpenShortcuts}>Shortcuts</button>
      <button data-testid="open-feedback" onClick={onOpenFeedback}>Feedback</button>
    </div>
  ),
}));

const mockSetRightPanelTab = vi.fn();
const mockToggleChatOverlay = vi.fn();
const mockHydrateFromServer = vi.fn();
const mockSetChatOverlayOpen = vi.fn();

function setupStores(mode: 'desktop' | 'compact' = 'desktop') {
  vi.mocked(useResponsiveLayout).mockReturnValue({
    mode,
    isMobile: mode === 'compact',
    isTablet: false,
    isDesktop: mode === 'desktop',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChatStore).mockImplementation((selector: any) => {
    const state = {
      rightPanelTab: 'inspector' as const,
      setRightPanelTab: mockSetRightPanelTab,
      hasUnreadMessages: false,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = {
      chatOverlayOpen: false,
      setChatOverlayOpen: mockSetChatOverlayOpen,
      toggleChatOverlay: mockToggleChatOverlay,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = { sceneName: 'My Game' };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) => {
    const state = { hydrateFromServer: mockHydrateFromServer };
    return selector(state);
  });
}

describe('EditorLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Desktop layout ────────────────────────────────────────────────────

  it('renders desktop layout with SpawnForge branding', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByText('SpawnForge')).toBeDefined();
  });

  it('renders scene name in top bar', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByText('My Game')).toBeDefined();
  });

  it('renders sidebar in desktop mode', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByTestId('sidebar')).toBeDefined();
  });

  it('renders workspace provider in desktop mode', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByTestId('workspace-provider')).toBeDefined();
  });

  it('renders play controls', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByTestId('play-controls')).toBeDefined();
  });

  it('renders generation status', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(screen.getByTestId('gen-status')).toBeDefined();
  });

  it('calls useGenerationPolling hook', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(useGenerationPolling).toHaveBeenCalled();
  });

  it('calls hydrateFromServer on mount', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    expect(mockHydrateFromServer).toHaveBeenCalled();
  });

  // ── Compact layout ────────────────────────────────────────────────────

  it('renders compact layout with canvas area', () => {
    setupStores('compact');
    render(<EditorLayout />);
    expect(screen.getByTestId('canvas-area')).toBeDefined();
  });

  it('renders mobile toolbar in compact mode', () => {
    setupStores('compact');
    render(<EditorLayout />);
    expect(screen.getByTestId('mobile-toolbar')).toBeDefined();
  });

  it('does not render sidebar in compact mode', () => {
    setupStores('compact');
    render(<EditorLayout />);
    expect(screen.queryByTestId('sidebar')).toBeNull();
  });

  it('opens left drawer on mobile toggle', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-left'));
    expect(screen.getByTestId('scene-hierarchy')).toBeDefined();
  });

  it('opens right drawer on mobile toggle', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));
    expect(screen.getByTestId('inspector')).toBeDefined();
  });

  // ── Help menu ─────────────────────────────────────────────────────────

  it('opens keyboard shortcuts panel', async () => {
    setupStores('desktop');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('open-shortcuts'));
    expect(await screen.findByTestId('shortcuts-panel')).toBeDefined();
  });

  it('opens feedback dialog', async () => {
    setupStores('desktop');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('open-feedback'));
    expect(await screen.findByTestId('feedback-dialog')).toBeDefined();
  });

  // ── Global keyboard shortcuts ─────────────────────────────────────────

  it('Ctrl+K toggles chat overlay', () => {
    setupStores('desktop');
    render(<EditorLayout />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });
    expect(mockToggleChatOverlay).toHaveBeenCalledOnce();
  });

  it('? key toggles cheat sheet', async () => {
    setupStores('desktop');
    render(<EditorLayout />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(await screen.findByTestId('cheat-sheet')).toBeDefined();
  });

  // ── Right panel tabs ──────────────────────────────────────────────────

  it('renders tab list in compact mode right drawer', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));
    // Tabs should be visible (use role=tab to distinguish from panel content)
    expect(screen.getByRole('tab', { name: 'Inspector' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'AI Chat' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Script' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'UI' })).toBeDefined();
  });

  it('switches right panel tab on click', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));
    fireEvent.click(screen.getByRole('tab', { name: 'AI Chat' }));
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('chat');
  });

  // ── Tab ARIA attributes (PF-477) ────────────────────────────────────

  it('tabs have aria-selected matching active state', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));

    const inspectorTab = screen.getByRole('tab', { name: 'Inspector' });
    const chatTab = screen.getByRole('tab', { name: 'AI Chat' });
    const scriptTab = screen.getByRole('tab', { name: 'Script' });
    const uiTab = screen.getByRole('tab', { name: 'UI' });

    // Default tab is 'inspector'
    expect(inspectorTab.getAttribute('aria-selected')).toBe('true');
    expect(chatTab.getAttribute('aria-selected')).toBe('false');
    expect(scriptTab.getAttribute('aria-selected')).toBe('false');
    expect(uiTab.getAttribute('aria-selected')).toBe('false');
  });

  it('tabs have aria-controls linking to tabpanels', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));

    const inspectorTab = screen.getByRole('tab', { name: 'Inspector' });
    expect(inspectorTab.getAttribute('aria-controls')).toBe('tabpanel-inspector');
    expect(inspectorTab.id).toBe('tab-inspector');
  });

  it('tabpanel has role and aria-labelledby linking to tab', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('tab-inspector');
    expect(panel.id).toBe('tabpanel-inspector');
  });

  it('tablist has aria-label', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));

    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('Right panel tabs');
  });

  it('arrow keys navigate between tabs', () => {
    setupStores('compact');
    render(<EditorLayout />);
    fireEvent.click(screen.getByTestId('toggle-right'));

    const tablist = screen.getByRole('tablist');
    // ArrowRight should switch from inspector to chat
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('chat');

    // ArrowLeft should switch from inspector to ui (wraps around)
    mockSetRightPanelTab.mockClear();
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('ui');
  });
});
