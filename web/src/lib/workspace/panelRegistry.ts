/**
 * Panel registry for the dockview workspace system.
 * Maps panel IDs to metadata used by WorkspaceProvider and preset layouts.
 */

export interface PanelDefinition {
  id: string;
  title: string;
  /** Key into the `components` prop of DockviewReact */
  component: string;
  /** Default minimum width in pixels */
  minWidth?: number;
  /** Default minimum height in pixels */
  minHeight?: number;
  /** If true, panel cannot be closed by the user */
  unclosable?: boolean;
  /** Renderer strategy: 'always' keeps DOM alive when hidden (for canvas/editors) */
  renderer?: 'onlyWhenVisible' | 'always';
}

export const PANEL_DEFINITIONS: Record<string, PanelDefinition> = {
  'scene-viewport': {
    id: 'scene-viewport',
    title: 'Scene',
    component: 'scene-viewport',
    minWidth: 400,
    minHeight: 300,
    unclosable: true,
    renderer: 'always',
  },
  'script-editor': {
    id: 'script-editor',
    title: 'Script Editor',
    component: 'script-editor',
    minWidth: 300,
    minHeight: 200,
  },
  'scene-hierarchy': {
    id: 'scene-hierarchy',
    title: 'Hierarchy',
    component: 'scene-hierarchy',
    minWidth: 160,
    minHeight: 100,
  },
  'script-explorer': {
    id: 'script-explorer',
    title: 'Scripts',
    component: 'script-explorer',
    minWidth: 160,
    minHeight: 100,
  },
  inspector: {
    id: 'inspector',
    title: 'Inspector',
    component: 'inspector',
    minWidth: 220,
    minHeight: 100,
  },
  'scene-settings': {
    id: 'scene-settings',
    title: 'Scene Settings',
    component: 'scene-settings',
    minWidth: 220,
    minHeight: 100,
  },
  'ui-builder': {
    id: 'ui-builder',
    title: 'UI Builder',
    component: 'ui-builder',
    minWidth: 220,
    minHeight: 100,
  },
  'asset-browser': {
    id: 'asset-browser',
    title: 'Assets',
    component: 'asset-browser',
    minWidth: 200,
    minHeight: 80,
  },
  'audio-mixer': {
    id: 'audio-mixer',
    title: 'Audio Mixer',
    component: 'audio-mixer',
    minWidth: 200,
    minHeight: 80,
  },
  docs: {
    id: 'docs',
    title: 'Documentation',
    component: 'docs',
    minWidth: 280,
    minHeight: 200,
  },
  'dialogue-editor': {
    id: 'dialogue-editor',
    title: 'Dialogue Editor',
    component: 'dialogue-editor',
    minWidth: 280,
    minHeight: 200,
  },
  tileset: {
    id: 'tileset',
    title: 'Tileset',
    component: 'tileset',
    minWidth: 200,
    minHeight: 150,
  },
};

/** Panel IDs that should never be closed by the user. */
export const UNCLOSABLE_PANELS = new Set(
  Object.values(PANEL_DEFINITIONS)
    .filter((d) => d.unclosable)
    .map((d) => d.id)
);
