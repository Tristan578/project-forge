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
