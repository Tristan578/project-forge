/**
 * Layout preset definitions for the dockview workspace.
 * Each preset uses the DockviewApi.addPanel() calls to build a layout programmatically.
 * This is more reliable than JSON serialization for initial layouts since it doesn't
 * depend on exact grid dimensions.
 */

import type { DockviewApi, IDockviewPanel } from 'dockview-react';
import { PANEL_DEFINITIONS } from './panelRegistry';

/** Helper to create a relative-to-panel position (avoids TS union discrimination issues). */
function relativeToPanel(direction: 'left' | 'right' | 'up' | 'down' | 'within', referencePanel: string | IDockviewPanel) {
  return { direction, referencePanel } as const;
}

export type LayoutPresetId = 'default' | 'scripting' | 'presentation';

export interface LayoutPreset {
  id: LayoutPresetId;
  name: string;
  description: string;
  apply: (api: DockviewApi) => void;
}

function panelOpts(id: string) {
  const def = PANEL_DEFINITIONS[id];
  if (!def) return {};
  return {
    minimumWidth: def.minWidth,
    minimumHeight: def.minHeight,
    renderer: def.renderer as 'onlyWhenVisible' | 'always' | undefined,
  };
}

export const LAYOUT_PRESETS: Record<LayoutPresetId, LayoutPreset> = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Balanced layout with hierarchy, viewport, and inspector',
    apply: (api) => {
      // Center: Scene viewport
      const viewport = api.addPanel({
        id: 'scene-viewport',
        component: 'scene-viewport',
        title: 'Scene',
        ...panelOpts('scene-viewport'),
      });

      // Left: Scene hierarchy
      api.addPanel({
        id: 'scene-hierarchy',
        component: 'scene-hierarchy',
        title: 'Hierarchy',
        position: relativeToPanel('left', viewport),
        initialWidth: 220,
        ...panelOpts('scene-hierarchy'),
      });

      // Right: Inspector
      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: relativeToPanel('right', viewport),
        initialWidth: 320,
        ...panelOpts('inspector'),
      });

      // Right tab: Scene Settings (behind Inspector)
      api.addPanel({
        id: 'scene-settings',
        component: 'scene-settings',
        title: 'Settings',
        position: relativeToPanel('within', 'inspector'),
        inactive: true,
        ...panelOpts('scene-settings'),
      });

      // Right tab: UI Builder (behind Inspector)
      api.addPanel({
        id: 'ui-builder',
        component: 'ui-builder',
        title: 'UI Builder',
        position: relativeToPanel('within', 'inspector'),
        inactive: true,
        ...panelOpts('ui-builder'),
      });

      // Bottom: Asset browser
      api.addPanel({
        id: 'asset-browser',
        component: 'asset-browser',
        title: 'Assets',
        position: relativeToPanel('down', viewport),
        initialHeight: 150,
        ...panelOpts('asset-browser'),
      });

      // Bottom tab: Audio Mixer (behind Assets)
      api.addPanel({
        id: 'audio-mixer',
        component: 'audio-mixer',
        title: 'Audio',
        position: relativeToPanel('within', 'asset-browser'),
        inactive: true,
        ...panelOpts('audio-mixer'),
      });

      // Ensure viewport group is the active/focused group
      viewport.api.setActive();
    },
  },

  scripting: {
    id: 'scripting',
    name: 'Scripting',
    description: 'Script editor front and center with explorer and console',
    apply: (api) => {
      // Center: Script editor (large)
      const editor = api.addPanel({
        id: 'script-editor',
        component: 'script-editor',
        title: 'Script Editor',
        ...panelOpts('script-editor'),
      });

      // Center tab: Scene viewport (behind script editor)
      api.addPanel({
        id: 'scene-viewport',
        component: 'scene-viewport',
        title: 'Scene',
        position: relativeToPanel('within', editor),
        inactive: true,
        ...panelOpts('scene-viewport'),
      });

      // Left: Script explorer
      api.addPanel({
        id: 'script-explorer',
        component: 'script-explorer',
        title: 'Scripts',
        position: relativeToPanel('left', editor),
        initialWidth: 200,
        ...panelOpts('script-explorer'),
      });

      // Left tab: Hierarchy (behind Script explorer)
      api.addPanel({
        id: 'scene-hierarchy',
        component: 'scene-hierarchy',
        title: 'Hierarchy',
        position: relativeToPanel('within', 'script-explorer'),
        inactive: true,
        ...panelOpts('scene-hierarchy'),
      });

      // Right: Inspector (narrow)
      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: relativeToPanel('right', editor),
        initialWidth: 240,
        ...panelOpts('inspector'),
      });

      // Bottom: Asset browser
      api.addPanel({
        id: 'asset-browser',
        component: 'asset-browser',
        title: 'Assets',
        position: relativeToPanel('down', editor),
        initialHeight: 120,
        ...panelOpts('asset-browser'),
      });

      // Ensure script editor is the active/focused panel
      editor.api.setActive();
    },
  },

  presentation: {
    id: 'presentation',
    name: 'Presentation',
    description: 'Maximized viewport with minimal UI',
    apply: (api) => {
      // Center: Scene viewport (maximized)
      const viewport = api.addPanel({
        id: 'scene-viewport',
        component: 'scene-viewport',
        title: 'Scene',
        ...panelOpts('scene-viewport'),
      });

      // Right: Inspector (narrow, for quick tweaks)
      api.addPanel({
        id: 'inspector',
        component: 'inspector',
        title: 'Inspector',
        position: relativeToPanel('right', viewport),
        initialWidth: 240,
        ...panelOpts('inspector'),
      });

      // Bottom: Asset browser (short)
      api.addPanel({
        id: 'asset-browser',
        component: 'asset-browser',
        title: 'Assets',
        position: relativeToPanel('down', viewport),
        initialHeight: 100,
        ...panelOpts('asset-browser'),
      });

      // Ensure viewport is the active/focused panel
      viewport.api.setActive();
    },
  },
};
