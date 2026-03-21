'use client';

import type React from 'react';
import { lazy, Suspense, useCallback, useMemo } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

// ---- Core panels — eager imports (always needed, affect initial render) ----
import { CanvasArea } from './CanvasArea';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { ScriptEditorPanel } from './ScriptEditorPanel';

// ---- Supplemental panels — eager imports (commonly used, worth pre-loading) ----
import { ScriptExplorerPanel } from './ScriptExplorerPanel';
import { SceneSettings } from './SceneSettings';
import { AssetPanel } from './AssetPanel';
import { AudioMixerPanel } from './AudioMixerPanel';
import { DocsPanel } from './DocsPanel';

// ---- AI / advanced panels — lazy imports (opened on demand) ----
const UIBuilderPanel = lazy(() =>
  import('./UIBuilderPanel').then((m) => ({ default: m.UIBuilderPanel }))
);
const DialogueTreeEditor = lazy(() =>
  import('./DialogueTreeEditor').then((m) => ({ default: m.DialogueTreeEditor }))
);
const TilesetPanel = lazy(() =>
  import('./TilesetPanel').then((m) => ({ default: m.TilesetPanel }))
);
const TimelinePanel = lazy(() =>
  import('./TimelinePanel').then((m) => ({ default: m.TimelinePanel }))
);
const TaskboardPanel = lazy(() =>
  import('./TaskboardPanel').then((m) => ({ default: m.TaskboardPanel }))
);
const ProceduralAnimPanel = lazy(() =>
  import('./ProceduralAnimPanel').then((m) => ({ default: m.ProceduralAnimPanel }))
);
const EffectBindingsPanel = lazy(() =>
  import('./EffectBindingsPanel').then((m) => ({ default: m.EffectBindingsPanel }))
);
const TutorialPanel = lazy(() =>
  import('./TutorialPanel').then((m) => ({ default: m.TutorialPanel }))
);
const AccessibilityPanel = lazy(() =>
  import('./AccessibilityPanel').then((m) => ({ default: m.AccessibilityPanel }))
);
const ReviewPanel = lazy(() =>
  import('./ReviewPanel').then((m) => ({ default: m.ReviewPanel }))
);
const BehaviorTreePanel = lazy(() =>
  import('./BehaviorTreePanel').then((m) => ({ default: m.BehaviorTreePanel }))
);
const LevelGeneratorPanel = lazy(() =>
  import('./LevelGeneratorPanel').then((m) => ({ default: m.LevelGeneratorPanel }))
);
const SaveSystemPanel = lazy(() =>
  import('./SaveSystemPanel').then((m) => ({ default: m.SaveSystemPanel }))
);
const NarrativePanel = lazy(() =>
  import('./NarrativePanel').then((m) => ({ default: m.NarrativePanel }))
);
const AutoIterationPanel = lazy(() =>
  import('./AutoIterationPanel').then((m) => ({ default: m.default }))
);
const GameAnalyticsPanel = lazy(() =>
  import('./GameAnalyticsPanel').then((m) => ({ default: m.GameAnalyticsPanel }))
);
const ArtStylePanel = lazy(() =>
  import('./ArtStylePanel').then((m) => ({ default: m.ArtStylePanel }))
);
const PlaytestPanel = lazy(() =>
  import('./PlaytestPanel').then((m) => ({ default: m.PlaytestPanel }))
);
const PhysicsFeelPanel = lazy(() =>
  import('./PhysicsFeelPanel').then((m) => ({ default: m.PhysicsFeelPanel }))
);
const DifficultyPanel = lazy(() =>
  import('./DifficultyPanel').then((m) => ({ default: m.DifficultyPanel }))
);
const AutoRiggingPanel = lazy(() =>
  import('./AutoRiggingPanel').then((m) => ({ default: m.AutoRiggingPanel }))
);
const DesignTeacherPanel = lazy(() =>
  import('./DesignTeacherPanel').then((m) => ({ default: m.DesignTeacherPanel }))
);
const EconomyPanel = lazy(() =>
  import('./EconomyPanel').then((m) => ({ default: m.EconomyPanel }))
);
const SmartCameraPanel = lazy(() =>
  import('./SmartCameraPanel').then((m) => ({ default: m.SmartCameraPanel }))
);
const WorldBuilderPanel = lazy(() =>
  import('./WorldBuilderPanel').then((m) => ({ default: m.WorldBuilderPanel }))
);
const TexturePainterPanel = lazy(() =>
  import('./TexturePainterPanel').then((m) => ({ default: m.TexturePainterPanel }))
);
const IdeaGeneratorPanel = lazy(() =>
  import('./IdeaGeneratorPanel').then((m) => ({ default: m.IdeaGeneratorPanel }))
);
const QuestGeneratorPanel = lazy(() =>
  import('./QuestGeneratorPanel').then((m) => ({ default: m.QuestGeneratorPanel }))
);
const PacingAnalyzerPanel = lazy(() =>
  import('./PacingAnalyzerPanel').then((m) => ({ default: m.PacingAnalyzerPanel }))
);

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { UNCLOSABLE_PANELS } from '@/lib/workspace/panelRegistry';
import { LAYOUT_PRESETS } from '@/lib/workspace/presets';
import { LockedPanelOverlay } from './LockedPanelOverlay';

