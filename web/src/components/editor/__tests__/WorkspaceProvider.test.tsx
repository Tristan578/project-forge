/**
 * Tests for WorkspaceProvider — renders DockviewReact, restores saved layout,
 * handles corrupted layout gracefully, calls applyPreset for default layout,
 * and registers an onDidLayoutChange listener.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { WorkspaceProvider } from '../WorkspaceProvider';
import { useWorkspaceStore } from '@/stores/workspaceStore';

// ── Store mock ─────────────────────────────────────────────────────────────

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

// ── dockview-react mock ────────────────────────────────────────────────────

const mockFromJSON = vi.fn();
const mockOnDidLayoutChange = vi.fn(() => ({ dispose: vi.fn() }));
let capturedOnReady: ((e: { api: unknown }) => void) | null = null;

vi.mock('dockview-react', () => ({
  DockviewReact: ({
    onReady,
    className,
  }: {
    onReady: (e: { api: unknown }) => void;
    className?: string;
  }) => {
    // Capture the onReady callback for manual invocation in tests
    capturedOnReady = onReady;
    return <div data-testid="dockview" className={className} />;
  },
}));

// ── CSS import stub ────────────────────────────────────────────────────────

vi.mock('dockview-react/dist/styles/dockview.css', () => ({}));

// ── Panel component stubs (all panels imported by WorkspaceProvider) ───────

// Core + supplemental eager panels
vi.mock('../CanvasArea', () => ({ CanvasArea: () => null }));
vi.mock('../SceneHierarchy', () => ({ SceneHierarchy: () => null }));
vi.mock('../InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('../ScriptEditorPanel', () => ({ ScriptEditorPanel: () => null }));
vi.mock('../ScriptExplorerPanel', () => ({ ScriptExplorerPanel: () => null }));
vi.mock('../SceneSettings', () => ({ SceneSettings: () => null }));
vi.mock('../AssetPanel', () => ({ AssetPanel: () => null }));
vi.mock('../AudioMixerPanel', () => ({ AudioMixerPanel: () => null }));
vi.mock('../DocsPanel', () => ({ DocsPanel: () => null }));
// Lazy AI/advanced panels
vi.mock('../UIBuilderPanel', () => ({ UIBuilderPanel: () => null }));
vi.mock('../DialogueTreeEditor', () => ({ DialogueTreeEditor: () => null }));
vi.mock('../TilesetPanel', () => ({ TilesetPanel: () => null }));
vi.mock('../TimelinePanel', () => ({ TimelinePanel: () => null }));
vi.mock('../TaskboardPanel', () => ({ TaskboardPanel: () => null }));
vi.mock('../ProceduralAnimPanel', () => ({ ProceduralAnimPanel: () => null }));
vi.mock('../EffectBindingsPanel', () => ({ EffectBindingsPanel: () => null }));
vi.mock('../TutorialPanel', () => ({ TutorialPanel: () => null }));
vi.mock('../AccessibilityPanel', () => ({ AccessibilityPanel: () => null }));
vi.mock('../ReviewPanel', () => ({ ReviewPanel: () => null }));
vi.mock('../BehaviorTreePanel', () => ({ BehaviorTreePanel: () => null }));
vi.mock('../LevelGeneratorPanel', () => ({ LevelGeneratorPanel: () => null }));
vi.mock('../SaveSystemPanel', () => ({ SaveSystemPanel: () => null }));
vi.mock('../NarrativePanel', () => ({ NarrativePanel: () => null }));
vi.mock('../AutoIterationPanel', () => ({ default: () => null }));
vi.mock('../GameAnalyticsPanel', () => ({ GameAnalyticsPanel: () => null }));
vi.mock('../ArtStylePanel', () => ({ ArtStylePanel: () => null }));
vi.mock('../PlaytestPanel', () => ({ PlaytestPanel: () => null }));
vi.mock('../PhysicsFeelPanel', () => ({ PhysicsFeelPanel: () => null }));
vi.mock('../DifficultyPanel', () => ({ DifficultyPanel: () => null }));
vi.mock('../AutoRiggingPanel', () => ({ AutoRiggingPanel: () => null }));
vi.mock('../DesignTeacherPanel', () => ({ DesignTeacherPanel: () => null }));
vi.mock('../EconomyPanel', () => ({ EconomyPanel: () => null }));
vi.mock('../SmartCameraPanel', () => ({ SmartCameraPanel: () => null }));
vi.mock('../WorldBuilderPanel', () => ({ WorldBuilderPanel: () => null }));
vi.mock('../TexturePainterPanel', () => ({ TexturePainterPanel: () => null }));
vi.mock('../IdeaGeneratorPanel', () => ({ IdeaGeneratorPanel: () => null }));
vi.mock('../QuestGeneratorPanel', () => ({ QuestGeneratorPanel: () => null }));
vi.mock('../PacingAnalyzerPanel', () => ({ PacingAnalyzerPanel: () => null }));
vi.mock('../GDDPanel', () => ({ GDDPanel: () => null }));

// ── Workspace lib mocks ────────────────────────────────────────────────────

vi.mock('@/lib/workspace/panelRegistry', () => ({
  UNCLOSABLE_PANELS: new Set(['scene-viewport', 'scene-hierarchy']),
  PANEL_DEFINITIONS: {},
}));

vi.mock('@/lib/workspace/presets', () => ({
  LAYOUT_PRESETS: {
    default: { apply: vi.fn() },
    coding: { apply: vi.fn() },
  },
  LAYOUT_PRESET_IDS: ['default', 'coding'],
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockApi(overrides: Partial<{
  fromJSON: typeof mockFromJSON;
  onDidLayoutChange: typeof mockOnDidLayoutChange;
}> = {}) {
  return {
    fromJSON: overrides.fromJSON ?? mockFromJSON,
    onDidLayoutChange: overrides.onDidLayoutChange ?? mockOnDidLayoutChange,
  };
}

const mockSetApi = vi.fn();
const mockSaveLayout = vi.fn();

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) =>
    selector({ setApi: mockSetApi })
  );
  // Static state accessor used in the debounced save
  (useWorkspaceStore as unknown as { getState: () => unknown }).getState = () => ({
    saveLayout: mockSaveLayout,
  });
}

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnReady = null;
    setupStore();
    localStorage.clear();
  });

  afterEach(() => cleanup());

  // ── Basic rendering ────────────────────────────────────────────────────

  it('renders the DockviewReact wrapper', () => {
    const { container } = render(<WorkspaceProvider />);
    expect(container.querySelector('[data-testid="dockview"]')).not.toBeNull();
  });

  it('renders outer container with full-size classes', () => {
    const { container } = render(<WorkspaceProvider />);
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain('h-full');
    expect(outer.className).toContain('w-full');
  });

  // ── onReady: calls setApi ──────────────────────────────────────────────

  it('calls setApi with the dockview api on ready', () => {
    render(<WorkspaceProvider />);
    const api = makeMockApi();
    capturedOnReady?.({ api });
    expect(mockSetApi).toHaveBeenCalledWith(api);
  });

  // ── onReady: no saved layout → apply default preset ───────────────────

  it('applies default preset when no localStorage layout exists', async () => {
    const { LAYOUT_PRESETS } = await import('@/lib/workspace/presets');
    render(<WorkspaceProvider />);
    const api = makeMockApi();
    capturedOnReady?.({ api });

    expect(mockFromJSON).not.toHaveBeenCalled();
    expect(LAYOUT_PRESETS.default.apply).toHaveBeenCalledWith(api);
  });

  // ── onReady: valid saved layout → fromJSON ─────────────────────────────

  it('restores layout from localStorage when valid JSON exists', async () => {
    const savedLayout = { activePanel: 'scene-viewport', panels: {} };
    localStorage.setItem('forge-workspace-layout', JSON.stringify(savedLayout));

    const { LAYOUT_PRESETS } = await import('@/lib/workspace/presets');
    render(<WorkspaceProvider />);
    const api = makeMockApi();
    capturedOnReady?.({ api });

    expect(mockFromJSON).toHaveBeenCalledWith(savedLayout);
    expect(LAYOUT_PRESETS.default.apply).not.toHaveBeenCalled();
  });

  // ── onReady: corrupted localStorage → fallback to default ─────────────

  it('falls back to default preset when localStorage layout is corrupted', async () => {
    localStorage.setItem('forge-workspace-layout', 'not valid json {{{');

    const { LAYOUT_PRESETS } = await import('@/lib/workspace/presets');
    render(<WorkspaceProvider />);
    const api = makeMockApi();
    capturedOnReady?.({ api });

    expect(mockFromJSON).not.toHaveBeenCalled();
    expect(LAYOUT_PRESETS.default.apply).toHaveBeenCalledWith(api);
  });

  // ── onReady: registers layout-change listener ──────────────────────────

  it('registers an onDidLayoutChange listener', () => {
    render(<WorkspaceProvider />);
    const api = makeMockApi();
    capturedOnReady?.({ api });

    expect(mockOnDidLayoutChange).toHaveBeenCalled();
  });
});
