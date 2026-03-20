'use client';

import { useCallback, useMemo } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { CanvasArea } from './CanvasArea';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { ScriptEditorPanel } from './ScriptEditorPanel';
import { ScriptExplorerPanel } from './ScriptExplorerPanel';
import { SceneSettings } from './SceneSettings';
import { UIBuilderPanel } from './UIBuilderPanel';
import { AssetPanel } from './AssetPanel';
import { AudioMixerPanel } from './AudioMixerPanel';
import { DocsPanel } from './DocsPanel';
import { DialogueTreeEditor } from './DialogueTreeEditor';
import { TilesetPanel } from './TilesetPanel';
import { TimelinePanel } from './TimelinePanel';
import { TaskboardPanel } from './TaskboardPanel';
import { ProceduralAnimPanel } from './ProceduralAnimPanel';
import { EffectBindingsPanel } from './EffectBindingsPanel';
import { TutorialPanel } from './TutorialPanel';
import { lazy, Suspense } from 'react';
// Lazy-load AI feature panels to keep shared bundle under 4MB limit
const AccessibilityPanel = lazy(() => import('./AccessibilityPanel').then(m => ({ default: m.AccessibilityPanel })));
const ReviewPanel = lazy(() => import('./ReviewPanel').then(m => ({ default: m.ReviewPanel })));
const BehaviorTreePanel = lazy(() => import('./BehaviorTreePanel').then(m => ({ default: m.BehaviorTreePanel })));
const LevelGeneratorPanel = lazy(() => import('./LevelGeneratorPanel').then(m => ({ default: m.LevelGeneratorPanel })));
const SaveSystemPanel = lazy(() => import('./SaveSystemPanel').then(m => ({ default: m.SaveSystemPanel })));
const NarrativePanel = lazy(() => import('./NarrativePanel').then(m => ({ default: m.NarrativePanel })));
const AutoIterationPanel = lazy(() => import('./AutoIterationPanel'));
const GameAnalyticsPanel = lazy(() => import('./GameAnalyticsPanel').then(m => ({ default: m.GameAnalyticsPanel })));
const ArtStylePanel = lazy(() => import('./ArtStylePanel').then(m => ({ default: m.ArtStylePanel })));
const PlaytestPanel = lazy(() => import('./PlaytestPanel').then(m => ({ default: m.PlaytestPanel })));
const PhysicsFeelPanel = lazy(() => import('./PhysicsFeelPanel').then(m => ({ default: m.PhysicsFeelPanel })));
const DifficultyPanel = lazy(() => import('./DifficultyPanel').then(m => ({ default: m.DifficultyPanel })));
const AutoRiggingPanel = lazy(() => import('./AutoRiggingPanel').then(m => ({ default: m.AutoRiggingPanel })));
const DesignTeacherPanel = lazy(() => import('./DesignTeacherPanel').then(m => ({ default: m.DesignTeacherPanel })));
const EconomyPanel = lazy(() => import('./EconomyPanel').then(m => ({ default: m.EconomyPanel })));
const SmartCameraPanel = lazy(() => import('./SmartCameraPanel').then(m => ({ default: m.SmartCameraPanel })));
const WorldBuilderPanel = lazy(() => import('./WorldBuilderPanel').then(m => ({ default: m.WorldBuilderPanel })));
const TexturePainterPanel = lazy(() => import('./TexturePainterPanel').then(m => ({ default: m.TexturePainterPanel })));
const IdeaGeneratorPanel = lazy(() => import('./IdeaGeneratorPanel').then(m => ({ default: m.IdeaGeneratorPanel })));
const QuestGeneratorPanel = lazy(() => import('./QuestGeneratorPanel').then(m => ({ default: m.QuestGeneratorPanel })));
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { UNCLOSABLE_PANELS } from '@/lib/workspace/panelRegistry';
import { LAYOUT_PRESETS } from '@/lib/workspace/presets';

// ---- Panel wrappers ----
// Each dockview panel component receives IDockviewPanelProps.
// We wrap our existing components so they fill the panel container.

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

function UIBuilderPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <UIBuilderPanel />
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

function DialogueEditorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <DialogueTreeEditor />
    </div>
  );
}

function TilesetPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <TilesetPanel />
    </div>
  );
}

function TimelinePanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <TimelinePanel />
    </div>
  );
}

function TaskboardPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <TaskboardPanel />
    </div>
  );
}

function ProceduralAnimPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <ProceduralAnimPanel />
    </div>
  );
}

function ReviewPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><ReviewPanel /></Suspense>
    </div>
  );
}

function AccessibilityPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><AccessibilityPanel /></Suspense>
    </div>
  );
}

function TutorialPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <TutorialPanel />
    </div>
  );
}

function EffectBindingsPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <EffectBindingsPanel />
    </div>
  );
}

function BehaviorTreePanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><BehaviorTreePanel /></Suspense>
    </div>
  );
}

function LevelGeneratorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><LevelGeneratorPanel /></Suspense>
    </div>
  );
}

function SaveSystemPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><SaveSystemPanel /></Suspense>
    </div>
  );
}

function NarrativePanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><NarrativePanel /></Suspense>
    </div>
  );
}

function AutoIterationPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><AutoIterationPanel /></Suspense>
    </div>
  );
}

function GameAnalyticsPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><GameAnalyticsPanel /></Suspense>
    </div>
  );
}

function ArtStylePanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><ArtStylePanel /></Suspense>
    </div>
  );
}

function PlaytestPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><PlaytestPanel /></Suspense>
    </div>
  );
}

function PhysicsFeelPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><PhysicsFeelPanel /></Suspense>
    </div>
  );
}

function DifficultyPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><DifficultyPanel /></Suspense>
    </div>
  );
}

function AutoRiggingPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><AutoRiggingPanel /></Suspense>
    </div>
  );
}

function DesignTeacherPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><DesignTeacherPanel /></Suspense>
    </div>
  );
}

function EconomyPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><EconomyPanel /></Suspense>
    </div>
  );
}

function SmartCameraPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><SmartCameraPanel /></Suspense>
    </div>
  );
}

function WorldBuilderPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><WorldBuilderPanel /></Suspense>
    </div>
  );
}

function TexturePainterPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><TexturePainterPanel /></Suspense>
    </div>
  );
}

function IdeaGeneratorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}><IdeaGeneratorPanel /></Suspense>
    </div>
  );
}

function QuestGeneratorPanelWrapper(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-zinc-900">
      <Suspense fallback={<div className="p-4 text-zinc-500">Loading...</div>}>
        <QuestGeneratorPanel />
      </Suspense>
    </div>
  );
}

// ---- Component registry ----
const PANEL_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  'scene-viewport': SceneViewportPanel,
  'scene-hierarchy': SceneHierarchyPanel,
  inspector: InspectorPanelWrapper,
  'script-editor': ScriptEditorPanelWrapper,
  'script-explorer': ScriptExplorerPanelWrapper,
  'scene-settings': SceneSettingsPanel,
  'ui-builder': UIBuilderPanelWrapper,
  'asset-browser': AssetPanelWrapper,
  'audio-mixer': AudioMixerPanelWrapper,
  docs: DocsPanelWrapper,
  'dialogue-editor': DialogueEditorPanelWrapper,
  tileset: TilesetPanelWrapper,
  timeline: TimelinePanelWrapper,
  taskboard: TaskboardPanelWrapper,
  'procedural-anim': ProceduralAnimPanelWrapper,
  'effect-bindings': EffectBindingsPanelWrapper,
  tutorial: TutorialPanelWrapper,
  accessibility: AccessibilityPanelWrapper,
  review: ReviewPanelWrapper,
  'behavior-tree': BehaviorTreePanelWrapper,
  'level-generator': LevelGeneratorPanelWrapper,
  'save-system': SaveSystemPanelWrapper,
  narrative: NarrativePanelWrapper,
  'auto-iteration': AutoIterationPanelWrapper,
  'game-analytics': GameAnalyticsPanelWrapper,
  'art-style': ArtStylePanelWrapper,
  playtest: PlaytestPanelWrapper,
  'physics-feel': PhysicsFeelPanelWrapper,
  difficulty: DifficultyPanelWrapper,
  'auto-rigging': AutoRiggingPanelWrapper,
  'design-teacher': DesignTeacherPanelWrapper,
  economy: EconomyPanelWrapper,
  'smart-camera': SmartCameraPanelWrapper,
  'world-builder': WorldBuilderPanelWrapper,
  'texture-painter': TexturePainterPanelWrapper,
  'idea-generator': IdeaGeneratorPanelWrapper,
  'quest-generator': QuestGeneratorPanelWrapper,
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