// ---- Loading skeleton shown while a lazy panel is fetched ----
function PanelLoadingSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2 bg-zinc-900 p-3" role="status" aria-label="Loading panel">
      <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-700" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-700" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-700" />
      <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-zinc-700" />
    </div>
  );
}

// ---- Lazy panel wrapper — wraps each lazy component in Suspense + tier access lock ----
function withSuspense(Component: React.ComponentType, panelId: string): React.FunctionComponent<IDockviewPanelProps> {
  return function LazyPanelWrapper(_props: IDockviewPanelProps) {
    return (
      <div className="h-full w-full overflow-hidden bg-zinc-900">
        <LockedPanelOverlay panelId={panelId}>
          <Suspense fallback={<PanelLoadingSkeleton />}>
            <Component />
          </Suspense>
        </LockedPanelOverlay>
      </div>
    );
  };
}

// ---- Panel wrappers ----
// Each dockview panel component receives IDockviewPanelProps.
// Core panels are wrapped directly; lazy panels use withSuspense().

function SceneViewportPanel(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      <CanvasArea />
    </div>
  );
}

function SceneHierarchyPanel(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <SceneHierarchy />
    </div>
  );
}

function InspectorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <InspectorPanel />
    </div>
  );
}

function ScriptEditorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <ScriptEditorPanel />
    </div>
  );
}

function ScriptExplorerPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <ScriptExplorerPanel />
    </div>
  );
}

function SceneSettingsPanel(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <SceneSettings />
    </div>
  );
}

function AssetPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <AssetPanel />
    </div>
  );
}

function AudioMixerPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <AudioMixerPanel />
    </div>
  );
}

function DocsPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <DocsPanel />
    </div>
  );
}

