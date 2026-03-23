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
const VoiceProfilePanel = lazy(() =>
  import('./VoiceProfilePanel').then((m) => ({ default: m.VoiceProfilePanel }))
);
const ShaderEditorPanel = lazy(() =>
  import('./ShaderEditorPanel').then((m) => ({ default: m.ShaderEditorPanel }))
);
const PerformanceProfilerPanel = lazy(() =>
  import('./PerformanceProfiler').then((m) => ({ default: m.PerformanceProfiler }))
);

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useUserStore } from '@/stores/userStore';
import { UNCLOSABLE_PANELS } from '@/lib/workspace/panelRegistry';
import { LAYOUT_PRESETS } from '@/lib/workspace/presets';
import { canAccessPanel } from '@/lib/ai/tierAccess';
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

// ---- Lazy panel wrapper — wraps each lazy component in Suspense ----
function withSuspense(Component: React.ComponentType): React.FunctionComponent<IDockviewPanelProps> {
  return function LazyPanelWrapper(_props: IDockviewPanelProps) {
    return (
      <div className="h-full w-full overflow-hidden bg-zinc-900">
        <Suspense fallback={<PanelLoadingSkeleton />}>
          <Component />
        </Suspense>
      </div>
    );
  };
}

// ---- Tier-gated lazy panel wrapper ----
// Wraps a lazy component with both Suspense and a tier access check.
// If the user's tier is insufficient, renders LockedPanelOverlay instead.
function withTierGate(
  panelId: string,
  Component: React.ComponentType,
): React.FunctionComponent<IDockviewPanelProps> {
  return function TierGatedPanel(_props: IDockviewPanelProps) {
    const tier = useUserStore((s) => s.tier);
    if (!canAccessPanel(panelId, tier)) {
      return (
        <div className="h-full w-full overflow-hidden bg-zinc-900">
          <LockedPanelOverlay panelId={panelId} />
        </div>
      );
    }
    return (
      <div className="h-full w-full overflow-hidden bg-zinc-900">
        <Suspense fallback={<PanelLoadingSkeleton />}>
          <Component />
        </Suspense>
      </div>
    );
  };
}

// ---- Panel wrappers ----
// Each dockview panel component receives IDockviewPanelProps.
// Core panels are wrapped directly; lazy panels use withSuspense().
// AI / advanced panels that require a subscription use withTierGate().

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
  // AI / advanced — lazy, no tier restriction
  'ui-builder': withSuspense(UIBuilderPanel),
  'dialogue-editor': withSuspense(DialogueTreeEditor),
  tileset: withSuspense(TilesetPanel),
  timeline: withSuspense(TimelinePanel),
  taskboard: withSuspense(TaskboardPanel),
  'effect-bindings': withSuspense(EffectBindingsPanel),
  // AI panels — tier-gated (hobbyist+)
  tutorial: withTierGate('tutorial', TutorialPanel),
  accessibility: withTierGate('accessibility', AccessibilityPanel),
  review: withTierGate('review', ReviewPanel),
  'design-teacher': withTierGate('design-teacher', DesignTeacherPanel),
  'idea-generator': withTierGate('idea-generator', IdeaGeneratorPanel),
  // AI panels — tier-gated (creator+)
  'behavior-tree': withTierGate('behavior-tree', BehaviorTreePanel),
  'level-generator': withTierGate('level-generator', LevelGeneratorPanel),
  'save-system': withTierGate('save-system', SaveSystemPanel),
  narrative: withTierGate('narrative', NarrativePanel),
  'game-analytics': withTierGate('game-analytics', GameAnalyticsPanel),
  'art-style': withTierGate('art-style', ArtStylePanel),
  'physics-feel': withTierGate('physics-feel', PhysicsFeelPanel),
  difficulty: withTierGate('difficulty', DifficultyPanel),
  economy: withTierGate('economy', EconomyPanel),
  'smart-camera': withTierGate('smart-camera', SmartCameraPanel),
  'world-builder': withTierGate('world-builder', WorldBuilderPanel),
  'texture-painter': withTierGate('texture-painter', TexturePainterPanel),
  'quest-generator': withTierGate('quest-generator', QuestGeneratorPanel),
  'pacing-analyzer': withTierGate('pacing-analyzer', PacingAnalyzerPanel),
  'procedural-anim': withTierGate('procedural-anim', ProceduralAnimPanel),
  'gdd-generator': withTierGate('gdd-generator', GDDPanelComponent),
  'performance-profiler': withSuspense(PerformanceProfilerPanel),
  // AI panels — tier-gated (pro only)
  'auto-iteration': withTierGate('auto-iteration', AutoIterationPanel),
  playtest: withTierGate('playtest', PlaytestPanel),
  'auto-rigging': withTierGate('auto-rigging', AutoRiggingPanel),
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
