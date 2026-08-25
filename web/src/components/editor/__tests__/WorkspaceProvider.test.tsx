/**
 * Tests for WorkspaceProvider — renders DockviewReact, restores saved layout,
 * handles corrupted layout gracefully, calls applyPreset for default layout,
 * and registers an onDidLayoutChange listener.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDockviewPanelProps } from 'dockview-react';
import { render, cleanup, screen, waitFor } from '@/test/utils/componentTestUtils';
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
// The real DockviewReact is what instantiates the panel components, so the
// stub has to hand them back or every wrapper in this file is unreachable.
let capturedComponents: Record<string, React.FunctionComponent<IDockviewPanelProps>> | null =
  null;

vi.mock('dockview-react', () => ({
  DockviewReact: ({
    onReady,
    className,
    components,
  }: {
    onReady: (e: { api: unknown }) => void;
    className?: string;
    components?: Record<string, React.FunctionComponent<IDockviewPanelProps>>;
  }) => {
    // Capture the onReady callback for manual invocation in tests
    capturedOnReady = onReady;
    capturedComponents = components ?? null;
    return <div data-testid="dockview" className={className} />;
  },
}));

// ── CSS import stub ────────────────────────────────────────────────────────

vi.mock('dockview-react/dist/styles/dockview.css', () => ({}));

// ── Panel component stubs (all panels imported by WorkspaceProvider) ───────

// Core + supplemental eager panels
vi.mock('@/components/editor/CanvasArea', () => ({ CanvasArea: () => null }));
vi.mock('@/components/editor/SceneHierarchy', () => ({ SceneHierarchy: () => null }));
vi.mock('@/components/editor/InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('@/components/editor/ScriptEditorPanel', () => ({ ScriptEditorPanel: () => null }));
vi.mock('@/components/editor/ScriptExplorerPanel', () => ({ ScriptExplorerPanel: () => null }));
vi.mock('@/components/editor/SceneSettings', () => ({ SceneSettings: () => null }));
vi.mock('@/components/editor/AssetPanel', () => ({ AssetPanel: () => null }));
vi.mock('@/components/editor/AudioMixerPanel', () => ({ AudioMixerPanel: () => null }));
vi.mock('@/components/editor/DocsPanel', () => ({ DocsPanel: () => null }));
// Lazy AI/advanced panels
vi.mock('@/components/editor/UIBuilderPanel', () => ({ UIBuilderPanel: () => null }));
vi.mock('@/components/editor/DialogueTreeEditor', () => ({ DialogueTreeEditor: () => null }));
vi.mock('@/components/editor/TilesetPanel', () => ({ TilesetPanel: () => null }));
vi.mock('@/components/editor/TimelinePanel', () => ({ TimelinePanel: () => null }));
vi.mock('@/components/editor/TaskboardPanel', () => ({ TaskboardPanel: () => null }));
vi.mock('@/components/editor/ProceduralAnimPanel', () => ({ ProceduralAnimPanel: () => null }));
vi.mock('@/components/editor/EffectBindingsPanel', () => ({ EffectBindingsPanel: () => null }));
vi.mock('@/components/editor/TutorialPanel', () => ({ TutorialPanel: () => null }));
vi.mock('@/components/editor/AccessibilityPanel', () => ({ AccessibilityPanel: () => null }));
vi.mock('@/components/editor/ReviewPanel', () => ({ ReviewPanel: () => null }));
vi.mock('@/components/editor/BehaviorTreePanel', () => ({ BehaviorTreePanel: () => null }));
vi.mock('@/components/editor/LevelGeneratorPanel', () => ({ LevelGeneratorPanel: () => null }));
vi.mock('@/components/editor/SaveSystemPanel', () => ({ SaveSystemPanel: () => null }));
vi.mock('@/components/editor/NarrativePanel', () => ({ NarrativePanel: () => null }));
vi.mock('@/components/editor/AutoIterationPanel', () => ({ default: () => null }));
vi.mock('@/components/editor/GameAnalyticsPanel', () => ({ GameAnalyticsPanel: () => null }));
vi.mock('@/components/editor/ArtStylePanel', () => ({ ArtStylePanel: () => null }));
vi.mock('@/components/editor/PlaytestPanel', () => ({ PlaytestPanel: () => null }));
vi.mock('@/components/editor/PhysicsFeelPanel', () => ({ PhysicsFeelPanel: () => null }));
vi.mock('@/components/editor/DifficultyPanel', () => ({ DifficultyPanel: () => null }));
vi.mock('@/components/editor/AutoRiggingPanel', () => ({ AutoRiggingPanel: () => null }));
vi.mock('@/components/editor/DesignTeacherPanel', () => ({ DesignTeacherPanel: () => null }));
vi.mock('@/components/editor/EconomyPanel', () => ({ EconomyPanel: () => null }));
vi.mock('@/components/editor/SmartCameraPanel', () => ({ SmartCameraPanel: () => null }));
vi.mock('@/components/editor/WorldBuilderPanel', () => ({ WorldBuilderPanel: () => null }));
vi.mock('@/components/editor/TexturePainterPanel', () => ({ TexturePainterPanel: () => null }));
vi.mock('@/components/editor/IdeaGeneratorPanel', () => ({ IdeaGeneratorPanel: () => null }));
vi.mock('@/components/editor/QuestGeneratorPanel', () => ({ QuestGeneratorPanel: () => null }));
vi.mock('@/components/editor/PacingAnalyzerPanel', () => ({ PacingAnalyzerPanel: () => null }));
vi.mock('@/components/editor/GDDPanel', () => ({ GDDPanel: () => null }));
vi.mock('@/components/editor/VoiceProfilePanel', () => ({ VoiceProfilePanel: () => null }));
vi.mock('@/components/editor/ShaderEditorPanel', () => ({ ShaderEditorPanel: () => null }));

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
    vi.resetModules();
    vi.clearAllMocks();
    capturedOnReady = null;
    capturedComponents = null;
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

  // ── Panel chrome theming ───────────────────────────────────────────────

  /**
   * PF-1229 finding E2. Every panel shell and the lazy-loading skeleton were
   * painted with hardcoded `zinc-*` classes, which do not participate in the
   * theme at all. The worst case is not merely off-palette: in the light
   * theme `--sf-text` IS `#18181b`, the same value `bg-zinc-900` paints, so a
   * panel caught mid-load rendered black-on-black at 1.00:1.
   */
  describe('panel chrome theming', () => {
    function renderPanel(panelId: string) {
      render(<WorkspaceProvider />);
      const Panel = capturedComponents?.[panelId];
      if (!Panel) {
        throw new Error(`dockview was given no component for panel '${panelId}'`);
      }
      return render(<Panel {...({} as IDockviewPanelProps)} />);
    }

    // ONE test covers both the shell and the skeleton on purpose: `React.lazy`
    // caches its resolved module on the component object, which outlives
    // `vi.resetModules()` because `WorkspaceProvider` is imported statically.
    // Only the FIRST render in this file suspends, so a second test asking for
    // the skeleton would find the panel already resolved.
    it('paints the lazy panel shell and its loading skeleton from theme tokens', async () => {
      const { container } = renderPanel('ui-builder');

      const shell = container.firstElementChild as HTMLElement;
      expect(shell.className).toContain('bg-[var(--sf-bg-surface)]');
      expect(shell.className).not.toMatch(/\bzinc-/);

      const skeleton = screen.getByRole('status', { name: 'Loading panel' });
      expect(skeleton.className).toContain('bg-[var(--sf-bg-surface)]');
      expect(skeleton.className).not.toMatch(/\bzinc-/);

      const bars = Array.from(skeleton.children);
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        // `--sf-bg-overlay` is the one token that reproduces the previous
        // hardcoded bar/panel separation (1.70:1 in dark) rather than washing
        // the bars out; `--sf-bg-elevated` drops dark to 1.19:1.
        expect(bar.className).toContain('bg-[var(--sf-bg-overlay)]');
        expect(bar.className).not.toMatch(/\bzinc-/);
      }

      // Let the lazy import settle so the skeleton unmounts inside act().
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    });

    it('leaves no hardcoded palette class anywhere in the module', () => {
      // Fifteen call sites were converted, and the two tests above can only
      // reach four of them — the tier-gated branches in particular need a
      // user tier this suite does not stub. A file-scoped scan covers the
      // rest without pretending to police the whole directory.
      const source = readFileSync(
        resolve(process.cwd(), 'src/components/editor/WorkspaceProvider.tsx'),
        'utf-8',
      );
      // Fail closed: a mis-resolved path would otherwise pass vacuously.
      expect(source).toContain('function PanelLoadingSkeleton()');
      expect(source).not.toMatch(/\bbg-zinc-/);
      expect(source).not.toMatch(/\b(?:text|border)-zinc-/);
    });
  });
});