// ---- Component registry ----
const PANEL_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  // Core — eager
  'scene-viewport': SceneViewportPanel,
  'scene-hierarchy': SceneHierarchyPanel,
  inspector: InspectorPanelWrapper,
  'script-editor': ScriptEditorPanelWrapper,
  // Supplemental — eager
  'script-explorer': ScriptExplorerPanelWrapper,
  'scene-settings': SceneSettingsPanel,
  'asset-browser': AssetPanelWrapper,
  'audio-mixer': AudioMixerPanelWrapper,
  docs: DocsPanelWrapper,
  // AI / advanced — lazy (panelId forwarded for tier access gating)
  'ui-builder': withSuspense(UIBuilderPanel, 'ui-builder'),
  'dialogue-editor': withSuspense(DialogueTreeEditor, 'dialogue-editor'),
  tileset: withSuspense(TilesetPanel, 'tileset'),
  timeline: withSuspense(TimelinePanel, 'timeline'),
  taskboard: withSuspense(TaskboardPanel, 'taskboard'),
  'procedural-anim': withSuspense(ProceduralAnimPanel, 'procedural-anim'),
  'effect-bindings': withSuspense(EffectBindingsPanel, 'effect-bindings'),
  tutorial: withSuspense(TutorialPanel, 'tutorial'),
  accessibility: withSuspense(AccessibilityPanel, 'accessibility'),
  review: withSuspense(ReviewPanel, 'review'),
  'behavior-tree': withSuspense(BehaviorTreePanel, 'behavior-tree'),
  'level-generator': withSuspense(LevelGeneratorPanel, 'level-generator'),
  'save-system': withSuspense(SaveSystemPanel, 'save-system'),
  narrative: withSuspense(NarrativePanel, 'narrative'),
  'auto-iteration': withSuspense(AutoIterationPanel, 'auto-iteration'),
  'game-analytics': withSuspense(GameAnalyticsPanel, 'game-analytics'),
  'art-style': withSuspense(ArtStylePanel, 'art-style'),
  playtest: withSuspense(PlaytestPanel, 'playtest'),
  'physics-feel': withSuspense(PhysicsFeelPanel, 'physics-feel'),
  difficulty: withSuspense(DifficultyPanel, 'difficulty'),
  'auto-rigging': withSuspense(AutoRiggingPanel, 'auto-rigging'),
  'design-teacher': withSuspense(DesignTeacherPanel, 'design-teacher'),
  economy: withSuspense(EconomyPanel, 'economy'),
  'smart-camera': withSuspense(SmartCameraPanel, 'smart-camera'),
  'world-builder': withSuspense(WorldBuilderPanel, 'world-builder'),
  'texture-painter': withSuspense(TexturePainterPanel, 'texture-painter'),
  'idea-generator': withSuspense(IdeaGeneratorPanel, 'idea-generator'),
  'quest-generator': withSuspense(QuestGeneratorPanel, 'quest-generator'),
  'pacing-analyzer': withSuspense(PacingAnalyzerPanel, 'pacing-analyzer'),
};

// ---- Custom tab that hides close button for unclosable panels ----
function DefaultTab(props: IDockviewPanelHeaderProps) {
  const { api } = props;
  const isUnclosable = UNCLOSABLE_PANELS.has(api.id);

  return (
    <div className="dv-default-tab">
      <div className="dv-default-tab-content">
        <span>{api.title}</span>
      </div>
      {!isUnclosable && (
        <div className="dv-default-tab-action" onClick={() => api.close()}>
          <svg width="8" height="8" viewBox="0 0 8 8" className="dv-svg">
            <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
            <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ---- Debounce helper ----
function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ---- Main workspace provider ----
export function WorkspaceProvider() {
  const setApi = useWorkspaceStore((s) => s.setApi);

  // Debounced layout save — reads store directly to avoid ref-during-render
  const debouncedSave = useMemo(
    () => debounce(() => useWorkspaceStore.getState().saveLayout(), 500),
    []
  );

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      setApi(api);

      // Try to restore saved layout
      let restored = false;
      try {
        const raw = localStorage.getItem('forge-workspace-layout');
        if (raw) {
          const data = JSON.parse(raw);
          api.fromJSON(data);
          restored = true;
        }
      } catch {
        // Corrupted layout, fall back to default
      }

      if (!restored) {
        LAYOUT_PRESETS.default.apply(api);
      }

      // Auto-save on layout changes (debounced)
      api.onDidLayoutChange(() => {
        debouncedSave();
      });
    },
    [setApi, debouncedSave]
  );

  // Prevent close on unclosable panels via will-close interception
  // (dockview doesn't have onWillClose, so we use the custom tab approach above)

  return (
    <div className="h-full w-full dockview-theme-forge">
      <DockviewReact
        components={PANEL_COMPONENTS}
        defaultTabComponent={DefaultTab}
        onReady={handleReady}
        className="h-full w-full"
      />
    </div>
  );
}
